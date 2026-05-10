import Link from 'next/link';
import { Container, Wordmark } from '@/components/horus';

export default function NotFound() {
  return (
    <main className="bg-paper relative isolate min-h-screen overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="bg-wash pointer-events-none absolute inset-0" />

      <header className="relative z-10">
        <Container size="wide" className="flex h-16 items-center justify-between">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Wordmark size="sm" />
          </Link>
          <span className="font-technical text-ink-faded text-[11px] uppercase tracking-[0.2em]">
            Error · 404
          </span>
        </Container>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-24 pt-16">
        <div className="animate-rise mx-auto max-w-2xl text-center">
          <div className="num font-technical text-accent text-[14px] font-medium uppercase tracking-[0.2em]">
            404
          </div>
          <h1 className="text-ink mt-5 text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-7xl">
            We can't find <span className="serif-italic font-normal">that page.</span>
          </h1>
          <p className="text-ink-faded mx-auto mt-5 max-w-lg text-[17px] leading-relaxed">
            The link may have moved, or never existed. Try one of the routes below.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="bg-ink text-paper hover:bg-ink-soft inline-flex h-11 items-center rounded-full px-6 text-[14px] font-medium transition-colors"
            >
              Back to home
            </Link>
            <Link
              href="/docs"
              className="border-hairline-strong bg-paper text-ink hover:bg-paper-soft inline-flex h-11 items-center rounded-full border px-6 text-[14px] font-medium transition-colors"
            >
              Read the docs
            </Link>
            <Link
              href="/login"
              className="text-ink-faded hover:text-ink inline-flex h-11 items-center rounded-full px-4 text-[14px] font-medium"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
