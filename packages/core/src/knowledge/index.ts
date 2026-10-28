// Knowledge pipeline — ingest (crawl/PDF → chunk → embed → index) and
// retrieval over Azure AI Search (hybrid) or S3 Vectors (vector-only),
// scoped by tenant + session.

export { chunkText, type ChunkOptions, type TextChunk } from './chunk.js';
export {
  crawlSite,
  CRAWLER_USER_AGENT,
  type CrawlOptions,
  type CrawledPage,
  type CrawlResult,
} from './crawl.js';
export { embedQuery, embedTexts } from './embeddings.js';
export { extractHtml, normalizeUrl, type ExtractedPage } from './extract-html.js';
export { extractPdf, type ExtractedPdf } from './extract-pdf.js';
export { extractDocx, type ExtractedDocx } from './extract-docx.js';
export { blockedUrlReason } from './net-guard.js';
export {
  ingestPdf,
  ingestUrl,
  type IngestEmit,
  type IngestEvent,
  type IngestPdfParams,
  type IngestUrlParams,
} from './ingest.js';
export {
  EMBEDDING_DIMENSIONS,
  countSessionChunks,
  deleteSession,
  ensureKnowledgeIndex,
  fetchSourceChunks,
  listIndexedSources,
  listSessionSources,
  purgeExpired,
  searchKnowledge,
  upsertChunks,
  type ChunkMeta,
  type KnowledgeChunkDoc,
  type KnowledgeHit,
  type KnowledgeSource,
  type SearchKnowledgeParams,
  type SourceChunk,
} from './store.js';
export { S3_VECTOR_DIMENSIONS } from './store-s3vectors.js';
