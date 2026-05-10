import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

function readEnv(): SupabaseEnv {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY in environment');
  }
  return {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export type CookieStore = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: CookieOptions): void;
  remove(name: string, options: CookieOptions): void;
};

/** Server-side Supabase client bound to a request cookie store (Next.js RSC / route handlers). */
export function createServerSupabase(cookies: CookieStore) {
  const env = readEnv();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      get: (name: string) => cookies.get(name)?.value,
      set: (name: string, value: string, options: Record<string, unknown>) =>
        cookies.set(name, value, options),
      remove: (name: string, options: Record<string, unknown>) => cookies.remove(name, options),
    },
  });
}

/** Service-role client. Server-only. Bypasses RLS. Use sparingly. */
export function createServiceRoleSupabase(): SupabaseClient {
  const env = readEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for service-role client');
  }
  return createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
