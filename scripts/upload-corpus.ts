/**
 * Corpus → blob upload.
 *
 * Pushes every manifest document into the `corpus` container, stamping the
 * manifest facets (tenant, category, region, year, tags, graph flag) as blob
 * **metadata**. The AI Search indexer maps that metadata straight onto index
 * fields, so a document's tags survive the trip without a second lookup.
 *
 * Idempotent: a blob whose size and manifest id already match is skipped.
 *
 * Usage:
 *   pnpm exec tsx scripts/upload-corpus.ts [--only <id-substr>] [--force] [--dry]
 *
 * Auth: uses AZURE_STORAGE_CONNECTION_STRING if set, otherwise
 * DefaultAzureCredential against AZURE_STORAGE_ACCOUNT (az login).
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = resolve(ROOT, 'seed-corpus');
const CONTAINER = process.env.AZURE_CORPUS_CONTAINER ?? 'corpus';

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

function arg(flag: string): string | null {
  const ix = process.argv.indexOf(flag);
  return ix > -1 ? (process.argv[ix + 1] ?? null) : null;
}

function blobClient(): BlobServiceClient {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (conn) return BlobServiceClient.fromConnectionString(conn);

  const account = process.env.AZURE_STORAGE_ACCOUNT;
  if (!account) {
    throw new Error(
      'Set AZURE_STORAGE_CONNECTION_STRING, or AZURE_STORAGE_ACCOUNT for managed-identity/az-login auth.',
    );
  }
  const key = process.env.AZURE_STORAGE_KEY;
  const url = `https://${account}.blob.core.windows.net`;
  return key
    ? new BlobServiceClient(url, new StorageSharedKeyCredential(account, key))
    : new BlobServiceClient(url, new DefaultAzureCredential());
}

/**
 * Blob metadata values must be ASCII and header-safe. Anything the indexer
 * needs to filter on is normalised here rather than at query time.
 */
function safeMeta(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 500)
    .trim();
}

async function main() {
  const only = arg('--only');
  const force = process.argv.includes('--force');
  const dry = process.argv.includes('--dry');

  // Chunks are partitioned by tenant uuid, exactly as the synchronous
  // pipeline does — the indexer must not be the one path that skips it.
  const tenantId = process.env.AZURE_CORPUS_TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'AZURE_CORPUS_TENANT_ID is required — the tenant uuid every chunk is partitioned by.',
    );
  }

  const manifest = JSON.parse(readFileSync(resolve(CORPUS, 'manifest.json'), 'utf8')) as {
    tenant: string;
    documents: ManifestDoc[];
  };

  // --dry is a planning aid: it must work before the storage account exists.
  const container = dry ? null : blobClient().getContainerClient(CONTAINER);
  if (container) await container.createIfNotExists();

  const docs = manifest.documents.filter(
    (d) => !d.skip && /\.(pdf|docx)$/i.test(d.file) && (!only || d.id.includes(only)),
  );

  console.log(
    `container=${CONTAINER} tenant=${manifest.tenant} candidates=${docs.length}${dry ? ' (dry run)' : ''}`,
  );

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const path = resolve(CORPUS, doc.file);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      console.log(`  ! ${doc.id} — file missing (${doc.file})`);
      failed++;
      continue;
    }

    // Flat blob names keyed by manifest id: stable, and the indexer's document
    // key derives from the blob path, so renames don't orphan index entries.
    const blobName = `${doc.id}${doc.file.match(/\.[a-z]+$/i)?.[0] ?? '.pdf'}`;

    if (dry) {
      console.log(`  ~ ${doc.id} → ${blobName} (${(size / 1e6).toFixed(1)} MB)`);
      continue;
    }

    const blob = container!.getBlockBlobClient(blobName);

    if (!force) {
      const existing = await blob.exists();
      if (existing) {
        const props = await blob.getProperties();
        if (props.contentLength === size && props.metadata?.manifestid === doc.id) {
          console.log(`  = ${doc.id} (unchanged)`);
          skipped++;
          continue;
        }
      }
    }

    process.stdout.write(`  ↑ ${doc.id} (${(size / 1e6).toFixed(1)} MB) … `);
    try {
      await blob.uploadData(readFileSync(path), {
        blobHTTPHeaders: {
          blobContentType: /\.docx$/i.test(doc.file)
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf',
        },
        // Consumed by the indexer's field mappings — see setup-search-pipeline.ts.
        // tenantid/sessionid/sourcetype ride along as metadata rather than
        // being injected downstream: index projections can only map from paths
        // that exist on the enriched document, so there is nowhere to express
        // a constant. Carrying them here keeps the projection a pure mapping.
        metadata: {
          manifestid: doc.id,
          tenantid: tenantId,
          sessionid: 'workspace',
          sourcetype: 'pdf',
          tenantslug: safeMeta(manifest.tenant),
          title: safeMeta(doc.title),
          category: safeMeta(doc.category),
          region: safeMeta(doc.region),
          year: String(doc.year),
          tags: safeMeta(doc.tags.join(',')),
          graph: String(doc.graph),
        },
      });
      console.log('ok');
      uploaded++;
    } catch (err) {
      console.log(`FAILED — ${err instanceof Error ? err.message.slice(0, 140) : err}`);
      failed++;
    }
  }

  console.log(`\ndone: ${uploaded} uploaded, ${skipped} unchanged, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
