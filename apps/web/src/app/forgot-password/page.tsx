'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Container, Wordmark } from '@/components/horus';
import { Aurora, Magnetic } from '@/components/motion';
import { consumeRateLimit, describeWait, RATE_LIMITS } from '@/lib/auth/client-rate-limit';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const limit = consumeRateLimit('emailLink', email, RATE_LIMITS.emailLink);
    if (!limit.ok) {
      setError(
        `Too many requests. Please wait ${describeWait(limit.retryAfterSeconds)} and try again.`,
      );
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/reset-password`,
      });
      // Always show success even if the address is unknown — don't leak which
      // emails have accounts.
      if (error && !/rate limit|too many/i.test(error.message)) {
        setError(error.message);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send the reset link.");
    } finally {
      setLoading(false);
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
              href="/login"
              className="text-ink-faded hover:text-ink text-[13px] font-medium transition-colors"
            >
              Back to <span className="text-ink underline-offset-4 hover:underline">sign in</span>
            </Link>
          </Container>
        </header>

        <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-24 pt-12">
          <div className="animate-rise w-full max-w-[420px]">
            <div className="mb-9 text-center">
              <h1 className="text-ink text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
                <span className="text-display">Reset your</span>{' '}
                <span className="serif-italic text-cobalt font-normal">password.</span>
              </h1>
              <p className="text-ink-faded mt-3 text-[15px]">
                Enter your email and we'll send a secure link to set a new one.
              </p>
            </div>

            <div className="border-hairline bg-paper/80 relative rounded-3xl border p-8 shadow-md backdrop-blur-xl">
              <div className="from-accent/15 pointer-events-none absolute -inset-px -z-10 rounded-3xl bg-gradient-to-b via-transparent to-transparent blur-xl" />
              {sent ? (
                <div className="space-y-5 py-2 text-center">
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
                    If an account exists for <span className="text-ink font-medium">{email}</span>,
                    we've sent a link to reset your password.
                    <br />
                    It expires in 1 hour.
                  </p>
                  <Link
                    href="/login"
                    className="text-accent inline-block text-[13px] font-medium underline-offset-4 hover:underline"
                  >
                    Back to sign in
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
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
                        autoComplete="email"
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
                      <span className="relative">{loading ? 'Sending…' : 'Send reset link'}</span>
                    </button>
                  </Magnetic>

                  {error && (
                    <p
                      role="alert"
                      className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700"
                    >
                      {error}
                    </p>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </Aurora>
  );
}
