/**
 * Azure AI Search corpus pipeline — data source → skillset → index → indexer.
 *
 * This is the enterprise ingest path: blob container in, Content Understanding
 * out. Azure does the hard part (layout analysis, table reconstruction,
 * semantic chunking, vectorisation) and writes chunks straight into the index
 * using **our existing schema**, so `searchKnowledge`, `build-graph.ts`, the
 * agent's `graph_lookup` and the briefing endpoint keep working unchanged —
 * they simply get better chunks.
 *
 * Why Content Understanding and not the Document Layout skill: per Microsoft's
 * own comparison, Document Layout emits tables and figures as plain text
 * ("can result in information loss"), while Content Understanding emits
 * Markdown, treats a table spanning pages as one unit, and costs less. Our
 * corpus is budget papers — the money lives in exactly those tables.
 *
 * The azurerm provider cannot express indexers/skillsets/data sources (they
 * are data-plane, not ARM), which is why this is a script and not Tofu.
 *
 * Usage:
 *   pnpm exec tsx scripts/setup-search-pipeline.ts            # create/update all
 *   pnpm exec tsx scripts/setup-search-pipeline.ts --run      # ...then run it
 *   pnpm exec tsx scripts/setup-search-pipeline.ts --status   # poll execution
 *   pnpm exec tsx scripts/setup-search-pipeline.ts --reset    # full re-crawl
 *   pnpm exec tsx scripts/setup-search-pipeline.ts --print    # dump JSON, no calls
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

/**
 * Content Understanding + semantic chunking are preview surface; the stable
 * data-plane API does not accept them. Pinned deliberately, not drifting.
 */
const API_VERSION = process.env.AZURE_SEARCH_API_VERSION ?? '2026-05-01-preview';

const INDEX_NAME = process.env.AZURE_SEARCH_INDEX_NAME ?? 'horus-knowledge';
const DATASOURCE_NAME = `${INDEX_NAME}-corpus-blobs`;
const SKILLSET_NAME = `${INDEX_NAME}-corpus-skillset`;
const INDEXER_NAME = `${INDEX_NAME}-corpus-indexer`;
const CONTAINER = process.env.AZURE_CORPUS_CONTAINER ?? 'corpus';

/** Chunks carry the tenant partition so RLS-equivalent filtering still holds. */
const TENANT_ID = process.env.AZURE_CORPUS_TENANT_ID ?? '';
const SESSION_ID = 'workspace';

const EMBEDDING_DIMENSIONS = Number(process.env.AZURE_SEARCH_VECTOR_DIMENSIONS ?? 3072);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/* ── REST helper ──────────────────────────────────────────────────────── */

