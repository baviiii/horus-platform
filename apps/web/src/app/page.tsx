import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function MarketingHome() {
  return (
    <main className="relative isolate overflow-hidden">
      <div className="container flex min-h-screen flex-col">
        <header className="flex items-center justify-between py-6">
          <Link href="/" className="font-mono text-lg font-semibold tracking-tight">
            horus
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/docs" className="text-muted-foreground hover:text-foreground">
              Docs
            </Link>
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </nav>
        </header>

        <section className="flex flex-1 flex-col items-start justify-center gap-8 py-24">
          <div className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Production intelligence layer
          </div>
          <h1 className="max-w-4xl text-balance text-5xl font-semibold tracking-tight md:text-7xl">
            The intelligence layer enterprises don&rsquo;t want to build.
          </h1>
          <p className="max-w-2xl text-balance text-lg text-muted-foreground md:text-xl">
            Hybrid RAG, knowledge graphs, agentic reasoning, document intelligence — productized,
            multi-tenant, and white-label-ready. One SDK install. No 12-month rebuild.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Start free trial</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/docs/quickstart">Read the docs</Link>
            </Button>
          </div>
        </section>

        <footer className="border-t py-8 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>&copy; {new Date().getFullYear()} Horus Intelligence</div>
            <nav className="flex items-center gap-6">
              <Link href="/privacy" className="hover:text-foreground">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-foreground">
                Terms
              </Link>
              <Link href="/security" className="hover:text-foreground">
                Security
              </Link>
              <a
                href="https://status.horus.ai"
                className="hover:text-foreground"
                target="_blank"
                rel="noreferrer"
              >
                Status
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </main>
  );
}
