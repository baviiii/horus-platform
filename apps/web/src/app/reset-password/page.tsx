'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Container, Wordmark } from '@/components/horus';
import { Aurora, Magnetic } from '@/components/motion';

const MIN_PASSWORD = 8;

type Status = 'checking' | 'ready' | 'expired' | 'done';

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The callback route exchanges the recovery code and sets the session cookie
  // before redirecting here. Confirm we actually have a recovery session so we
  // don't show the form to someone who landed here directly.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setStatus('ready');
    });

    supabase.auth.getSession().then(({ data }) => {
      setStatus((prev) => (prev === 'done' ? prev : data.session ? 'ready' : 'expired'));
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return;
      }
      setStatus('done');
      // Give the success state a beat, then send them into the app.
      setTimeout(() => window.location.assign('/onboarding'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update your password.");
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
          </Container>
        </header>

        <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-24 pt-12">
          <div className="animate-rise w-full max-w-[420px]">
            <div className="mb-9 text-center">
              <h1 className="text-ink text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-5xl">
                <span className="text-display">Choose a new</span>{' '}
                <span className="serif-italic text-cobalt font-normal">password.</span>
              </h1>
            </div>

            <div className="border-hairline bg-paper/80 relative rounded-3xl border p-8 shadow-md backdrop-blur-xl">
              <div className="from-accent/15 pointer-events-none absolute -inset-px -z-10 rounded-3xl bg-gradient-to-b via-transparent to-transparent blur-xl" />

              {status === 'checking' && (
                <p className="text-ink-faded py-6 text-center text-[14px]">Verifying your link…</p>
              )}

              {status === 'expired' && (
                <div className="space-y-4 py-2 text-center">
                  <h2 className="text-ink text-2xl font-semibold tracking-tight">Link expired</h2>
                  <p className="text-ink-faded text-[14px] leading-relaxed">
                    This reset link is invalid or has already been used. Request a fresh one to
                    continue.
                  </p>
                  <Link
                    href="/forgot-password"
                    className="text-accent inline-block text-[13px] font-medium underline-offset-4 hover:underline"
                  >
                    Send a new reset link
                  </Link>
                </div>
              )}

              {status === 'done' && (
                <div className="space-y-4 py-2 text-center">
                  <div className="bg-accent/10 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 22 22"
                      fill="none"
                      className="text-accent"
                    >
                      <path
                        d="M5 11l4 4 8-8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h2 className="text-ink text-2xl font-semibold tracking-tight">
                    Password updated
                  </h2>
                  <p className="text-ink-faded text-[14px]">Taking you to your workspace…</p>
                </div>
              )}

              {status === 'ready' && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <label className="block">
                    <span className="text-ink text-[13px] font-medium">New password</span>
                    <div className="focus-ring mt-1.5 rounded-xl">
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={MIN_PASSWORD}
                          autoFocus
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          autoComplete="new-password"
                          className="border-hairline-strong bg-paper text-ink placeholder:text-ink-mute focus:border-accent block h-11 w-full rounded-xl border px-4 pr-16 text-[15px] transition-colors focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="text-ink-faded hover:text-ink absolute inset-y-0 right-3 my-auto h-fit text-[12px] font-medium"
                          tabIndex={-1}
                        >
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-ink text-[13px] font-medium">Confirm password</span>
                    <div className="focus-ring mt-1.5 rounded-xl">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={MIN_PASSWORD}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder="Re-enter your password"
                        autoComplete="new-password"
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
                      <span className="relative">{loading ? 'Updating…' : 'Update password'}</span>
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
