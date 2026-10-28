/**
 * Knowledge store on Amazon S3 Vectors — the AWS twin of the AI Search
 * functions in `store.ts`, with the same signatures and partitioning.
 *
 * Each chunk is one vector keyed by its chunk id. Scope and facet fields are
 * filterable metadata; the passage text, title and URL are non-filterable
 * (they exceed the 2 KB filterable budget and are only ever returned).
 *
 * Differences from AI Search worth knowing:
 * - Retrieval is vector-only; there is no BM25 half to the query.
 * - Indexes in buckets created after 2026-09-30 are ENHANCED: the tenant
 *   filter runs before the search, so a small tenant still gets a full top K.
 * - There is no "list by filter". The source/count/delete operations scan the
 *   index with parallel ListVectors and filter in code — fine at corpus scale
 *   (thousands of chunks), and the playground lives in its own small index.
 */
import {
  CreateIndexCommand,
  DeleteVectorsCommand,
  GetIndexCommand,
  ListVectorsCommand,
  PutVectorsCommand,
  QueryVectorsCommand,
  type QueryVectorsCommandInput,
} from '@aws-sdk/client-s3vectors';
import { AWS_RESOURCES, getS3VectorsClient } from '../clients/aws.js';
import { titanDimensions } from '../clients/bedrock-embeddings.js';
import type {
  KnowledgeChunkDoc,
  KnowledgeHit,
  KnowledgeSource,
  SearchKnowledgeParams,
  SourceChunk,
} from './store.js';

/** Vector width of every Horus index on AWS (Titan V2: 256, 512 or 1024). */
export const S3_VECTOR_DIMENSIONS = titanDimensions(
  Number(process.env.HORUS_VECTOR_DIMENSIONS) || 1024,
);

const NON_FILTERABLE_KEYS = ['content', 'title', 'sourceUrl'];
const PUT_BATCH = 200;
const DELETE_BATCH = 500;
const SCAN_SEGMENTS = 4;
/** ENHANCED indexes allow 100 constraints per filter; leave room for scope + facets. */
const MAX_SOURCE_ID_FILTER = 90;

interface ChunkMetadata {
  tenantId: string;
  sessionId: string;
  sourceId: string;
  sourceType: 'url' | 'pdf';
  chunkIx: number;
  /** Epoch milliseconds — numeric so it could be range-filtered. */
  createdAt: number;
  category?: string;
  year?: number;
  tags?: string[];
  pageNumber?: number;
  content: string;
  title: string;
  sourceUrl: string;
}

interface ScannedVector {
  key: string;
  meta: ChunkMetadata;
}

const bucket = (): string => AWS_RESOURCES.vectorBucket();

/** The SDK's JSON document type, used for both metadata and filters. */
type Document = NonNullable<QueryVectorsCommandInput['filter']>;
type Filter = { [key: string]: Document };

function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === 'NotFoundException';
}

const ensured = new Map<string, Promise<void>>();

export function ensureKnowledgeIndex(indexName: string): Promise<void> {
  let pending = ensured.get(indexName);
  if (!pending) {
    const client = getS3VectorsClient();
    pending = client
      .send(new GetIndexCommand({ vectorBucketName: bucket(), indexName }))
      .then(() => undefined)
      .catch(async (err: unknown) => {
        if (!isNotFound(err)) throw err;
        await client.send(
          new CreateIndexCommand({
            vectorBucketName: bucket(),
            indexName,
            dataType: 'float32',
            dimension: S3_VECTOR_DIMENSIONS,
            distanceMetric: 'cosine',
            metadataConfiguration: { nonFilterableMetadataKeys: NON_FILTERABLE_KEYS },
          }),
        );
      })
      .catch((err: unknown) => {
        ensured.delete(indexName); // allow retry after a transient failure
        throw err;
      });
    ensured.set(indexName, pending);
  }
  return pending;
}

