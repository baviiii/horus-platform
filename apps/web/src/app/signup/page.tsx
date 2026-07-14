'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Container, Wordmark } from '@/components/horus';
import { Aurora } from '@/components/motion';
import { AuthForm } from '@/components/auth/auth-form';

function SignupContent() {
  const params = useSearchParams();
  const planParam = params.get('plan');
  const errorParam = params.get('error');

  return (
    <Aurora intensity={1.2}>
      <main className="bg-paper relative min-h-screen">
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
              Already have an account?{' '}
              <span className="text-ink underline-offset-4 hover:underline">Sign in</span>
            </Link>
          </Container>
        </header>

        <div className="relative z-10 mx-auto grid max-w-[1180px] gap-12 px-6 pb-24 pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          {/* Left column — pitch + selected plan */}
          <aside className="hidden flex-col justify-between lg:flex">
            <div className="animate-rise">
              <span className="chip chip-dot">Free to start</span>
              <h1 className="text-ink mt-7 text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-6xl">
                <span className="text-display">Build something that</span>{' '}
                <span className="serif-italic text-cobalt font-normal">thinks.</span>
              </h1>
              <p className="text-ink-faded mt-5 max-w-md text-[17px] leading-relaxed">
                Two minutes from sign-up to your first answer with citations. No card required.
                Cancel by ignoring it.
              </p>

              <ul className="mt-10 space-y-4">
                {[
                  'Free up to 10,000 queries per month',
                  'All capabilities included on every plan',
                  'Postgres-grade tenant isolation, day one',
                  'TypeScript, Python, Go, Swift SDKs',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="bg-accent/10 mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path
                          d="M2 6l2.5 2.5L9 3"
                          stroke="hsl(var(--accent))"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="text-ink-soft text-[15px]">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {planParam && (
              <div className="border-hairline bg-paper-soft animate-rise mt-10 rounded-2xl border p-5 [animation-delay:200ms]">
                <div className="eyebrow">Selected plan</div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div className="text-ink text-xl font-semibold capitalize tracking-tight">
                    {planParam}
                  </div>
                  <Link
                    href="/#pricing"
                    className="text-ink-faded text-[12px] underline-offset-4 hover:underline"
                  >
                    Change
                  </Link>
                </div>
              </div>
            )}
          </aside>

          {/* Right column — form */}
          <div className="w-full max-w-[460px] justify-self-center lg:justify-self-end">
            <div className="border-hairline bg-paper/80 animate-rise relative rounded-3xl border p-8 shadow-md backdrop-blur-xl [animation-delay:120ms]">
              <div className="from-accent/15 pointer-events-none absolute -inset-px -z-10 rounded-3xl bg-gradient-to-b via-transparent to-transparent blur-xl" />
              <div className="mb-6">
                <h2 className="text-ink text-[26px] font-semibold tracking-tight">
                  Create your workspace
                </h2>
                <p className="text-ink-faded mt-1.5 text-[14px]">
                  We'll spin up your tenant and drop you straight in.
                </p>
              </div>

              <AuthForm
                mode="signup"
                next="/onboarding"
                plan={planParam}
                initialError={errorParam}
              />
            </div>

            <p className="text-ink-faded mt-5 text-center text-[12px]">
              By creating an account you agree to our{' '}
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

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupContent />
    </Suspense>
  );
}
