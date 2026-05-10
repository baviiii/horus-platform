import * as React from 'react';
import Link from 'next/link';
import { Container, MarketingFooter, MarketingNav } from '.';

export function Soon({
  eyebrow,
  title,
  body,
  eta,
  cta,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body: React.ReactNode;
  eta?: string;
  cta?: { href: string; label: string }[];
}) {
  return (
    <>
      <MarketingNav />
      <main className="bg-paper relative isolate overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="bg-wash pointer-events-none absolute inset-0" />

        <section className="section relative">
          <Container size="default">
            <div className="mx-auto max-w-3xl py-8 md:py-16">
              <div className="reveal-stagger">
                <div className="flex items-center gap-2">
                  <span className="chip chip-dot">{eyebrow}</span>
                  {eta && (
                    <span className="font-technical text-ink-faded text-[11px] uppercase tracking-[0.18em]">
                      ETA · {eta}
                    </span>
                  )}
                </div>

                <h1 className="text-ink mt-7 text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-7xl">
                  {title}
                </h1>

                <div className="text-ink-faded mt-6 max-w-2xl text-[17px] leading-relaxed md:text-[19px]">
                  {body}
                </div>

                {cta && cta.length > 0 && (
                  <div className="mt-9 flex flex-wrap items-center gap-3">
                    {cta.map((c, i) => (
                      <Link
                        key={c.href}
                        href={c.href}
                        className={
                          i === 0
                            ? 'bg-ink text-paper hover:bg-ink-soft inline-flex h-11 items-center rounded-full px-6 text-[14px] font-medium transition-colors'
                            : 'border-hairline-strong bg-paper text-ink hover:bg-paper-soft inline-flex h-11 items-center rounded-full border px-6 text-[14px] font-medium transition-colors'
                        }
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Container>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
