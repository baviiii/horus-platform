import {
  createTRPCClient,
  httpBatchLink,
  loggerLink,
  type TRPCClient,
  type TRPCClientErrorLike,
} from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@horus/api';

export type HorusClientConfig = {
  /** Your Horus API key — `horus_sk_live_...` or `horus_sk_test_...` */
  apiKey: string;
  /**
   * Base URL of your Horus deployment, e.g. `https://horus.example.com`.
   * Falls back to `HORUS_BASE_URL` from the environment. No default: pointing
   * at a host that does not exist fails as a confusing network error rather
   * than a clear configuration one.
   */
  baseUrl?: string;
  /** Headers added to every request. */
  headers?: Record<string, string>;
  /** Custom fetch implementation. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Enable verbose console logging. Default false. */
  debug?: boolean;
};

export type HorusClient = TRPCClient<AppRouter>;
export type HorusError = TRPCClientErrorLike<AppRouter>;

/** Where the Next.js app mounts the tRPC handler. Must match the route. */
const TRPC_PATH = '/api/trpc';

function resolveBaseUrl(configured?: string): string {
  const fromEnv = typeof process !== 'undefined' ? process.env?.HORUS_BASE_URL : undefined;
  const baseUrl = configured ?? fromEnv;
  if (!baseUrl) {
    throw new Error(
      'createHorusClient: baseUrl is required (or set HORUS_BASE_URL). ' +
        'Example: https://horus.example.com',
    );
  }
  return baseUrl.replace(/\/$/, '');
}

export function createHorusClient(config: HorusClientConfig): HorusClient {
  if (!config.apiKey) {
    throw new Error('createHorusClient: apiKey is required');
  }
  const baseUrl = resolveBaseUrl(config.baseUrl);

  return createTRPCClient<AppRouter>({
    links: [
      ...(config.debug ? [loggerLink()] : []),
      httpBatchLink({
        url: `${baseUrl}${TRPC_PATH}`,
        transformer: superjson,
        fetch: config.fetch,
        headers() {
          return {
            authorization: `Bearer ${config.apiKey}`,
            'x-horus-sdk': 'ts/0.1.0',
            ...(config.headers ?? {}),
          };
        },
      }),
    ],
  });
}

/* ── Streaming chat ────────────────────────────────────────────────────── */

export type HorusChatEvent =
  | { kind: 'session'; id: string }
  | { kind: 'token'; text: string }
  | { kind: 'tool'; name: string; status: 'start' | 'end'; detail?: string }
  | { kind: 'citations'; citations: unknown[] }
  | { kind: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { kind: 'error'; message: string };

export type HorusChatParams = {
  message: string;
  /** Continue an existing conversation. Sessions are scoped to your API key. */
  sessionId?: string;
  model?: 'fast' | 'deep';
  signal?: AbortSignal;
};

/**
 * Stream a grounded chat answer token by token.
 *
 * Not part of the tRPC surface: tRPC returns whole values, and this is a live
 * token stream over Server-Sent Events. Use `client.rag.chat.mutate()` when a
 * complete answer is fine and you would rather stay in one protocol.
 */
export async function* streamHorusChat(
  config: HorusClientConfig,
  params: HorusChatParams,
): AsyncGenerator<HorusChatEvent> {
  const baseUrl = resolveBaseUrl(config.baseUrl);
  const doFetch = config.fetch ?? fetch;

  const res = await doFetch(`${baseUrl}/api/sdk/chat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      'x-horus-sdk': 'ts/0.1.0',
      ...(config.headers ?? {}),
    },
    body: JSON.stringify({
      message: params.message,
      ...(params.sessionId && { sessionId: params.sessionId }),
      model: params.model ?? 'fast',
    }),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Horus chat failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a partial frame stays buffered.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as HorusChatEvent;
      } catch {
        // A malformed frame is not worth killing the stream over.
      }
    }
  }
}
