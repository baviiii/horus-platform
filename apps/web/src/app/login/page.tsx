'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const errorParam = params.get('error');
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(errorParam);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handleGoogle() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-8 py-16">
        <div className="space-y-2 text-center">
          <Link href="/" className="font-mono text-lg font-semibold">
            horus
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h1>
        </div>

        {sent ? (
          <div className="rounded-md border bg-muted/40 p-6 text-sm">
            Check your email for a magic link. You can close this tab.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@company.com"
              />
            </label>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending…' : 'Send magic link'}
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="relative py-2 text-center text-xs uppercase text-muted-foreground">
              <span className="bg-background px-2">or</span>
              <hr className="absolute inset-x-0 top-1/2 -z-10 -translate-y-1/2" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogle}
            >
              Continue with Google
            </Button>
          </form>
        )}
        <p className="text-center text-xs text-muted-foreground">
          By signing in you agree to our{' '}
          <Link href="/terms" className="underline">
            terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
