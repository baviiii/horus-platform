'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getClientEnv } from '@/env';

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (cached) return cached;
  const env = getClientEnv();
  cached = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return cached;
}
