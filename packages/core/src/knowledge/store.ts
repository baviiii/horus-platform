/**
 * Knowledge store on Azure AI Search.
 *
 * One index holds chunked, embedded knowledge partitioned by tenantId +
 * sessionId (the playground uses tenant "playground" with ephemeral
 * sessions; real tenants later get index-per-tenant with the same shape).
 *
 * Retrieval is hybrid: BM25 keyword + HNSW vector in one query. Semantic
 * reranking is intentionally not requested — unavailable on the free tier.
 *
 * With HORUS_AI_PROVIDER=aws every function here delegates to the S3 Vectors
 * implementation in `store-s3vectors.ts`, which keeps the same signatures.
 */
import type { SearchClient, SearchIndex } from '@azure/search-documents';
import { getSearchClient, getSearchIndexClient } from '../clients/azure-search.js';
import { aiProvider, assertAiAvailable } from '../provider.js';
import * as s3v from './store-s3vectors.js';

/** Fail fast when AI is switched off; true when the store lives on S3 Vectors. */
function onAws(): boolean {
  assertAiAvailable();
  return aiProvider() === 'aws';
}

/**
 * Vector width for the knowledge index.
 *
 * 3072 is text-embedding-3-large's native size. Lowering it (e.g. 1024) is a
 * Matryoshka truncation: index storage shrinks roughly linearly for a small
 * recall cost — the lever to pull when Azure AI Search storage is the binding
 * constraint. CHANGING THIS REQUIRES A FULL RE-INDEX: AI Search treats
 * vectorSearchDimensions as immutable, so the index must be dropped and every
 * chunk re-embedded. Never flip it casually on a populated index.
 */
export const EMBEDDING_DIMENSIONS = Number(process.env.AZURE_SEARCH_VECTOR_DIMENSIONS ?? 3072);

export interface KnowledgeChunkDoc {
  /** `${sessionId}_${sourceId}_${chunkIx}` — AI-Search-key-safe, deterministic. */
  id: string;
  tenantId: string;
  sessionId: string;
  sourceId: string;
  sourceType: 'url' | 'pdf';
  /** Exact page URL for web chunks (citation target); `pdf:<filename>` for PDFs. */
  sourceUrl: string;
  title: string;
  content: string;
  contentVector: number[];
  chunkIx: number;
  createdAt: Date;
  /** Corpus area tags (manifest-driven) — filterable facets for scoped retrieval. */
  category?: string;
  year?: number;
  tags?: string[];
  /** Set by the Content Understanding indexer; never written by this module. */
  pageNumber?: number;
}

/** Optional metadata attached to every chunk of a source at ingest time. */
export interface ChunkMeta {
  category?: string;
  year?: number;
  tags?: string[];
}

export interface KnowledgeHit {
  score: number;
  title: string;
  content: string;
  sourceUrl: string;
  sourceType: 'url' | 'pdf';
  sourceId: string;
  chunkIx: number;
  /**
   * 1-based page the chunk starts on. Written by the Content Understanding
   * pipeline from `locationMetadata/pageNumberFrom`; absent on chunks from the
   * older synchronous ingest, which had no layout information to derive it.
   */
  pageNumber?: number;
}

export interface KnowledgeSource {
  sourceId: string;
  sourceType: 'url' | 'pdf';
  title: string;
  sourceUrl: string;
  chunkCount: number;
  createdAt: string;
}

