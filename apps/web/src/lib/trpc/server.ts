import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { appRouter, createTRPCContext, createCaller } from '@horus/api';
import { getCurrentUser } from '@/lib/supabase/server';

export const getServerCaller = cache(async () => {
  const heads = new Headers(await headers());
  heads.set('x-trpc-source', 'rsc');

  const user = await getCurrentUser();
  const ctx = await createTRPCContext({
    headers: heads,
    supabaseUser: user ? { id: user.id, email: user.email ?? null } : null,
  });

  return createCaller(appRouter)(ctx);
});
