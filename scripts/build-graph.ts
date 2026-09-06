/**
 * Graph builder — runs entity/edge extraction over ingested corpus documents
 * and persists the knowledge graph to Postgres.
 *
 * Feeds on the search index (fetchSourceChunks per document), batches chunks
 * through the extractor, and upserts Entity / Relationship / DocumentEntity.
 * Idempotent: re-runs converge on the same graph. Token usage is metered to
 * UsageRecord and printed.
 *
 * Usage:
 *   pnpm exec tsx scripts/build-graph.ts [--only <manifest-id-substr>]
 *     [--limit N] [--batch 5] [--max-batches 40] [--concurrency 4] [--deep]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_PARTITION = 'workspace';

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

const MIN_CHUNK_CHARS = 200;

/**
 * Retry wrapper for database work.
 *
 * The Postgres endpoint drops connections intermittently — observed on both
 * the pooled (6543) and direct (5432) paths. A graph build makes thousands of
 * small queries over tens of minutes, so a transient drop is near-certain, and
 * without this an entire batch of extracted entities is silently discarded.
 * Retries are cheap; re-running extraction is not.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      // Only connectivity faults are worth retrying; a schema or data error
      // will fail identically every time.
      if (!/reach database server|Connection|timed out|ECONNRESET|terminated/i.test(message)) {
        throw err;
      }
      if (i < attempts) {
        const backoffMs = 2_000 * 2 ** (i - 1);
        console.log(
          `    ${label}: connection lost, retry ${i}/${attempts - 1} in ${backoffMs / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastError;
}

async function main() {
  const only = arg('--only');
  const limit = Number(arg('--limit') ?? Infinity);
  const batchSize = Number(arg('--batch') ?? 5);
  const maxBatches = Number(arg('--max-batches') ?? 40);
  /** Concurrent extraction calls. 4 × ~5k tokens sits well inside a 50k TPM deployment. */
  const concurrency = Math.max(1, Number(arg('--concurrency') ?? 4));
  const tier = process.argv.includes('--deep') ? ('deep' as const) : ('fast' as const);
  // `careers` reads documents as a pathway map (occupation/skill/qualification)
  // rather than as budget intelligence. Both profiles feed one graph.
  const categoryArg = arg('--category');
  const categories = categoryArg ? categoryArg.split(',').map((c) => c.trim()) : null;
  const profile = (arg('--profile') ?? 'general') as 'general' | 'careers';
  if (profile !== 'general' && profile !== 'careers') {
    throw new Error(`--profile must be "general" or "careers" (got "${profile}")`);
  }

  const { extractGraphFromChunks, persistGraph } = await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/entities/index.ts')).href
  );
  const { fetchSourceChunks, listIndexedSources } = await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/knowledge/index.ts')).href
  );
  const { prisma } = await import(pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href);

  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'seed-corpus/manifest.json'), 'utf8')) as {
    tenant: string;
  };

  const tenant = await withRetry('tenant lookup', () =>
    prisma.tenant.findUnique({ where: { slug: manifest.tenant } }),
  );
  if (!tenant) throw new Error(`Tenant "${manifest.tenant}" not found`);

  // Graph-flagged, indexed documents (flag stamped by ingest-corpus from the manifest).
  const documents = (
    await withRetry('document list', () =>
      prisma.document.findMany({
        where: {
          tenantId: tenant.id,
          status: 'INDEXED',
          metadata: { path: ['graph'], equals: true },
        },
        orderBy: { createdAt: 'asc' },
      }),
    )
  )
    .filter((d) => {
      const meta = d.metadata as { manifestId?: string };
      if (only && !(meta.manifestId ?? '').includes(only)) return false;
      // Lets a profile target the slice of the corpus it actually reads well —
      // the careers profile has nothing to say about a budget statement.
      if (categories && !categories.includes(d.category ?? '')) return false;
      return true;
    })
    .slice(0, limit);

  console.log(
    `tenant=${tenant.slug} docs=${documents.length} profile=${profile}${categories ? ` categories=${categories.join(',')}` : ''} tier=${tier} batch=${batchSize} maxBatches=${maxBatches} concurrency=${concurrency}`,
  );

  let totalEntities = 0;
  let totalRels = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  // The stored sourceId is only valid for chunks written by the synchronous
  // ingest. After a Content Understanding indexer run the index keys chunks by
  // a blob-derived id instead, and the Document row has no way to know it — so
  // resolve through the manifest id, which is the blob filename either way.
  const sourceIdByManifestId = await withRetry('index source map', () =>
    listIndexedSources(indexName(), tenant.id, WORKSPACE_PARTITION),
  );

  for (const doc of documents) {
    const meta = doc.metadata as { sourceId?: string; manifestId?: string; year?: number };
    const sourceId =
      (meta.manifestId ? sourceIdByManifestId.get(meta.manifestId) : undefined) ?? meta.sourceId;
    if (!sourceId) {
      console.log(`  ! ${doc.title} — not present in the index, skipping`);
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
      `  ⚙ ${doc.title.slice(0, 60)} (${chunks.length} chunks → ${batches.length} batches) … `,
    );
    const started = Date.now();
    let docEntities = 0;
    let docRels = 0;

    // Extraction is a latency-bound model call, so run a window of them at
    // once; persistence stays strictly sequential because two batches touching
    // the same entity would race on the upsert. At ~5k tokens per call this
    // window sits well inside the deployment's TPM quota.
    for (let w = 0; w < batches.length; w += concurrency) {
      const window = batches.slice(w, w + concurrency);
      const extractions = await Promise.all(
        window.map((batch) =>
          extractGraphFromChunks({
            docTitle: doc.title,
            category: doc.category ?? 'general',
            year: meta.year ?? new Date().getFullYear(),
            chunks: batch,
            model: tier,
            profile,
          }).then(
            (ok) => ({ ok, batch, err: null as unknown }),
            (err: unknown) => ({ ok: null, batch, err }),
          ),
        ),
      );

      for (const { ok: extraction, batch, err: extractErr } of extractions) {
        try {
          if (!extraction) throw extractErr;
          tokensIn += extraction.usage.inputTokens;
          tokensOut += extraction.usage.outputTokens;
          const persisted = await withRetry('persist', () =>
            persistGraph({
              db: prisma,
              tenantId: tenant.id,
              documentId: doc.id,
              entities: extraction.entities,
              relationships: extraction.relationships,
              chunkIxs: batch.map((c) => c.chunkIx),
            }),
          );
          docEntities += persisted.entitiesUpserted;
          docRels += persisted.relationshipsUpserted;
        } catch (err) {
          // One bad batch must not sink the document.
          console.log(
            `\n    batch failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
          );
        }
      }
    }
    totalEntities += docEntities;
    totalRels += docRels;
    console.log(`${docEntities}e/${docRels}r in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  // Meter the run like any other model workload.
  if (tokensIn > 0) {
    await prisma.usageRecord.createMany({
      data: [
        {
          tenantId: tenant.id,
          meter: 'COMPLETION_TOKENS_IN',
          quantity: BigInt(tokensIn),
          metadata: { task: 'entities.extract_graph', tier },
        },
        {
          tenantId: tenant.id,
          meter: 'COMPLETION_TOKENS_OUT',
          quantity: BigInt(tokensOut),
          metadata: { task: 'entities.extract_graph', tier },
        },
      ],
    });
  }

  const [entityCount, relCount] = await Promise.all([
    prisma.entity.count({ where: { tenantId: tenant.id } }),
    prisma.relationship.count({ where: { tenantId: tenant.id } }),
  ]);
  console.log(
    `\ndone: +${totalEntities} entity upserts, +${totalRels} edge upserts · graph now ${entityCount} entities / ${relCount} relationships`,
  );
  console.log(`tokens: ${tokensIn} in / ${tokensOut} out (${tier} tier)`);
  await prisma.$disconnect();
}

void main();
