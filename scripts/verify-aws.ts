/**
 * Day-one smoke test for HORUS_AI_PROVIDER=aws: exercises every AWS-backed
 * path once against the real services and reports pass/fail per check.
 *
 * Writes only scratch data (tenant "verify", a random session in the
 * playground index, one small S3 object) and deletes it again. Costs well
 * under a cent. Run after `tofu apply` in envs/aws-dev and filling
 * apps/web/.env.local from print-horus-env.ps1.
 *
 * Usage: pnpm exec tsx scripts/verify-aws.ts
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = resolve(ROOT, 'apps/web/.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}
process.env.HORUS_AI_PROVIDER = 'aws';

const core = (path: string) => import(pathToFileURL(resolve(ROOT, 'packages/core/src', path)).href);

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: `${detail} (${Date.now() - started} ms)` });
    console.log(`✓ ${name} — ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    results.push({ name, ok: false, detail });
    console.log(`✗ ${name} — ${detail}`);
  }
}

async function main(): Promise<void> {
  const { infer, embed } = await core('inference/index.ts');
  const knowledge = await core('knowledge/index.ts');
  const { runKnowledgeAgent } = await core('agent/index.ts');
  const { moderateText } = await core('safety/index.ts');
  const { detectPii } = await core('clients/language.ts');
  const { clients } = await core('index.ts');
  const { awsRegion, AWS_RESOURCES } = await core('clients/aws.ts');

  console.log(
    `region ${awsRegion()}, vectors ${AWS_RESOURCES.vectorBucket()}, ` +
      `documents ${AWS_RESOURCES.documentsBucket() ?? '(unset)'}, guardrail ${AWS_RESOURCES.guardrailId() ?? '(unset)'}\n`,
  );

  await check('infer (Claude, JSON)', async () => {
    const res = await infer({
      task: 'verify.aws',
      system: 'You answer arithmetic. Return ONLY JSON: {"answer": number}.',
      messages: [{ role: 'user', content: 'What is 17 + 25?' }],
      maxTokens: 200,
    });
    const parsed = JSON.parse(res.content) as { answer?: number };
    if (parsed.answer !== 42) throw new Error(`unexpected answer ${res.content}`);
    return `${res.model}, ${res.usage.inputTokens}→${res.usage.outputTokens} tokens`;
  });

  await check('embed (Titan, 512 dims)', async () => {
    const res = await embed(['software engineer in Adelaide', 'nurse in Darwin'], {
      dimensions: 512,
    });
    if (res.vectors.length !== 2 || res.dimensions !== 512) throw new Error('wrong shape');
    return `${res.model}, ${res.tokens} tokens`;
  });

  const index = process.env.AZURE_SEARCH_PLAYGROUND_INDEX ?? 'horus-playground';
  const tenantId = 'verify';
  const sessionId = `verify-${randomUUID().slice(0, 8)}`;
  const passages = [
    'TAFE SA delivers Fee-Free TAFE courses in aged care, early childhood education and cyber security.',
    'The Regional Jobs Incentive Program pays employers who hire apprentices outside Adelaide.',
  ];

  await check('vector store: upsert + search + count + sources', async () => {
    await knowledge.ensureKnowledgeIndex(index);
    const vectors = await knowledge.embedTexts(passages);
    await knowledge.upsertChunks(
      index,
      passages.map((content: string, i: number) => ({
        id: `${sessionId}_src_${i}`,
        tenantId,
        sessionId,
        sourceId: `src${i}`,
        sourceType: 'pdf' as const,
        sourceUrl: `pdf:verify-${i}.pdf`,
        title: `Verify ${i}`,
        content,
        contentVector: vectors[i],
        chunkIx: 0,
        createdAt: new Date(),
        category: 'verify',
        year: 2026,
        tags: ['smoke'],
      })),
    );
    const hits = await knowledge.searchKnowledge({
      indexName: index,
      tenantId,
      sessionId,
      query: 'free TAFE courses',
      vector: await knowledge.embedQuery('free TAFE courses'),
      top: 2,
      filters: { category: 'verify', year: 2026, tags: ['smoke'] },
    });
    if (hits[0]?.sourceId !== 'src0') throw new Error(`top hit was ${hits[0]?.sourceId ?? 'none'}`);
    const count = await knowledge.countSessionChunks(index, tenantId, sessionId);
    const sources = await knowledge.listSessionSources(index, tenantId, sessionId);
    if (count !== 2 || sources.length !== 2)
      throw new Error(`count ${count}, sources ${sources.length}`);
    return `top score ${hits[0].score.toFixed(3)}, ${count} chunks`;
  });

  await check('agent (Claude tool loop over the knowledge store)', async () => {
    let text = '';
    const tools: string[] = [];
    await runKnowledgeAgent({
      indexName: index,
      tenantId,
      sessionId,
      messages: [{ role: 'user', content: 'Which provider runs Fee-Free TAFE courses?' }],
      emit: (event: { kind: string; text?: string; name?: string; status?: string }) => {
        if (event.kind === 'token' && event.text) text += event.text;
        if (event.kind === 'tool' && event.status === 'start' && event.name) tools.push(event.name);
      },
    });
    if (!tools.includes('search_knowledge')) throw new Error('agent never searched');
    if (!/TAFE SA/i.test(text)) throw new Error(`answer missed the passage: ${text.slice(0, 160)}`);
    return `tools [${tools.join(', ')}], ${text.length} chars`;
  });

  await check('vector store: delete session', async () => {
    const deleted = await knowledge.deleteSession(index, tenantId, sessionId);
    const left = await knowledge.countSessionChunks(index, tenantId, sessionId);
    if (left !== 0) throw new Error(`${left} chunks left after deleting ${deleted}`);
    return `${deleted} deleted`;
  });

  await check('moderation (Guardrails)', async () => {
    if (!AWS_RESOURCES.guardrailId()) throw new Error('HORUS_BEDROCK_GUARDRAIL_ID is not set');
    const clean = await moderateText('What courses help me move into aged care?');
    if (clean.blocked) throw new Error(`clean text blocked (${clean.category})`);
    const threat = await moderateText('I am going to find you and kill you.');
    if (!threat.blocked) throw new Error('a direct threat was not blocked');
    return `threat blocked as ${threat.category}`;
  });

  await check('PII detection (Comprehend)', async () => {
    const res = await detectPii('Please call Jane Citizen on 0412 345 678 about the incident.');
    if (!res.ok) throw new Error('detection unavailable');
    const categories = res.entities.map((e: { category: string }) => e.category);
    if (!categories.includes('Person')) throw new Error(`no Person in [${categories.join(', ')}]`);
    return `[${categories.join(', ')}]`;
  });

  await check('file storage (S3)', async () => {
    const path = `verify/${randomUUID()}.txt`;
    const url = await clients.putTenantObject({
      tenantId,
      path,
      data: new TextEncoder().encode('verify'),
      contentType: 'text/plain',
    });
    await clients.deleteTenantObject({ tenantId, path });
    return url.replace(/\/[^/]+$/, '/…');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