const escapeOData = (value: string): string => value.replace(/'/g, "''");

const scopeFilter = (tenantId: string, sessionId: string): string =>
  `tenantId eq '${escapeOData(tenantId)}' and sessionId eq '${escapeOData(sessionId)}'`;

function buildIndexDefinition(name: string): SearchIndex {
  return {
    name,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      { name: 'tenantId', type: 'Edm.String', filterable: true },
      { name: 'sessionId', type: 'Edm.String', filterable: true },
      { name: 'sourceId', type: 'Edm.String', filterable: true },
      { name: 'sourceType', type: 'Edm.String', filterable: true },
      { name: 'sourceUrl', type: 'Edm.String', filterable: true },
      { name: 'title', type: 'Edm.String', searchable: true },
      { name: 'content', type: 'Edm.String', searchable: true },
      // NOTE: attributes of already-deployed fields are immutable in AI Search —
      // chunkIx stays exactly as first shipped (sortable, not filterable).
      { name: 'chunkIx', type: 'Edm.Int32', sortable: true },
      { name: 'createdAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
      // Corpus facets — additive fields; pre-existing documents hold nulls.
      { name: 'category', type: 'Edm.String', filterable: true, facetable: true },
      { name: 'year', type: 'Edm.Int32', filterable: true, facetable: true },
      { name: 'tags', type: 'Collection(Edm.String)', filterable: true, facetable: true },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        hidden: true, // never returned; saves response payload
        vectorSearchDimensions: EMBEDDING_DIMENSIONS,
        vectorSearchProfileName: 'vector-profile',
      },
    ],
    vectorSearch: {
      algorithms: [{ name: 'hnsw-default', kind: 'hnsw' }],
      profiles: [{ name: 'vector-profile', algorithmConfigurationName: 'hnsw-default' }],
    },
  };
}

// Idempotent, memoized per process.
const ensured = new Map<string, Promise<void>>();

/**
 * Guarantee the index exists and is queryable — *not* that it matches
 * `buildIndexDefinition` exactly.
 *
 * The distinction matters because this module no longer owns every index it
 * reads. The corpus index (`AZURE_SEARCH_INDEX_NAME`) is created and owned by
 * the AI Search indexer pipeline in `scripts/setup-search-pipeline.ts`, whose
 * schema legitimately differs: index projections generate their own keys, so
 * its `id` field carries `analyzer: 'keyword'`, and it has `parentId` /
 * `pageNumber` / `region` fields this module never writes.
 *
 * AI Search treats existing field attributes as immutable, so pushing our
 * definition over that index fails with `CannotChangeExistingField`. That used
 * to reject the whole call and — because callers await this before serving —
 * turned a rejected *schema upgrade* into a 500 on the user's chat request.
 * An index that already exists is an index we can query, so we log and carry
 * on. Only a genuine "it isn't there" failure is fatal.
 */
export function ensureKnowledgeIndex(indexName: string): Promise<void> {
  if (onAws()) return s3v.ensureKnowledgeIndex(indexName);
  let pending = ensured.get(indexName);
  if (!pending) {
    const indexClient = getSearchIndexClient();
    pending = indexClient
      .createOrUpdateIndex(buildIndexDefinition(indexName))
      .then(() => undefined)
      .catch(async (err: unknown) => {
        // Externally-owned or already-migrated index: usable as-is.
        const exists = await indexClient
          .getIndex(indexName)
          .then(() => true)
          .catch(() => false);
        if (exists) {
          console.warn(
            `[knowledge] index "${indexName}" exists but rejected our schema ` +
              `(${err instanceof Error ? err.message : String(err)}). ` +
              `Continuing against the deployed schema.`,
          );
          return;
        }
        ensured.delete(indexName); // allow retry on transient failure
        throw err;
      });
    ensured.set(indexName, pending);
  }
  return pending;
}

function client(indexName: string): SearchClient<KnowledgeChunkDoc> {
  return getSearchClient<KnowledgeChunkDoc>(indexName);
}

const UPSERT_BATCH = 100;

export async function upsertChunks(indexName: string, docs: KnowledgeChunkDoc[]): Promise<void> {
  if (onAws()) return s3v.upsertChunks(indexName, docs);
  const search = client(indexName);
  for (let i = 0; i < docs.length; i += UPSERT_BATCH) {
    await search.mergeOrUploadDocuments(docs.slice(i, i + UPSERT_BATCH));
  }
}

export interface SearchKnowledgeParams {
  indexName: string;
  tenantId: string;
  sessionId: string;
  query: string;
  vector: number[];
  top?: number;
  /** Facet filters (manifest-driven fields). All optional, AND-combined. */
  filters?: {
    category?: string;
    year?: number;
    tags?: string[];
    sourceIds?: string[];
  };
}

