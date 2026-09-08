/**
 * Graph extraction, phase 1 of 2 — chunks → a JSON file on disk.
 *
 * Deliberately writes nothing to Postgres. `build-graph.ts` interleaved model
 * calls with 50-100 tiny queries per batch, which exhausted the free-tier
 * connection pool and took the database down with it. Splitting the job means
 * the expensive half (model calls) never depends on the database being healthy,
 * and the cheap half becomes a bulk load — see `load-graph-json.ts`.
 *
 * Three things fall out of writing to disk first:
 *   - Resumable. A document already in the file is skipped, so a crash at
 *     document 50 costs nothing. Extraction is the part you pay for.
 *   - Auditable. You can read exactly what the model proposed before any of it
 *     reaches the graph — which matters for a product whose pitch is that every
 *     claim is checkable.
 *   - Deduplication happens in a Map instead of via `findFirst` per entity,
 *     which is where most of those round-trips went.
 *
 * Usage:
 *   pnpm exec tsx scripts/extract-graph-json.ts [--only <manifest-id-substr>]
 *     [--limit N] [--batch 5] [--max-batches 100] [--concurrency 4]
 *     [--profile general|careers] [--category a,b] [--out <path>] [--force] [--deep]
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_PARTITION = 'workspace';
const MIN_CHUNK_CHARS = 200;
const MAX_ALIASES = 8;
const MAX_EVIDENCE = 3;
const MAX_PAGES = 50;

for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

function arg(flag: string): string | null {
  const ix = process.argv.indexOf(flag);
  return ix > -1 ? (process.argv[ix + 1] ?? null) : null;
}

function indexName(): string {
  return (
    process.env.AZURE_SEARCH_INDEX_NAME ??
    process.env.AZURE_SEARCH_PLAYGROUND_INDEX ??
    'horus-playground'
  );
}

/** One entity as extracted, already merged across the batches of its document. */
interface JsonEntity {
  name: string;
  type: string;
  aliases: string[];
  attributes?: Record<string, string | number>;
  /** Chunk indexes it appeared in — becomes DocumentEntity.pages. */
  chunkIxs: number[];
  /** Batches it appeared in — becomes DocumentEntity.mentions. */
  mentions: number;
}

interface JsonRelationship {
  from: string;
  fromType: string;
  to: string;
  toType: string;
  type: string;
  evidence: string[];
  confidence: number;
}

interface JsonDocument {
  documentId: string;
  manifestId: string;
  title: string;
  category: string | null;
  year: number | null;
  chunks: number;
  batches: number;
  failedBatches: number;
  /** Why batches failed, reason -> count. Empty when none did. */
  failureReasons: Record<string, number>;
  entities: JsonEntity[];
  relationships: JsonRelationship[];
  usage: { inputTokens: number; outputTokens: number };
  extractedAt: string;
}

interface GraphFile {
  version: 1;
  tenant: string;
  tenantId: string;
  profile: string;
  generatedAt: string;
  documents: Record<string, JsonDocument>;
}

/** Atomic write: a crash mid-write must not leave a truncated file behind. */
function writeAtomic(path: string, data: GraphFile): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