async function searchApi(
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const endpoint = required('AZURE_SEARCH_ENDPOINT').replace(/\/$/, '');
  const key = required('AZURE_SEARCH_API_KEY');
  const url = `${endpoint}/${path}${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`;

  const res = await fetch(url, {
    method,
    headers: {
      'api-key': key,
      'content-type': 'application/json',
      // Lets PUT act as create-or-update rather than failing on existing objects.
      ...(method === 'PUT' ? { Prefer: 'return=representation' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}\n${text.slice(0, 1200)}`);
  }
  return text ? JSON.parse(text) : null;
}

/* ── Definitions ──────────────────────────────────────────────────────── */

/** Blob container crawled with the search service's managed identity. */
function dataSource() {
  const accountId = required('AZURE_STORAGE_ACCOUNT_RESOURCE_ID');
  return {
    name: DATASOURCE_NAME,
    description: 'CareerCraft corpus documents (manifest-driven).',
    type: 'azureblob',
    // Keyless: ResourceId= with no key makes the service use its identity.
    credentials: { connectionString: `ResourceId=${accountId};` },
    container: { name: CONTAINER },
    // Only re-process blobs whose content actually changed.
    dataChangeDetectionPolicy: {
      '@odata.type': '#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy',
      highWaterMarkColumnName: 'metadata_storage_last_modified',
    },
  };
}

/**
 * Our existing chunk schema, unchanged — that is the whole point. `parentId`
 * is the only addition, so index projections can tie chunks to their blob.
 */
function index() {
  return {
    name: INDEX_NAME,
    fields: [
      // Index projections require the key field to use the keyword analyzer —
      // projection-generated keys must survive tokenisation intact.
      { name: 'id', type: 'Edm.String', key: true, filterable: true, analyzer: 'keyword' },
      { name: 'parentId', type: 'Edm.String', filterable: true },
      { name: 'tenantId', type: 'Edm.String', filterable: true },
      { name: 'sessionId', type: 'Edm.String', filterable: true },
      { name: 'sourceId', type: 'Edm.String', filterable: true },
      { name: 'sourceType', type: 'Edm.String', filterable: true },
      { name: 'sourceUrl', type: 'Edm.String', filterable: true },
      { name: 'title', type: 'Edm.String', searchable: true },
      { name: 'content', type: 'Edm.String', searchable: true },
      { name: 'chunkIx', type: 'Edm.Int32', sortable: true },
      { name: 'createdAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
      { name: 'category', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'region', type: 'Edm.String', filterable: true, facetable: true },
      // Blob metadata is always a string, and index projections have no
      // mapping functions to coerce it — so these are strings on the wire.
      // `year` filters as 'eq "2026"'; `tags` is a comma-joined searchable
      // string matched with search.ismatch rather than a collection.
      { name: 'year', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'tags', type: 'Edm.String', filterable: true, searchable: true },
      { name: 'pageNumber', type: 'Edm.Int32', filterable: true },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        // REST property names differ from the JS SDK's: the SDK exposes
        // `hidden` / `vectorSearchProfileName`, the wire format wants
        // `retrievable` / `vectorSearchProfile`.
        retrievable: false,
        dimensions: EMBEDDING_DIMENSIONS,
        vectorSearchProfile: 'vector-profile',
      },
    ],
    vectorSearch: {
      algorithms: [{ name: 'hnsw-default', kind: 'hnsw' }],
      profiles: [
        {
          name: 'vector-profile',
          algorithm: 'hnsw-default',
          // Lets the index embed query text itself at search time.
          vectorizer: 'openai-vectorizer',
        },
      ],
      vectorizers: [
        {
          name: 'openai-vectorizer',
          kind: 'azureOpenAI',
          azureOpenAIParameters: {
            resourceUri: required('AZURE_AU_OPENAI_ENDPOINT'),
            deploymentId: required('AZURE_AU_EMBEDDING_DEPLOYMENT'),
            modelName: 'text-embedding-3-large',
            ...(EMBEDDING_DIMENSIONS !== 3072 && { dimensions: EMBEDDING_DIMENSIONS }),
          },
        },
      ],
    },
  };
}

/**
 * Content Understanding does extraction AND chunking, so no Text Split skill.
 * Semantic chunking keeps paragraph boundaries and handles tables that cross
 * chunk edges — the failure mode that flattened budget tables into digit soup.
 */
function skillset() {
  const foundryId = required('AZURE_AU_FOUNDRY_ACCOUNT_ID');
  return {
    name: SKILLSET_NAME,
    description: 'Content Understanding extraction + chunking + vectorisation.',
    skills: [
      {
        '@odata.type': '#Microsoft.Skills.Util.ContentUnderstandingSkill',
        name: 'extract-and-chunk',
        description: 'Layout-aware markdown extraction with semantic chunking.',
        context: '/document',
        extractionOptions: ['locationMetadata'],
        chunkingProperties: {
          method: 'semantic',
          unit: 'tokens',
          maximumLength: 800,
        },
        inputs: [{ name: 'file_data', source: '/document/file_data' }],
        outputs: [{ name: 'text_sections', targetName: 'text_sections' }],
      },
      {
        '@odata.type': '#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill',
        name: 'embed-chunks',
        description: 'Embed each chunk with the Australian embedding deployment.',
        context: '/document/text_sections/*',
        resourceUri: required('AZURE_AU_OPENAI_ENDPOINT'),
        deploymentId: required('AZURE_AU_EMBEDDING_DEPLOYMENT'),
        modelName: 'text-embedding-3-large',
        ...(EMBEDDING_DIMENSIONS !== 3072 && { dimensions: EMBEDDING_DIMENSIONS }),
        inputs: [{ name: 'text', source: '/document/text_sections/*/content' }],
        outputs: [{ name: 'embedding', targetName: 'contentVector' }],
      },
    ],
    // Billing + auth for skill execution, keyless via the search identity.
    cognitiveServices: {
      '@odata.type': '#Microsoft.Azure.Search.AIServicesByIdentity',
      // Must be the *.cognitiveservices.azure.com hostname — the API validates
      // it as an AI Services resource and rejects the OpenAI subdomain.
      subdomainUrl: required('AZURE_AU_COGNITIVE_ENDPOINT'),
      identity: null, // null = the service's system-assigned identity
    },
    indexProjections: {
      selectors: [
        {
          targetIndexName: INDEX_NAME,
          parentKeyFieldName: 'parentId',
          sourceContext: '/document/text_sections/*',
          mappings: [
            { name: 'content', source: '/document/text_sections/*/content' },
            { name: 'contentVector', source: '/document/text_sections/*/contentVector' },
            {
              name: 'pageNumber',
              source: '/document/text_sections/*/locationMetadata/pageNumberFrom',
            },
            {
              name: 'chunkIx',
              source: '/document/text_sections/*/locationMetadata/ordinalPosition',
            },
            // Document-level values repeat onto every chunk. These come from
            // blob metadata written by upload-corpus.ts, which the blob
            // indexer surfaces as document fields under their metadata keys.
            { name: 'tenantId', source: '/document/tenantid' },
            { name: 'sessionId', source: '/document/sessionid' },
            { name: 'sourceType', source: '/document/sourcetype' },
            { name: 'title', source: '/document/title' },
            { name: 'category', source: '/document/category' },
            { name: 'region', source: '/document/region' },
            { name: 'year', source: '/document/year' },
            { name: 'tags', source: '/document/tags' },
            // Storage-derived; set by the indexer's fieldMappings below.
            { name: 'sourceId', source: '/document/sourceId' },
            { name: 'sourceUrl', source: '/document/sourceUrl' },
          ],
        },
      ],
      parameters: {
        // Chunks are the only thing we query; no parent doc in the index.
        projectionMode: 'skipIndexingParentDocuments',
      },
    },
  };
}

/**
 * `allowSkillsetToReadFileData` is what materialises /document/file_data for
 * the Content Understanding skill — without it the skillset gets nothing.
 */
function indexer() {
  return {
    name: INDEXER_NAME,
    description: 'Crawls the corpus container through Content Understanding.',
    dataSourceName: DATASOURCE_NAME,
    skillsetName: SKILLSET_NAME,
    targetIndexName: INDEX_NAME,
    schedule: { interval: 'PT12H' },
    parameters: {
      batchSize: 1,
      maxFailedItems: 5,
      maxFailedItemsPerBatch: 1,
      configuration: {
        allowSkillsetToReadFileData: true,
        // Content Understanding owns parsing; skip the built-in cracker.
        parsingMode: 'default',
        dataToExtract: 'allMetadata',
      },
    },
    // Only storage-derived values need mapping here; the blob's own custom
    // metadata is already addressable by key on the enriched document.
    fieldMappings: [
      { sourceFieldName: 'metadata_storage_path', targetFieldName: 'sourceUrl' },
      {
        sourceFieldName: 'metadata_storage_path',
        targetFieldName: 'sourceId',
        mappingFunction: {
          name: 'base64Encode',
          parameters: { useHttpServerUtilityUrlTokenEncode: false },
        },
      },
      { sourceFieldName: 'metadata_storage_last_modified', targetFieldName: 'createdAt' },
    ],
    outputFieldMappings: [],
  };
}

/* ── Status ───────────────────────────────────────────────────────────── */

interface ExecutionResult {
  status?: string;
  errorMessage?: string;
  itemsProcessed?: number;
  itemsFailed?: number;
  startTime?: string;
  endTime?: string;
  errors?: Array<{ key?: string; errorMessage?: string }>;
  warnings?: Array<{ key?: string; message?: string }>;
}

async function printStatus() {
  const status = (await searchApi('GET', `indexers/${INDEXER_NAME}/status`)) as {
    status?: string;
    lastResult?: ExecutionResult;
    executionHistory?: ExecutionResult[];
  };
  const last = status.lastResult ?? status.executionHistory?.[0];
  console.log(`indexer=${INDEXER_NAME} overall=${status.status ?? 'unknown'}`);
  if (!last) {
    console.log('  no execution history yet — run with --run');
    return;
  }
  console.log(
    `  last run: ${last.status} · processed=${last.itemsProcessed ?? 0} failed=${last.itemsFailed ?? 0}`,
  );
  if (last.startTime)
    console.log(`  started ${last.startTime}${last.endTime ? ` → ${last.endTime}` : ''}`);
  if (last.errorMessage) console.log(`  error: ${last.errorMessage}`);
  for (const err of (last.errors ?? []).slice(0, 8)) {
    console.log(`  ✗ ${err.key ?? ''}: ${(err.errorMessage ?? '').slice(0, 220)}`);
  }
  for (const warn of (last.warnings ?? []).slice(0, 5)) {
    console.log(`  ! ${warn.key ?? ''}: ${(warn.message ?? '').slice(0, 220)}`);
  }
  // The five-minute per-document cap is the likeliest failure on 185-page
  // budget papers — name it explicitly rather than leaving a bare timeout.
  if ((last.errors ?? []).some((e) => /timed? ?out|exceeded/i.test(e.errorMessage ?? ''))) {
    console.log(
      '\n  NOTE: Content Understanding caps at ~5 minutes per document (and still bills).',
    );
    console.log('  Split the offending PDFs or drop them from the corpus container.');
  }
}

/* ── Main ─────────────────────────────────────────────────────────────── */

async function main() {
  if (process.argv.includes('--print')) {
    console.log(
      JSON.stringify(
        { dataSource: dataSource(), index: index(), skillset: skillset(), indexer: indexer() },
        null,
        2,
      ),
    );
    return;
  }

  if (process.argv.includes('--status')) {
    await printStatus();
    return;
  }

  if (!TENANT_ID) {
    throw new Error(
      'AZURE_CORPUS_TENANT_ID is required — the tenant uuid chunks are partitioned by.',
    );
  }

  console.log(`endpoint=${process.env.AZURE_SEARCH_ENDPOINT} api-version=${API_VERSION}`);
  console.log(`index=${INDEX_NAME} container=${CONTAINER} dims=${EMBEDDING_DIMENSIONS}\n`);

  // Order matters: index and data source must exist before the indexer binds.
  process.stdout.write('  data source … ');
  await searchApi('PUT', `datasources/${DATASOURCE_NAME}`, dataSource());
  console.log('ok');

  // AI Search treats existing field attributes as immutable, so any schema
  // change beyond adding new fields needs the index dropped first. Safe while
  // the corpus is re-indexable from blob — never on an index you can't rebuild.
  if (process.argv.includes('--recreate-index')) {
    process.stdout.write('  dropping index … ');
    await searchApi('DELETE', `indexes/${INDEX_NAME}`).catch(() => undefined);
    console.log('ok');
  }

  process.stdout.write('  index … ');
  await searchApi('PUT', `indexes/${INDEX_NAME}`, index());
  console.log('ok');

  process.stdout.write('  skillset … ');
  await searchApi('PUT', `skillsets/${SKILLSET_NAME}`, skillset());
  console.log('ok');

  process.stdout.write('  indexer … ');
  await searchApi('PUT', `indexers/${INDEXER_NAME}`, indexer());
  console.log('ok');

  if (process.argv.includes('--reset')) {
    process.stdout.write('  reset (forces full re-crawl) … ');
    await searchApi('POST', `indexers/${INDEXER_NAME}/reset`);
    console.log('ok');
  }

  if (process.argv.includes('--run')) {
    process.stdout.write('  run … ');
    await searchApi('POST', `indexers/${INDEXER_NAME}/run`);
    console.log('started');
    console.log('\nPoll with: pnpm exec tsx scripts/setup-search-pipeline.ts --status');
  } else {
    console.log('\nPipeline is defined. Run it with --run (add --reset to re-crawl everything).');
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