function facetFilter(base: string, filters: SearchKnowledgeParams['filters']): string {
  if (!filters) return base;
  const parts = [base];
  if (filters.category) parts.push(`category eq '${escapeOData(filters.category)}'`);
  // year and tags arrive from blob metadata, which is string-only — the
  // indexer cannot coerce them, so both are stored as strings.
  if (filters.year) parts.push(`year eq '${Math.floor(filters.year)}'`);
  for (const tag of filters.tags ?? []) {
    // tags is a comma-joined string; full-text match is the exact-enough
    // equivalent of a collection membership test for slug-style tags.
    parts.push(`search.ismatch('${escapeOData(tag)}', 'tags')`);
  }
  if (filters.sourceIds && filters.sourceIds.length > 0) {
    const ors = filters.sourceIds.map((id) => `sourceId eq '${escapeOData(id)}'`).join(' or ');
    parts.push(`(${ors})`);
  }
  return parts.join(' and ');
}

/** Hybrid (keyword + vector) search scoped to one tenant + session. */
export async function searchKnowledge(params: SearchKnowledgeParams): Promise<KnowledgeHit[]> {
  if (onAws()) return s3v.searchKnowledge(params);
  const { indexName, tenantId, sessionId, query, vector, top = 8 } = params;

  const results = await client(indexName).search(query, {
    filter: facetFilter(scopeFilter(tenantId, sessionId), params.filters),
    top,
    // pageNumber is populated by the indexer pipeline only. Selecting a field
    // that holds nulls for older chunks is safe; omitting it loses the page
    // citation on every chunk that does have one.
    select: ['title', 'content', 'sourceUrl', 'sourceType', 'sourceId', 'chunkIx', 'pageNumber'],
    vectorSearchOptions: {
      queries: [
        { kind: 'vector', vector, fields: ['contentVector'], kNearestNeighborsCount: top * 2 },
      ],
    },
  });

  const hits: KnowledgeHit[] = [];
  for await (const result of results.results) {
    const doc = result.document;
    hits.push({
      score: result.score ?? 0,
      title: doc.title,
      content: doc.content,
      sourceUrl: doc.sourceUrl,
      sourceType: doc.sourceType,
      sourceId: doc.sourceId,
      chunkIx: doc.chunkIx,
      ...(typeof doc.pageNumber === 'number' && { pageNumber: doc.pageNumber }),
    });
  }
  return hits;
}

export interface SourceChunk {
  id: string;
  chunkIx: number;
  title: string;
  content: string;
}

/**
 * All chunks of one source, in order — the graph extractor's feed. Paged
 * because sources can exceed the 1000-per-search ceiling (agency statements).
 */
export async function fetchSourceChunks(
  indexName: string,
  tenantId: string,
  sessionId: string,
  sourceId: string,
  maxChunks = 2000,
): Promise<SourceChunk[]> {
  if (onAws()) return s3v.fetchSourceChunks(indexName, tenantId, sessionId, sourceId, maxChunks);
  const chunks: SourceChunk[] = [];
  const baseFilter = `${scopeFilter(tenantId, sessionId)} and sourceId eq '${escapeOData(sourceId)}'`;

  // chunkIx is sortable but not filterable (immutable legacy field attrs), so
  // page with skip/top over a stable sort instead of a range filter.
  for (let skip = 0; chunks.length < maxChunks; skip += 1000) {
    const results = await client(indexName).search('*', {
      filter: baseFilter,
      top: 1000,
      skip,
      select: ['id', 'chunkIx', 'title', 'content'],
      orderBy: ['chunkIx asc'],
    });
    let got = 0;
    for await (const result of results.results) {
      const doc = result.document;
      chunks.push({ id: doc.id, chunkIx: doc.chunkIx, title: doc.title, content: doc.content });
      got++;
      if (chunks.length >= maxChunks) break;
    }
    if (got < 1000) break;
  }
  return chunks;
}

/**
 * Distinct sources present in a session's partition, keyed by manifest id.
 *
 * Source identity is not portable between the two ingest paths. The
 * synchronous ingest mints a `randomUUID()` per run and records it on the
 * Prisma `Document` row; the Content Understanding indexer derives `sourceId`
 * from the blob path instead (base64 of the storage URL) and has no way to
 * know what Postgres called the same document. Anything that starts from a
 * `Document` row and wants its chunks — `build-graph.ts` above all — therefore
 * cannot rely on the stored id after an indexer run.
 *
 * The join is the blob filename, which `upload-corpus.ts` writes as
 * `<manifestId>.pdf`. Title looks like the obvious key and is not: blob
 * metadata is ASCII-only over HTTP headers, so a title carrying an em dash
 * arrives in the index with the character silently dropped and never matches
 * the Postgres row.
 */
