/**
 * Load the CareerCraft corpus into the AWS knowledge store from the Azure
 * backup taken on 2026-10-18, without re-extracting a single PDF.
 *
 * The backup holds every chunk Azure Content Understanding produced (text
 * with tables intact, page numbers, facets) but not the vectors, which AI
 * Search would not export. So this script:
 *   1. uploads the source PDFs to S3 under the tenant's corpus/ prefix,
 *   2. re-embeds each chunk with Titan (cents, versus ~A$72 to re-extract),
 *   3. writes the vectors to S3 Vectors with the original ids and sourceIds.
 *
 * Keeping the sourceIds means the Postgres Document rows and the knowledge
 * graph's DocumentEntity links still line up; no sync-documents run needed.
 * Only sourceUrl changes, from the dead Azure blob URL to the S3 object —
 * the filename is kept, so listIndexedSources still maps it to a manifest id.
 *
 * Idempotent: PutVectors overwrites by key, so a re-run just repeats the work.
 *
 * Usage:
 *   pnpm exec tsx scripts/aws-load-corpus.ts [--backup <dir>] [--index <name>] [--skip-pdfs] [--dry]
 *   (default backup dir: ../horus-azure-backup-2026-10-18 next to the repo)
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
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
// This script only makes sense against AWS, whatever .env.local says.
process.env.HORUS_AI_PROVIDER = 'aws';
// Thousands of Titan calls: back off adaptively instead of failing on a 429.
process.env.AWS_RETRY_MODE ??= 'adaptive';
process.env.AWS_MAX_ATTEMPTS ??= '10';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string): boolean => process.argv.includes(name);

interface BackupChunk {
  id: string;
  tenantId: string;
  sessionId: string;
  sourceId: string;
  sourceType: 'url' | 'pdf';
  sourceUrl: string;
  title: string;
  content: string;
  chunkIx: number;
  createdAt: string | null;
  category: string | null;
  year: string | number | null;
  tags: string | string[] | null;
  pageNumber: number | null;
}

const EMBED_BATCH = 64;

async function main(): Promise<void> {
  const backupDir = resolve(
    arg('--backup') ?? resolve(ROOT, '..', 'horus-azure-backup-2026-10-18'),
  );
  const jsonl = resolve(backupDir, 'search/horus-knowledge-docs.jsonl');
  const pdfDir = resolve(backupDir, 'corpus');
  const indexName = arg('--index') ?? process.env.AZURE_SEARCH_INDEX_NAME ?? 'horus-knowledge';
  const dry = flag('--dry');

  const chunks = readFileSync(jsonl, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BackupChunk);
  const tenants = [...new Set(chunks.map((c) => c.tenantId))];
  console.log(`${chunks.length} chunks, ${tenants.length} tenant(s), index "${indexName}"`);

  const core = (path: string) =>
    import(pathToFileURL(resolve(ROOT, 'packages/core/src', path)).href);
  const { clients } = await core('index.ts');
  const { embedTexts, ensureKnowledgeIndex, upsertChunks } = await core('knowledge/index.ts');

  // 1. PDFs → s3://<documents>/t-<tenant>/corpus/<file>.pdf, one copy per tenant.
  const urlFor = new Map<string, string>(); // `${tenantId}/${file}` → S3 URL
  const files = existsSync(pdfDir) ? readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')) : [];
  for (const tenantId of tenants) {
    for (const file of files) {
      const path = `corpus/${file}`;
      const url = clients.s3ObjectUrl(clients.tenantObjectKey(tenantId, path));
      urlFor.set(`${tenantId}/${file}`, url);
      if (dry || flag('--skip-pdfs')) continue;
      await clients.putTenantObject({
        tenantId,
        path,
        data: readFileSync(resolve(pdfDir, file)),
        contentType: 'application/pdf',
      });
    }
  }
  console.log(
    `${files.length} PDFs ${dry || flag('--skip-pdfs') ? 'mapped (not uploaded)' : 'uploaded'}`,
  );

  if (dry) {
    const sample = chunks[0]!;
    const file = decodeURIComponent(sample.sourceUrl.split('/').pop() ?? '');
    console.log('dry run — first chunk would point at', urlFor.get(`${sample.tenantId}/${file}`));
    return;
  }

  // 2 + 3. Embed and write in batches, so a failure loses one batch at most.
  await ensureKnowledgeIndex(indexName);
  const now = new Date();
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors: number[][] = await embedTexts(batch.map((c) => c.content));
    await upsertChunks(
      indexName,
      batch.map((c, j) => {
        const file = decodeURIComponent(c.sourceUrl.split('/').pop() ?? '');
        return {
          id: c.id,
          tenantId: c.tenantId,
          sessionId: c.sessionId,
          sourceId: c.sourceId,
          sourceType: c.sourceType,
          sourceUrl: urlFor.get(`${c.tenantId}/${file}`) ?? c.sourceUrl,
          title: c.title,
          content: c.content,
          contentVector: vectors[j]!,
          chunkIx: c.chunkIx,
          createdAt: c.createdAt ? new Date(c.createdAt) : now,
          ...(c.category && { category: c.category }),
          // The store normalises string years and comma-joined tags.
          ...(c.year && { year: c.year as unknown as number }),
          ...(c.tags && { tags: c.tags as unknown as string[] }),
          ...(typeof c.pageNumber === 'number' && { pageNumber: c.pageNumber }),
        };
      }),
    );
    console.log(`  ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}`);
  }
  console.log('done');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
