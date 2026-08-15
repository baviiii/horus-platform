import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, createTRPCContext } from '@horus/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Model-backed mutations (incidents.absorbTemplate / incidents.draft) run
// long single-shot completions — give them the same headroom as agent chat.
export const maxDuration = 120;

async function handler(req: Request) {
  const user = await getCurrentUser();

  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () =>
      createTRPCContext({
        headers: req.headers,
        supabaseUser: user ? { id: user.id, email: user.email ?? null } : null,
      }),
    onError({ path, error }) {
      if (process.env.NODE_ENV === 'development') {
        console.error(`tRPC error on ${path ?? '<no-path>'}:`, error);
      }
    },
  });
}

export { handler as GET, handler as POST };
