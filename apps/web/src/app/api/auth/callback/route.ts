import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * OAuth / magic-link / password-recovery callback.
 *
 * Supabase redirects here with either:
 *   - `?code=...`            → PKCE code to exchange for a session, or
 *   - `?error=...&error_description=...` → the provider or Supabase rejected it.
 *
 * We land the user on `next` on success, or bounce back to /login with a
 * readable message on failure.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  // Provider-side failure (user cancelled, provider misconfigured, etc.).
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(oauthError)}`, url));
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, url),
      );
    }
  }

  // Only allow same-origin relative redirects — never an attacker-supplied URL.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(new URL(safeNext, url));
}