async function main() {
  const only = arg('--only');
  const limit = Number(arg('--limit') ?? Infinity);
  const batchSize = Number(arg('--batch') ?? 5);
  const maxBatches = Number(arg('--max-batches') ?? 100);
  const concurrency = Math.max(1, Number(arg('--concurrency') ?? 4));
  const force = process.argv.includes('--force');
  const tier = process.argv.includes('--deep') ? ('deep' as const) : ('fast' as const);
  const outPath = resolve(ROOT, arg('--out') ?? 'graph-extract.json');
  const categoryArg = arg('--category');
  const categories = categoryArg ? categoryArg.split(',').map((c) => c.trim()) : null;
  const profile = (arg('--profile') ?? 'general') as 'general' | 'careers';
  if (profile !== 'general' && profile !== 'careers') {
    throw new Error(`--profile must be "general" or "careers" (got "${profile}")`);
  }

  const { extractGraphFromChunks } = await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/entities/index.ts')).href
  );
  const { fetchSourceChunks, listIndexedSources } = await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/knowledge/index.ts')).href
  );
  const { prisma } = await import(pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href);

  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'seed-corpus/manifest.json'), 'utf8')) as {
    tenant: string;
  };
  const tenant = await prisma.tenant.findUnique({ where: { slug: manifest.tenant } });
  if (!tenant) throw new Error(`Tenant "${manifest.tenant}" not found`);

  const documents = (
    await prisma.document.findMany({
      where: {
        tenantId: tenant.id,
        status: 'INDEXED',
        metadata: { path: ['graph'], equals: true },
      },
      orderBy: { createdAt: 'asc' },
    })
  )
    .filter((d: { metadata: unknown; category: string | null }) => {
      const meta = d.metadata as { manifestId?: string };
      if (only && !(meta.manifestId ?? '').includes(only)) return false;
      if (categories && !categories.includes(d.category ?? '')) return false;
      return true;
    })
    .slice(0, limit);

  // Everything the database is needed for happens here, up front, in two
  // queries. From this point the run is pure model calls plus a local file.
  const sourceIdByManifestId = await listIndexedSources(
    indexName(),
    tenant.id,
    WORKSPACE_PARTITION,
  );
  await prisma.$disconnect();

  const out: GraphFile =
    !force && existsSync(outPath)
      ? (JSON.parse(readFileSync(outPath, 'utf8')) as GraphFile)
      : {
          version: 1,
          tenant: tenant.slug,
          tenantId: tenant.id,
          profile,
          generatedAt: new Date().toISOString(),
          documents: {},
        };

  const already = Object.keys(out.documents).length;
  console.log(
    `tenant=${tenant.slug} docs=${documents.length} done=${already} profile=${profile} tier=${tier} batch=${batchSize} maxBatches=${maxBatches} concurrency=${concurrency}`,
  );
  console.log(`out=${outPath}\n`);

  let tokensIn = 0;
  let tokensOut = 0;

  for (const doc of documents) {
    const meta = doc.metadata as { sourceId?: string; manifestId?: string; year?: number };
    const manifestId = meta.manifestId ?? doc.id;

    if (out.documents[manifestId] && !force) {
      console.log(`  ⏭ ${doc.title.slice(0, 58)} (already extracted)`);
      continue;
    }

    const sourceId = sourceIdByManifestId.get(manifestId) ?? meta.sourceId;
    if (!sourceId) {
      console.log(`  ! ${doc.title.slice(0, 58)} — not in the index, skipping`);
      continue;
    }

    const chunks = (
      await fetchSourceChunks(indexName(), tenant.id, WORKSPACE_PARTITION, sourceId)
    ).filter((c: { content: string }) => c.content.trim().length >= MIN_CHUNK_CHARS);

    const batches: Array<Array<{ chunkIx: number; text: string }>> = [];
    for (let i = 0; i < chunks.length && batches.length < maxBatches; i += batchSize) {
      batches.push(
        chunks.slice(i, i + batchSize).map((c: { chunkIx: number; content: string }) => ({
          chunkIx: c.chunkIx,
          text: c.content,
        })),
      );
    }

    process.stdout.write(
      `  ⚙ ${doc.title.slice(0, 55)} (${chunks.length} chunks → ${batches.length} batches) … `,
    );
    const started = Date.now();

    // Per-document merge, in memory. This is the work that used to be a
    // `findFirst` round-trip per entity.
    const entities = new Map<string, JsonEntity>();
    const relationships = new Map<string, JsonRelationship>();
    let failedBatches = 0;
    /** reason -> count, so a run reports what actually went wrong. */
    const failureReasons = new Map<string, number>();
    let docTokensIn = 0;
    let docTokensOut = 0;

    for (let w = 0; w < batches.length; w += concurrency) {
      const window = batches.slice(w, w + concurrency);
      const results = await Promise.all(
        window.map((batch) =>
          extractGraphFromChunks({
            docTitle: doc.title,
            category: doc.category ?? 'general',
            year: meta.year ?? new Date().getFullYear(),
            chunks: batch,
            model: tier,
            profile,
          }).then(
            (ok: unknown) => ({ ok, batch, err: null as unknown }),
            (err: unknown) => ({ ok: null, batch, err }),
          ),
        ),
      );

      for (const { ok, batch, err } of results) {
        if (!ok) {
          failedBatches++;
          // Record WHY. Swallowing this is how a 17% failure rate went
          // unnoticed across a whole run — the count was reported, the cause
          // was not, and there was nothing to act on afterwards.
          const message =
            err instanceof Error
              ? err.message
              : typeof err === 'string'
                ? err
                : JSON.stringify(err);
          const reason = (message || 'unknown').slice(0, 160);
          failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
          continue;
        }
        const extraction = ok as {
          entities: Array<{
            name: string;
            type: string;
            aliases?: string[];
            attributes?: Record<string, string | number>;
          }>;
          relationships: Array<{
            from: string;
            from_type?: string;
            to: string;
            to_type?: string;
            type: string;
            evidence: string;
            confidence: number;
          }>;
          usage: { inputTokens: number; outputTokens: number };
        };
        docTokensIn += extraction.usage.inputTokens;
        docTokensOut += extraction.usage.outputTokens;

        const chunkIxs = batch.map((c) => c.chunkIx);
        for (const e of extraction.entities) {
          const key = `${e.type}:${e.name.toLowerCase()}`;
          const existing = entities.get(key);
          if (existing) {
            for (const a of e.aliases ?? []) {
              if (!existing.aliases.includes(a) && existing.aliases.length < MAX_ALIASES) {
                existing.aliases.push(a);
              }
            }
            if (e.attributes) existing.attributes = { ...existing.attributes, ...e.attributes };
            for (const ix of chunkIxs) {
              if (!existing.chunkIxs.includes(ix) && existing.chunkIxs.length < MAX_PAGES) {
                existing.chunkIxs.push(ix);
              }
            }
            existing.mentions++;
          } else {
            entities.set(key, {
              name: e.name,
              type: e.type,
              aliases: (e.aliases ?? []).slice(0, MAX_ALIASES),
              ...(e.attributes && { attributes: e.attributes }),
              chunkIxs: chunkIxs.slice(0, MAX_PAGES),
              mentions: 1,
            });
          }
        }

        for (const r of extraction.relationships) {
          const fromKey = `${r.from_type}:${r.from.toLowerCase()}`;
          const toKey = `${r.to_type}:${r.to.toLowerCase()}`;
          if (!entities.has(fromKey) || !entities.has(toKey) || fromKey === toKey) continue;
          const key = `${fromKey}|${r.type}|${toKey}`;
          const existing = relationships.get(key);
          if (existing) {
            existing.confidence = Math.max(existing.confidence, r.confidence);
            if (r.evidence && existing.evidence.length < MAX_EVIDENCE) {
              existing.evidence.push(r.evidence);
            }
          } else {
            relationships.set(key, {
              from: entities.get(fromKey)!.name,
              fromType: entities.get(fromKey)!.type,
              to: entities.get(toKey)!.name,
              toType: entities.get(toKey)!.type,
              type: r.type,
              evidence: r.evidence ? [r.evidence] : [],
              confidence: r.confidence,
            });
          }
        }
      }
    }

    out.documents[manifestId] = {
      documentId: doc.id,
      manifestId,
      title: doc.title,
      category: doc.category,
      year: meta.year ?? null,
      chunks: chunks.length,
      batches: batches.length,
      failedBatches,
      failureReasons: Object.fromEntries(failureReasons),
      entities: [...entities.values()],
      relationships: [...relationships.values()],
      usage: { inputTokens: docTokensIn, outputTokens: docTokensOut },
      extractedAt: new Date().toISOString(),
    };
    // Persist after every document so a crash costs one document, not the run.
    writeAtomic(outPath, out);

    tokensIn += docTokensIn;
    tokensOut += docTokensOut;
    console.log(
      `${entities.size}e/${relationships.size}r in ${((Date.now() - started) / 1000).toFixed(0)}s${failedBatches ? ` (${failedBatches} batches failed)` : ''}`,
    );
    for (const [reason, n] of [...failureReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${n}x ${reason}`);
    }
  }

  const totals = Object.values(out.documents).reduce(
    (acc, d) => ({ e: acc.e + d.entities.length, r: acc.r + d.relationships.length }),
    { e: 0, r: 0 },
  );
  console.log(
    `\ndone: ${Object.keys(out.documents).length} documents · ${totals.e} entities / ${totals.r} relationships (pre-merge)`,
  );
  console.log(`tokens this run: ${tokensIn} in / ${tokensOut} out (${tier} tier)`);
  console.log(`\nwritten to ${outPath}`);
  console.log('load it with: pnpm exec tsx scripts/load-graph-json.ts');
}

void main();
