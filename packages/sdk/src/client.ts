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
  /** Override the API base URL. Defaults to `https://api.horus.ai`. */
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

const DEFAULT_BASE_URL = 'https://api.horus.ai';

export function createHorusClient(config: HorusClientConfig): HorusClient {
  if (!config.apiKey) {
    throw new Error('createHorusClient: apiKey is required');
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

  return createTRPCClient<AppRouter>({
    links: [
      ...(config.debug ? [loggerLink()] : []),
      httpBatchLink({
        url: `${baseUrl}/trpc`,
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
