/**
 * Reconcile Postgres `Document` rows with what the AI Search indexer actually
 * produced.
 *
 * The indexer is now the source of truth for ingestion: it assigns its own
 * `sourceId` (a base64-encoded blob path), which will not match the ids the
 * old synchronous pipeline wrote. Without this sync, `build-graph.ts` looks up
 * chunks by a stale sourceId and finds nothing.
 *
 * Matches index documents to manifest entries by title — the manifest carries
 * the `graph` flag and region, which the index does not — then upserts a
 * Document row per indexed source.
 *
 * Usage: pnpm exec tsx scripts/sync-documents.ts [--dry]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

const API_VERSION = process.env.AZURE_SEARCH_API_VERSION ?? '2026-05-01-preview';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

interface ManifestDoc {
  id: string;
  title: string;
  category: string;
  region: string;
  year: number;
  tags: string[];
  graph: boolean;
  skip?: boolean;
}

interface IndexedSource {
  sourceId: string;
  sourceUrl: string;
  title: string;
  category: string | null;
  year: string | null;
  chunkCount: number;
}

/** Group indexed chunks back into their source documents. */
async function fetchIndexedSources(): Promise<IndexedSource[]> {
  const endpoint = required('AZURE_SEARCH_ENDPOINT').replace(/\/$/, '');
  const key = required('AZURE_SEARCH_API_KEY');
  const index = required('AZURE_SEARCH_INDEX_NAME');
  const tenantId = required('AZURE_CORPUS_TENANT_ID');

  const bySource = new Map<string, IndexedSource>();
  // Paging: chunks far exceed the 1000-per-response ceiling.
  for (let skip = 0; skip < 20_000; skip += 1000) {
    const res = await fetch(`${endpoint}/indexes/${index}/docs/search?api-version=${API_VERSION}`, {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        search: '*',
        top: 1000,
        skip,
        select: 'sourceId,sourceUrl,title,category,year',
        filter: `tenantId eq '${tenantId}' and sessionId eq 'workspace'`,
      }),
    });
    if (!res.ok) throw new Error(`search failed: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { value: Array<Record<string, string>> };
    if (body.value.length === 0) break;

    for (const doc of body.value) {
      const existing = bySource.get(doc.sourceId);
      if (existing) existing.chunkCount++;
      else
        bySource.set(doc.sourceId, {
          sourceId: doc.sourceId,
          sourceUrl: doc.sourceUrl,
          title: doc.title,
          category: doc.category ?? null,
          year: doc.year ?? null,
          chunkCount: 1,
        });
    }
    if (body.value.length < 1000) break;
  }
  return [...bySource.values()];
}

async function main() {
  const dry = process.argv.includes('--dry');
  const { prisma } = await import(pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href);

  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'seed-corpus/manifest.json'), 'utf8')) as {
    tenant: string;
    documents: ManifestDoc[];
  };

  const tenant = await prisma.tenant.findUnique({ where: { slug: manifest.tenant } });
  if (!tenant) throw new Error(`Tenant "${manifest.tenant}" not found`);

  const byTitle = new Map(manifest.documents.map((d) => [d.title, d]));
  const sources = await fetchIndexedSources();
  console.log(`indexed sources: ${sources.length}${dry ? ' (dry run)' : ''}`);

  const member = await prisma.tenantMember.findFirst({ where: { tenantId: tenant.id } });
  const uploaderId = member?.userId ?? '00000000-0000-0000-0000-000000000000';

  let created = 0;
  let updated = 0;
  let unmatched = 0;
  const syncedIds = new Set<string>();

  for (const source of sources) {
    // Titles round-trip through blob metadata, which strips non-ASCII — an
    // em-dash becomes a gap, so "A — B" comes back as "A  B". Normalise BOTH
    // sides identically before comparing, or every dashed title misses.
    const norm = (s: string) =>
      s
        .replace(/[^\x20-\x7E]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const sourceKey = norm(source.title);
    const entry =
      byTitle.get(source.title) ?? manifest.documents.find((d) => norm(d.title) === sourceKey);
    if (!entry) {
      console.log(`  ? no manifest entry for "${source.title.slice(0, 60)}"`);
      unmatched++;
    }

    const data = {
      tenantId: tenant.id,
      title: entry?.title ?? source.title,
      category: entry?.category ?? source.category,
      tags: entry?.tags ?? [],
      blobUrl: source.sourceUrl,
      mimeType: 'application/pdf',
      status: 'INDEXED' as const,
      chunksCount: source.chunkCount,
      searchIndex: required('AZURE_SEARCH_INDEX_NAME'),
      metadata: {
        sourceId: source.sourceId,
        manifestId: entry?.id ?? null,
        year: entry?.year ?? (source.year ? Number(source.year) : null),
        region: entry?.region ?? null,
        // Drives which documents build-graph.ts extracts from.
        graph: entry?.graph ?? false,
        pipeline: 'content-understanding',
      },
      uploadedById: uploaderId,
      indexedAt: new Date(),
    };

    if (dry) {
      console.log(
        `  ~ ${data.title.slice(0, 56)} (${source.chunkCount} chunks, graph=${data.metadata.graph})`,
      );
      continue;
    }

    const existing = await prisma.document.findFirst({
      where: { tenantId: tenant.id, title: data.title },
    });
    if (existing) {
      await prisma.document.update({ where: { id: existing.id }, data });
      syncedIds.add(existing.id);
      updated++;
    } else {
      const row = await prisma.document.create({ data });
      syncedIds.add(row.id);
      created++;
    }
  }

  if (!dry) {
    // Anything not re-synced points at a sourceId that no longer exists in the
    // rebuilt index. Tracked by id rather than a JSON-path filter, which
    // Prisma cannot express as "key is absent".
    const stale = await prisma.document.updateMany({
      where: { tenantId: tenant.id, id: { notIn: [...syncedIds] }, status: { not: 'ARCHIVED' } },
      data: { status: 'ARCHIVED' },
    });
    console.log(
      `\ncreated ${created}, updated ${updated}, unmatched ${unmatched}, archived stale ${stale.count}`,
    );

    const graphable = await prisma.document.count({
      where: {
        tenantId: tenant.id,
        status: 'INDEXED',
        metadata: { path: ['graph'], equals: true },
      },
    });
    console.log(`documents flagged for graph extraction: ${graphable}`);
  }

  await prisma.$disconnect();
}

void main();
