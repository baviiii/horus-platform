'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Container, Wordmark } from '@/components/horus';
import { Aurora, Magnetic } from '@/components/motion';

export default function LoginPage() {
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
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) setError(error.message);
      else setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send the link.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  }

  return (
    <Aurora intensity={1.2}>
      <main className="bg-paper relative flex min-h-screen flex-col">
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="bg-wash pointer-events-none absolute inset-0" />

        <header className="relative z-10">
          <Container size="wide" className="flex h-16 items-center justify-between">
            <Link href="/" className="transition-opacity hover:opacity-80">
              <Wordmark size="sm" />
            </Link>
            <Link
              href="/signup"
              className="text-ink-faded hover:text-ink text-[13px] font-medium transition-colors"
            >
              New here?{' '}
              <span className="text-ink underline-offset-4 hover:underline">Create an account</span>
            </Link>
          </Container>
        </header>

        <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-24 pt-12">
          <div className="animate-rise w-full max-w-[420px]">
            <div className="mb-9 text-center">
              <h1 className="text-ink text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
                <span className="text-display">Sign in to</span>{' '}
                <span className="serif-italic text-cobalt font-normal">Horus.</span>
              </h1>
              <p className="text-ink-faded mt-3 text-[15px]">
                We'll email you a single-use link. No passwords.
              </p>
            </div>

            <div className="border-hairline bg-paper/80 relative rounded-3xl border p-8 shadow-md backdrop-blur-xl">
              <div className="from-accent/15 pointer-events-none absolute -inset-px -z-10 rounded-3xl bg-gradient-to-b via-transparent to-transparent blur-xl" />
              {sent ? (
                <div className="space-y-5 text-center">
                  <div className="bg-accent/10 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 22 22"
                      fill="none"
                      className="text-accent"
                    >
                      <path
                        d="M3 6l8 6 8-6M3 6v10a1 1 0 001 1h14a1 1 0 001-1V6M3 6a1 1 0 011-1h14a1 1 0 011 1"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h2 className="text-ink text-2xl font-semibold tracking-tight">
                    Check your inbox
                  </h2>
                  <p className="text-ink-faded text-[14px] leading-relaxed">
                    We sent a sign-in link to <span className="text-ink font-medium">{email}</span>.
                    <br />
                    It expires in 1 hour.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="text-accent text-[13px] font-medium underline-offset-4 hover:underline"
                  >
                    Use a different email
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <button
                    type="button"
                    onClick={handleGoogle}
                    className="border-hairline-strong bg-paper text-ink hover:bg-paper-soft flex h-11 w-full items-center justify-center gap-2.5 rounded-full border text-[14px] font-medium transition-colors"
                  >
                    <GoogleIcon />
                    Continue with Google
                  </button>

                  <div className="text-ink-mute flex items-center gap-3 text-[11px] uppercase tracking-[0.2em]">
                    <span className="bg-hairline h-px flex-1" />
                    <span>or</span>
                    <span className="bg-hairline h-px flex-1" />
                  </div>

                  <label className="block">
                    <span className="text-ink text-[13px] font-medium">Email</span>
                    <div className="focus-ring mt-1.5 rounded-xl">
                      <input
                        type="email"
                        required
                        autoFocus
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        className="border-hairline-strong bg-paper text-ink placeholder:text-ink-mute focus:border-accent block h-11 w-full rounded-xl border px-4 text-[15px] transition-colors focus:outline-none"
                      />
                    </div>
                  </label>

                  <Magnetic strength={5}>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-ink text-paper shadow-blue hover:shadow-blue-lg group relative flex h-11 w-full items-center justify-center gap-1 overflow-hidden rounded-full text-[14px] font-medium transition-shadow disabled:opacity-60"
                    >
                      <span className="from-accent-deep via-accent to-accent-glow absolute inset-0 -translate-x-full bg-gradient-to-r transition-transform duration-500 group-hover:translate-x-0" />
                      <span className="relative flex items-center gap-1.5">
                        {loading ? 'Sending…' : 'Send sign-in link'}
                        {!loading && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            className="transition-transform group-hover:translate-x-0.5"
                          >
                            <path
                              d="M3 7h8m0 0L7 3m4 4l-4 4"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    </button>
                  </Magnetic>

                  {error && (
                    <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
                      {error}
                    </p>
                  )}
                </form>
              )}
            </div>

            <p className="text-ink-faded mt-6 text-center text-[12px]">
              By continuing you agree to our{' '}
              <Link href="/terms" className="text-ink underline-offset-4 hover:underline">
                Terms
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-ink underline-offset-4 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </Aurora>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}
