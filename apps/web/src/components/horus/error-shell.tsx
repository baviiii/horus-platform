'use client';

import Link from 'next/link';
import { Container, MarketingFooter, MarketingNav, Eyebrow } from '@/components/horus';
import { Button } from '@/components/ui/button';

const labels = {
  root: { eyebrow: 'Error', tag: 'Application' },
  admin: { eyebrow: 'Error', tag: 'Admin console' },
  tenant: { eyebrow: 'Error', tag: 'Workspace' },
} as const;

export function ErrorShell({
  error,
  reset,
  scope,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: keyof typeof labels;
}) {
  const meta = labels[scope];

  return (
    <>
      <MarketingNav />
      <main className="bg-paper">
        <section className="section relative overflow-hidden">
          <div className="bg-grid pointer-events-none absolute inset-0" />
          <div className="bg-wash pointer-events-none absolute inset-0" />
          <Container size="narrow" className="relative">
            <Eyebrow>{meta.eyebrow}</Eyebrow>
            <h1 className="text-ink mt-5 text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.025em] md:text-6xl">
              Something went sideways.
            </h1>
            <p className="text-ink-faded mt-5 text-[17px] leading-relaxed">
              {meta.tag} hit an unexpected error. We've logged it and the team will look. You can
              retry — most transient issues clear in seconds.
            </p>

            {error.digest && (
              <div className="border-hairline bg-paper-soft mt-8 rounded-2xl border p-5">
                <div className="text-ink-mute text-[10px] font-semibold uppercase tracking-[0.18em]">
                  Reference
                </div>
                <div className="font-technical text-ink mt-1.5 text-[12.5px]">{error.digest}</div>
                <p className="text-ink-faded mt-2 text-[12.5px]">
                  Quote this when you contact support and we'll find it instantly.
                </p>
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Button onClick={reset}>Try again</Button>
              <Button asChild variant="outline">
                <Link href="/">Back to home</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/contact">Tell us what happened</Link>
              </Button>
            </div>
          </Container>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