export async function listIndexedSources(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<Map<string, string>> {
  if (onAws()) return s3v.listIndexedSources(indexName, tenantId, sessionId);
  const byManifestId = new Map<string, string>();
  for (let skip = 0; ; skip += 1000) {
    const results = await client(indexName).search('*', {
      filter: scopeFilter(tenantId, sessionId),
      top: 1000,
      skip,
      select: ['sourceId', 'sourceUrl'],
    });
    let got = 0;
    for await (const result of results.results) {
      const doc = result.document as { sourceId?: string; sourceUrl?: string };
      got++;
      if (!doc.sourceId || !doc.sourceUrl) continue;
      const file = decodeURIComponent(doc.sourceUrl.split('/').pop() ?? '');
      const manifestId = file.replace(/\.[^.]+$/, '');
      if (manifestId && !byManifestId.has(manifestId)) {
        byManifestId.set(manifestId, doc.sourceId);
      }
    }
    if (got < 1000) break;
  }
  return byManifestId;
}

/** Count chunks currently indexed for a session (quota enforcement). */
export async function countSessionChunks(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  if (onAws()) return s3v.countSessionChunks(indexName, tenantId, sessionId);
  const results = await client(indexName).search('*', {
    filter: scopeFilter(tenantId, sessionId),
    top: 0,
    includeTotalCount: true,
  });
  return results.count ?? 0;
}

/** Distinct sources for a session, aggregated from its chunks. */
export async function listSessionSources(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<KnowledgeSource[]> {
  if (onAws()) return s3v.listSessionSources(indexName, tenantId, sessionId);
  const results = await client(indexName).search('*', {
    filter: scopeFilter(tenantId, sessionId),
    top: 1000,
    select: ['sourceId', 'sourceType', 'sourceUrl', 'title', 'createdAt', 'chunkIx'],
  });

  const bySource = new Map<string, KnowledgeSource>();
  for await (const result of results.results) {
    const doc = result.document;
    const existing = bySource.get(doc.sourceId);
    if (existing) {
      existing.chunkCount++;
      // Prefer the crawl seed's title (chunk 0 of the first page).
      if (doc.chunkIx === 0 && doc.title) existing.title = existing.title || doc.title;
    } else {
      bySource.set(doc.sourceId, {
        sourceId: doc.sourceId,
        sourceType: doc.sourceType,
        title: doc.title,
        sourceUrl: doc.sourceUrl,
        chunkCount: 1,
        createdAt: new Date(doc.createdAt).toISOString(),
      });
    }
  }
  return [...bySource.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function deleteByFilter(indexName: string, filter: string): Promise<number> {
  const search = client(indexName);
  let deleted = 0;

  // Search returns at most 1000 ids per pass; loop until the filter is empty.
  for (let pass = 0; pass < 20; pass++) {
    const results = await search.search('*', { filter, top: 1000, select: ['id'] });
    const ids: string[] = [];
    for await (const result of results.results) ids.push(result.document.id);
    if (ids.length === 0) break;
    await search.deleteDocuments(
      'id',
      ids.map((id) => id),
    );
    deleted += ids.length;
    if (ids.length < 1000) break;
  }
  return deleted;
}

/** Remove every chunk belonging to a session (reset / cleanup). */
export function deleteSession(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  if (onAws()) return s3v.deleteSession(indexName, tenantId, sessionId);
  return deleteByFilter(indexName, scopeFilter(tenantId, sessionId));
}

/** Remove chunks older than `maxAgeHours` for a tenant (playground TTL sweep). */
export function purgeExpired(
  indexName: string,
  tenantId: string,
  maxAgeHours: number,
): Promise<number> {
  if (onAws()) return s3v.purgeExpired(indexName, tenantId, maxAgeHours);
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  return deleteByFilter(
    indexName,
    `tenantId eq '${escapeOData(tenantId)}' and createdAt lt ${cutoff}`,
  );
}
