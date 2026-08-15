/**
 * Ingestion orchestrators: source → extract → chunk → embed → index.
 *
 * Both flows emit progress events so API routes can stream ingestion state
 * to the browser (crawling → chunking → embedding → indexing → ready).
 */
import { randomUUID } from 'node:crypto';
import { crawlSite } from './crawl.js';
import { extractPdf } from './extract-pdf.js';
import { chunkText } from './chunk.js';
import { embedTexts } from './embeddings.js';
import { moderateTexts } from '../safety/content-safety.js';
import {
  ensureKnowledgeIndex,
  upsertChunks,
  type ChunkMeta,
  type KnowledgeChunkDoc,
  type KnowledgeSource,
} from './store.js';

export type IngestEvent =
  | { kind: 'status'; message: string }
  | { kind: 'page'; url: string; title: string; count: number }
  | { kind: 'chunked'; chunks: number }
  | { kind: 'embedding'; done: number; total: number }
  | { kind: 'done'; source: KnowledgeSource; pageCount: number };

export type IngestEmit = (event: IngestEvent) => void;

interface ScopeParams {
  indexName: string;
  tenantId: string;
  sessionId: string;
  /** Corpus facets stamped on every chunk (category/year/tags). */
  meta?: ChunkMeta;
}

interface PendingChunk {
  text: string;
  chunkIx: number;
  sourceUrl: string;
  title: string;
}

const EMBED_PROGRESS_SLICE = 32;

async function embedAndIndex(
  scope: ScopeParams,
  sourceId: string,
  sourceType: 'url' | 'pdf',
  pending: PendingChunk[],
  emit: IngestEmit,
): Promise<void> {
  const now = new Date();
  const docs: KnowledgeChunkDoc[] = [];

  for (let i = 0; i < pending.length; i += EMBED_PROGRESS_SLICE) {
    const slice = pending.slice(i, i + EMBED_PROGRESS_SLICE);
    const vectors = await embedTexts(slice.map((c) => c.text));
    slice.forEach((chunk, j) => {
      docs.push({
        // AI Search keys allow only letters, digits, _, -, = — never ':'.
        id: `${scope.sessionId}_${sourceId}_${chunk.chunkIx}`,
        tenantId: scope.tenantId,
        sessionId: scope.sessionId,
        sourceId,
        sourceType,
        sourceUrl: chunk.sourceUrl,
        title: chunk.title,
        content: chunk.text,
        contentVector: vectors[j]!,
        chunkIx: chunk.chunkIx,
        createdAt: now,
        ...(scope.meta?.category && { category: scope.meta.category }),
        ...(scope.meta?.year && { year: scope.meta.year }),
        ...(scope.meta?.tags && scope.meta.tags.length > 0 && { tags: scope.meta.tags }),
      });
    });
    emit({
      kind: 'embedding',
      done: Math.min(i + slice.length, pending.length),
      total: pending.length,
    });
  }

  emit({ kind: 'status', message: 'Indexing…' });
  await upsertChunks(scope.indexName, docs);
}

export interface IngestUrlParams extends ScopeParams {
  url: string;
  maxPages?: number;
  maxChunks?: number;
  emit: IngestEmit;
}

export async function ingestUrl(params: IngestUrlParams): Promise<KnowledgeSource> {
  const { emit, maxChunks = 300 } = params;
  const sourceId = randomUUID();

  await ensureKnowledgeIndex(params.indexName);

  emit({ kind: 'status', message: 'Crawling site…' });
  const crawl = await crawlSite(params.url, {
    maxPages: params.maxPages,
    onPage: (page, count) => emit({ kind: 'page', url: page.url, title: page.title, count }),
  });

  if (crawl.pages.length === 0) {
    throw new Error(
      'No readable pages found at that URL (blocked by robots.txt, non-HTML, or empty content).',
    );
  }

  emit({ kind: 'status', message: 'Screening content…' });
  const verdict = await moderateTexts(crawl.pages.map((p) => p.text));
  if (verdict.blocked) {
    throw new Error(`This site was blocked by the content policy (${verdict.category}).`);
  }

  // Chunk page-by-page so every chunk cites the exact page it came from.
  const pending: PendingChunk[] = [];
  let chunkIx = 0;
  for (const page of crawl.pages) {
    if (pending.length >= maxChunks) break;
    for (const chunk of chunkText(page.text)) {
      if (pending.length >= maxChunks) break;
      pending.push({
        text: chunk.text,
        chunkIx: chunkIx++,
        sourceUrl: page.url,
        title: page.title,
      });
    }
  }
  if (pending.length === 0) {
    throw new Error('Crawled pages contained no indexable text.');
  }
  emit({ kind: 'chunked', chunks: pending.length });

  await embedAndIndex(params, sourceId, 'url', pending, emit);

  const seedPage = crawl.pages[0]!;
  const source: KnowledgeSource = {
    sourceId,
    sourceType: 'url',
    title: seedPage.title || new URL(seedPage.url).hostname,
    sourceUrl: seedPage.url,
    chunkCount: pending.length,
    createdAt: new Date().toISOString(),
  };
  emit({ kind: 'done', source, pageCount: crawl.pages.length });
  return source;
}

export interface IngestPdfParams extends ScopeParams {
  filename: string;
  data: Uint8Array;
  maxChunks?: number;
  emit: IngestEmit;
}

export async function ingestPdf(params: IngestPdfParams): Promise<KnowledgeSource> {
  const { emit, maxChunks = 300 } = params;
  const sourceId = randomUUID();

  await ensureKnowledgeIndex(params.indexName);

  emit({ kind: 'status', message: 'Extracting text…' });
  const pdf = await extractPdf(params.data);

  if (pdf.text.length < 200) {
    throw new Error(
      'Could not extract text — this looks like a scanned/image PDF. OCR support (Azure Document Intelligence) is on the roadmap.',
    );
  }

  emit({ kind: 'status', message: 'Screening content…' });
  const verdict = await moderateTexts([pdf.text]);
  if (verdict.blocked) {
    throw new Error(`This document was blocked by the content policy (${verdict.category}).`);
  }

  const title = params.filename.replace(/\.pdf$/i, '');
  const sourceUrl = `pdf:${params.filename}`;
  const pending: PendingChunk[] = chunkText(pdf.text)
    .slice(0, maxChunks)
    .map((chunk) => ({ text: chunk.text, chunkIx: chunk.ix, sourceUrl, title }));

  if (pending.length === 0) {
    throw new Error('PDF contained no indexable text.');
  }
  emit({ kind: 'chunked', chunks: pending.length });

  await embedAndIndex(params, sourceId, 'pdf', pending, emit);

  const source: KnowledgeSource = {
    sourceId,
    sourceType: 'pdf',
    title,
    sourceUrl,
    chunkCount: pending.length,
    createdAt: new Date().toISOString(),
  };
  emit({ kind: 'done', source, pageCount: pdf.pageCount });
  return source;
}