/** Blob-metadata facets arrive as strings ("2026", "a,b"); store them typed. */
function normalizeYear(year: unknown): number | undefined {
  const n = typeof year === 'number' ? year : Number(year);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function normalizeTags(tags: unknown): string[] | undefined {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : [];
  const clean = list.map((t) => String(t).trim()).filter(Boolean);
  return clean.length > 0 ? clean : undefined;
}

function toMetadata(doc: KnowledgeChunkDoc): ChunkMetadata {
  const year = normalizeYear(doc.year);
  const tags = normalizeTags(doc.tags);
  return {
    tenantId: doc.tenantId,
    sessionId: doc.sessionId,
    sourceId: doc.sourceId,
    sourceType: doc.sourceType,
    chunkIx: doc.chunkIx,
    createdAt: new Date(doc.createdAt).getTime(),
    ...(doc.category && { category: doc.category }),
    ...(year && { year }),
    ...(tags && { tags }),
    ...(typeof doc.pageNumber === 'number' && { pageNumber: doc.pageNumber }),
    content: doc.content,
    title: doc.title,
    sourceUrl: doc.sourceUrl,
  };
}

// Source listings feed every chat turn's instructions; a short cache keeps a
// full-index scan off the hot path. Writes in this process invalidate it.
const SOURCES_TTL_MS = 60_000;
const sourcesCache = new Map<string, { at: number; sources: KnowledgeSource[] }>();

function invalidateSources(indexName: string): void {
  for (const key of sourcesCache.keys()) {
    if (key.startsWith(`${indexName}|`)) sourcesCache.delete(key);
  }
}

export async function upsertChunks(indexName: string, docs: KnowledgeChunkDoc[]): Promise<void> {
  const client = getS3VectorsClient();
  for (let i = 0; i < docs.length; i += PUT_BATCH) {
    await client.send(
      new PutVectorsCommand({
        vectorBucketName: bucket(),
        indexName,
        vectors: docs.slice(i, i + PUT_BATCH).map((doc) => ({
          key: doc.id,
          data: { float32: doc.contentVector },
          metadata: toMetadata(doc) as unknown as Document,
        })),
      }),
    );
  }
  invalidateSources(indexName);
}

function scopeFilter(tenantId: string, sessionId: string): Filter[] {
  return [{ tenantId: { $eq: tenantId } }, { sessionId: { $eq: sessionId } }];
}

export async function searchKnowledge(params: SearchKnowledgeParams): Promise<KnowledgeHit[]> {
  const { indexName, tenantId, sessionId, vector, top = 8, filters } = params;
  const clauses = scopeFilter(tenantId, sessionId);
  if (filters?.category) clauses.push({ category: { $eq: filters.category } });
  if (filters?.year) clauses.push({ year: { $eq: Math.floor(filters.year) } });
  // $eq against a list matches when any element equals the value.
  for (const tag of filters?.tags ?? []) clauses.push({ tags: { $eq: tag } });

  const sourceIds = filters?.sourceIds ?? [];
  const filterSourcesServerSide = sourceIds.length > 0 && sourceIds.length <= MAX_SOURCE_ID_FILTER;
  if (filterSourcesServerSide) clauses.push({ sourceId: { $in: sourceIds } });
  // Too many ids for one filter: over-fetch within the scope, narrow here.
  const wanted = sourceIds.length > 0 && !filterSourcesServerSide ? new Set(sourceIds) : null;

  const hits: KnowledgeHit[] = [];
  // Results arrive at most 100 per page; only the over-fetch path pages.
  let nextToken: string | undefined;
  do {
    const res = await getS3VectorsClient().send(
      new QueryVectorsCommand({
        vectorBucketName: bucket(),
        indexName,
        topK: wanted ? Math.min(top * 10, 1000) : top,
        queryVector: { float32: vector },
        filter: { $and: clauses },
        returnMetadata: true,
        returnDistance: true,
        ...(nextToken && { nextToken }),
      }),
    );
    for (const v of res.vectors ?? []) {
      const meta = v.metadata as ChunkMetadata | undefined;
      if (!meta) continue;
      if (wanted && !wanted.has(meta.sourceId)) continue;
      hits.push({
        // Cosine distance → similarity, so higher is better as on AI Search.
        score: 1 - (v.distance ?? 1),
        title: meta.title,
        content: meta.content,
        sourceUrl: meta.sourceUrl,
        sourceType: meta.sourceType,
        sourceId: meta.sourceId,
        chunkIx: meta.chunkIx,
        ...(typeof meta.pageNumber === 'number' && { pageNumber: meta.pageNumber }),
      });
      if (hits.length >= top) return hits;
    }
    nextToken = res.nextToken;
  } while (nextToken);
  return hits;
}

/** Every vector in the index with its metadata, via parallel segments. */
async function scanIndex(
  indexName: string,
  keep: (meta: ChunkMetadata) => boolean,
): Promise<ScannedVector[]> {
  const client = getS3VectorsClient();
  const segments = await Promise.all(
    Array.from({ length: SCAN_SEGMENTS }, async (_, segmentIndex) => {
      const found: ScannedVector[] = [];
      let nextToken: string | undefined;
      do {
        const page = await client.send(
          new ListVectorsCommand({
            vectorBucketName: bucket(),
            indexName,
            maxResults: 1000,
            segmentCount: SCAN_SEGMENTS,
            segmentIndex,
            returnMetadata: true,
            ...(nextToken && { nextToken }),
          }),
        );
        for (const v of page.vectors ?? []) {
          const meta = v.metadata as ChunkMetadata | undefined;
          if (v.key && meta && keep(meta)) found.push({ key: v.key, meta });
        }
        nextToken = page.nextToken;
      } while (nextToken);
      return found;
    }),
  );
  return segments.flat();
}

const inScope =
  (tenantId: string, sessionId: string) =>
  (meta: ChunkMetadata): boolean =>
    meta.tenantId === tenantId && meta.sessionId === sessionId;

export async function fetchSourceChunks(
  indexName: string,
  tenantId: string,
  sessionId: string,
  sourceId: string,
  maxChunks = 2000,
): Promise<SourceChunk[]> {
  const scoped = inScope(tenantId, sessionId);
  const rows = await scanIndex(indexName, (meta) => scoped(meta) && meta.sourceId === sourceId);
  return rows
    .sort((a, b) => a.meta.chunkIx - b.meta.chunkIx)
    .slice(0, maxChunks)
    .map(({ key, meta }) => ({
      id: key,
      chunkIx: meta.chunkIx,
      title: meta.title,
      content: meta.content,
    }));
}

/** Manifest id (blob/object filename without extension) → sourceId. */
export async function listIndexedSources(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<Map<string, string>> {
  const byManifestId = new Map<string, string>();
  for (const { meta } of await scanIndex(indexName, inScope(tenantId, sessionId))) {
    const file = decodeURIComponent(meta.sourceUrl.split('/').pop() ?? '');
    const manifestId = file.replace(/\.[^.]+$/, '');
    if (manifestId && !byManifestId.has(manifestId)) byManifestId.set(manifestId, meta.sourceId);
  }
  return byManifestId;
}

export async function countSessionChunks(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  return (await scanIndex(indexName, inScope(tenantId, sessionId))).length;
}

export async function listSessionSources(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<KnowledgeSource[]> {
  const cacheKey = `${indexName}|${tenantId}|${sessionId}`;
  const cached = sourcesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SOURCES_TTL_MS) return cached.sources;

  const bySource = new Map<string, KnowledgeSource>();
  for (const { meta } of await scanIndex(indexName, inScope(tenantId, sessionId))) {
    const existing = bySource.get(meta.sourceId);
    if (existing) {
      existing.chunkCount++;
      // Prefer the crawl seed's title (chunk 0 of the first page).
      if (meta.chunkIx === 0 && meta.title) existing.title = existing.title || meta.title;
    } else {
      bySource.set(meta.sourceId, {
        sourceId: meta.sourceId,
        sourceType: meta.sourceType,
        title: meta.title,
        sourceUrl: meta.sourceUrl,
        chunkCount: 1,
        createdAt: new Date(meta.createdAt).toISOString(),
      });
    }
  }
  const sources = [...bySource.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  sourcesCache.set(cacheKey, { at: Date.now(), sources });
  return sources;
}

async function deleteKeys(indexName: string, keys: string[]): Promise<number> {
  const client = getS3VectorsClient();
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    await client.send(
      new DeleteVectorsCommand({
        vectorBucketName: bucket(),
        indexName,
        keys: keys.slice(i, i + DELETE_BATCH),
      }),
    );
  }
  invalidateSources(indexName);
  return keys.length;
}

export async function deleteSession(
  indexName: string,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  const rows = await scanIndex(indexName, inScope(tenantId, sessionId));
  return deleteKeys(
    indexName,
    rows.map((r) => r.key),
  );
}

export async function purgeExpired(
  indexName: string,
  tenantId: string,
  maxAgeHours: number,
): Promise<number> {
  const cutoff = Date.now() - maxAgeHours * 3_600_000;
  const rows = await scanIndex(
    indexName,
    (meta) => meta.tenantId === tenantId && meta.createdAt < cutoff,
  );
  return deleteKeys(
    indexName,
    rows.map((r) => r.key),
  );
}
