'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Container, Wordmark } from '@/components/horus';
import { Aurora } from '@/components/motion';
import { AuthForm } from '@/components/auth/auth-form';

function LoginContent() {
  const params = useSearchParams();
  const errorParam = params.get('error');
  const next = params.get('next') ?? '/onboarding';

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
                Welcome back. Pick whichever way you signed up.
              </p>
            </div>

            <div className="border-hairline bg-paper/80 relative rounded-3xl border p-8 shadow-md backdrop-blur-xl">
              <div className="from-accent/15 pointer-events-none absolute -inset-px -z-10 rounded-3xl bg-gradient-to-b via-transparent to-transparent blur-xl" />
              <AuthForm mode="signin" next={next} initialError={errorParam} />
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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
