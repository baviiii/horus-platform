/**
 * Client-safe mirrors of the playground SSE event shapes.
 * Server truth lives in @horus/core (knowledge/ingest.ts, agent/run.ts);
 * these stay dependency-free so the browser bundle never touches core.
 */

export interface KnowledgeSourceView {
  sourceId: string;
  sourceType: 'url' | 'pdf';
  title: string;
  sourceUrl: string;
  chunkCount: number;
  createdAt: string;
}

export interface PlaygroundLimits {
  maxSources: number;
  maxPagesPerCrawl: number;
  maxPdfMb: number;
  sessionTtlHours: number;
}

export interface AgentCitationView {
  n: number;
  title: string;
  url?: string;
  sourceType: 'url' | 'pdf' | 'web';
  snippet: string;
}

export type IngestSse =
  | { kind: 'status'; message: string }
  | { kind: 'page'; url: string; title: string; count: number }
  | { kind: 'chunked'; chunks: number }
  | { kind: 'embedding'; done: number; total: number }
  | { kind: 'done'; source: KnowledgeSourceView; pageCount: number }
  | { kind: 'error'; message: string };

export type ChatSse =
  | { kind: 'token'; text: string }
  | { kind: 'tool'; name: string; status: 'start' | 'end'; detail?: string }
  | { kind: 'citations'; citations: AgentCitationView[] }
  | { kind: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { kind: 'error'; message: string };

/** Iterate `data:` JSON frames from a fetch()ed SSE response. */
export async function* readSse<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              yield JSON.parse(line.slice(6)) as T;
            } catch {
              /* skip malformed frame */
            }
          }
        }
        frameEnd = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
