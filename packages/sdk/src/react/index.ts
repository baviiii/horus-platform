import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@horus/api';

/**
 * React-Query bindings for the Horus SDK.
 *
 * Usage:
 *   ```tsx
 *   import { horusReact } from '@horus/sdk/react';
 *   const { data } = horusReact.rag.metadata.useQuery({ operation: 'stats' });
 *   ```
 *
 * Pair with a `<HorusProvider>` that wires up the trpc + react-query providers.
 */
export const horusReact = createTRPCReact<AppRouter>();

export type { AppRouter };
