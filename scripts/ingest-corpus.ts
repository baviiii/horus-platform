/**
 * Corpus batch ingest — walks seed-corpus/manifest.json through the real
 * ingest pipeline (extract → moderate → chunk → embed → index) into the
 * tenant's permanent knowledge partition, writing a Document row per source.
 *
 * Idempotent: a document whose manifest title already has a Document row is
 * skipped unless --force. Chunks carry category/year/tags facets.
 *
 * Usage:
 *   pnpm exec tsx scripts/ingest-corpus.ts [--only <id-substr>] [--limit N]
 *                                          [--web] [--force] [--dry]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = resolve(ROOT, 'seed-corpus');
const WORKSPACE_PARTITION = 'workspace';

// Env before any core/db import — client singletons read env at load time.
for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

interface ManifestDoc {
  id: string;
  file: string;
  title: string;
  category: string;
  region: string;
  year: number;
  tags: string[];
  graph: boolean;
  skip?: boolean;
}
interface WebSource {
  id: string;
  url: string;
  title: string;
  category: string;
  year: number;
  tags: string[];
  maxPages: number;
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

async function main() {
  const only = arg('--only');
  const limit = Number(arg('--limit') ?? Infinity);
  const doWeb = process.argv.includes('--web');
  const force = process.argv.includes('--force');
  const dry = process.argv.includes('--dry');

  const { ingestPdf, ingestUrl } = await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/knowledge/index.ts')).href
  );
  const { prisma } = await import(pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href);

  const manifest = JSON.parse(readFileSync(resolve(CORPUS, 'manifest.json'), 'utf8')) as {
    tenant: string;
    documents: ManifestDoc[];
    webSources: WebSource[];
  };

  const tenant = await prisma.tenant.findUnique({ where: { slug: manifest.tenant } });
  if (!tenant) throw new Error(`Tenant "${manifest.tenant}" not found — run db:seed first`);
  const member = await prisma.tenantMember.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { joinedAt: 'asc' },
  });
  // System-import attribution when no member has claimed the tenant yet
  // (uploadedById has no FK; the admin auto-claims OWNER on first login).
  const uploaderId = member?.userId ?? '00000000-0000-0000-0000-000000000000';

  console.log(`tenant=${tenant.slug} (${tenant.id}) index=${indexName()} uploader=${uploaderId}`);

  const docs = manifest.documents
    .filter((d) => !d.skip && /\.pdf$/i.test(d.file) && (!only || d.id.includes(only)))
    .slice(0, limit);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;

  for (const doc of docs) {
    const path = resolve(CORPUS, doc.file);
    if (!existsSync(path)) {
      console.log(`  ! ${doc.id} — file missing (${doc.file})`);
      failed++;
      continue;
    }
    const existing = await prisma.document.findFirst({
      where: { tenantId: tenant.id, title: doc.title },
    });
    if (existing && !force) {
      console.log(`  = ${doc.id} (already ingested)`);
      skipped++;
      continue;
    }
    if (dry) {
      console.log(`  ~ ${doc.id} would ingest (${doc.category}/${doc.year})`);
      continue;
    }

    const data = new Uint8Array(readFileSync(path));
    // Agency statements run to hundreds of pages — give big files headroom.
    const maxChunks = data.byteLength > 8_000_000 ? 1500 : 500;
    process.stdout.write(`  ↻ ${doc.id} (${(data.byteLength / 1e6).toFixed(1)} MB) … `);
    const started = Date.now();
    try {
      const source = await ingestPdf({
        indexName: indexName(),
        tenantId: tenant.id,
        sessionId: WORKSPACE_PARTITION,
        filename: doc.file.split('/').pop()!,
        data,
        maxChunks,
        meta: { category: doc.category, year: doc.year, tags: doc.tags },
        emit: () => undefined,
      });
      const row = {
        tenantId: tenant.id,
        title: doc.title,
        category: doc.category,
        tags: doc.tags,
        blobUrl: `pdf:${doc.file}`,
        blobBytes: BigInt(data.byteLength),
        mimeType: 'application/pdf',
        status: 'INDEXED' as const,
        pageCount: null as number | null,
        chunksCount: source.chunkCount,
        searchIndex: indexName(),
        metadata: {
          sourceId: source.sourceId,
          manifestId: doc.id,
          year: doc.year,
          region: doc.region,
          graph: doc.graph,
        },
        uploadedById: uploaderId,
        indexedAt: new Date(),
      };
      if (existing) {
        await prisma.document.update({ where: { id: existing.id }, data: row });
      } else {
        await prisma.document.create({ data: row });
      }
      console.log(`${source.chunkCount} chunks in ${((Date.now() - started) / 1000).toFixed(0)}s`);
      ok++;
      totalChunks += source.chunkCount;
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message.slice(0, 140) : err}`);
      failed++;
    }
  }

  if (doWeb) {
    for (const source of manifest.webSources.filter((w) => !only || w.id.includes(only))) {
      const existing = await prisma.document.findFirst({
        where: { tenantId: tenant.id, title: source.title },
      });
      if (existing && !force) {
        console.log(`  = ${source.id} (already ingested)`);
        skipped++;
        continue;
      }
      if (dry) {
        console.log(`  ~ ${source.id} would crawl ${source.url}`);
        continue;
      }
      process.stdout.write(`  ⇣ ${source.id} (${source.url}) … `);
      try {
        const crawled = await ingestUrl({
          indexName: indexName(),
          tenantId: tenant.id,
          sessionId: WORKSPACE_PARTITION,
          url: source.url,
          maxPages: source.maxPages,
          maxChunks: 300,
          meta: { category: source.category, year: source.year, tags: source.tags },
          emit: () => undefined,
        });
        const row = {
          tenantId: tenant.id,
          title: source.title,
          category: source.category,
          tags: source.tags,
          blobUrl: source.url,
          mimeType: 'text/html',
          status: 'INDEXED' as const,
          chunksCount: crawled.chunkCount,
          searchIndex: indexName(),
          metadata: { sourceId: crawled.sourceId, manifestId: source.id, year: source.year },
          uploadedById: uploaderId,
          indexedAt: new Date(),
        };
        if (existing) {
          await prisma.document.update({ where: { id: existing.id }, data: row });
        } else {
          await prisma.document.create({ data: row });
        }
        console.log(`${crawled.chunkCount} chunks`);
        ok++;
        totalChunks += crawled.chunkCount;
      } catch (err) {
        console.log(`FAILED — ${err instanceof Error ? err.message.slice(0, 140) : err}`);
        failed++;
      }
    }
  }

  console.log(
    `\ndone: ${ok} ingested (${totalChunks} chunks), ${skipped} already present, ${failed} failed`,
  );
  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

void main();
