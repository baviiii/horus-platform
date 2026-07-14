/**
 * Knowledge store on Azure AI Search.
 *
 * One index holds chunked, embedded knowledge partitioned by tenantId +
 * sessionId (the playground uses tenant "playground" with ephemeral
 * sessions; real tenants later get index-per-tenant with the same shape).
 *
 * Retrieval is hybrid: BM25 keyword + HNSW vector in one query. Semantic
 * reranking is intentionally not requested — unavailable on the free tier.
 */
import type { SearchClient, SearchIndex } from '@azure/search-documents';
import { getSearchClient, getSearchIndexClient } from '../clients/azure-search.js';

export const EMBEDDING_DIMENSIONS = 3072;

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
}

export interface KnowledgeHit {
  score: number;
  title: string;
  content: string;
  sourceUrl: string;
  sourceType: 'url' | 'pdf';
  sourceId: string;
  chunkIx: number;
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
      { name: 'chunkIx', type: 'Edm.Int32', sortable: true },
      { name: 'createdAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
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

// Idempotent, memoized per process — the app owns its index schema the same
// way it owns Prisma migrations.
const ensured = new Map<string, Promise<void>>();

export function ensureKnowledgeIndex(indexName: string): Promise<void> {
  let pending = ensured.get(indexName);
  if (!pending) {
    pending = getSearchIndexClient()
      .createOrUpdateIndex(buildIndexDefinition(indexName))
      .then(() => undefined)
      .catch((err) => {
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
}

/** Hybrid (keyword + vector) search scoped to one tenant + session. */
export async function searchKnowledge(params: SearchKnowledgeParams): Promise<KnowledgeHit[]> {
  const { indexName, tenantId, sessionId, query, vector, top = 8 } = params;

  const results = await client(indexName).search(query, {
    filter: scopeFilter(tenantId, sessionId),
    top,
    select: ['title', 'content', 'sourceUrl', 'sourceType', 'sourceId', 'chunkIx'],
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
    });
  }
  return hits;
}

/** Count chunks currently indexed for a session (quota enforcement). */
export async function countSessionChunks(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<number> {
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
  return deleteByFilter(indexName, scopeFilter(tenantId, sessionId));
}

/** Remove chunks older than `maxAgeHours` for a tenant (playground TTL sweep). */
export function purgeExpired(
  indexName: string,
  tenantId: string,
  maxAgeHours: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3_600_000).toISOString();
  return deleteByFilter(
    indexName,
    `tenantId eq '${escapeOData(tenantId)}' and createdAt lt ${cutoff}`,
  );
}
