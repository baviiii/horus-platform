import Link from 'next/link';
import { Container, MarketingFooter, MarketingNav, Eyebrow } from '@/components/horus';

export const metadata = { title: 'Docs · Horus' };

const sections = [
  {
    title: 'Get started',
    description: 'Five minutes to your first answer with citations.',
    links: [
      { href: '/docs/quickstart', label: 'Quickstart' },
      { href: '/docs', label: 'Install the SDK', soon: true },
      { href: '/docs', label: 'Authentication & API keys', soon: true },
    ],
  },
  {
    title: 'Core concepts',
    description: 'The mental model behind retrieval, reasoning, and graphs.',
    links: [
      { href: '/docs', label: 'Tenants & workspaces', soon: true },
      { href: '/docs', label: 'Documents & chunks', soon: true },
      { href: '/docs', label: 'Knowledge graphs', soon: true },
      { href: '/docs', label: 'Sessions & memory', soon: true },
    ],
  },
  {
    title: 'API reference',
    description: 'Typed endpoints, errors, rate limits, streaming.',
    links: [
      { href: '/docs', label: 'Answers · /v1/answer', soon: true },
      { href: '/docs', label: 'Search · /v1/search', soon: true },
      { href: '/docs', label: 'Graph · /v1/graph', soon: true },
      { href: '/docs', label: 'Webhooks', soon: true },
    ],
  },
  {
    title: 'Guides',
    description: 'Recipes for the workloads we see most often.',
    links: [
      { href: '/docs', label: 'Building a chat product', soon: true },
      { href: '/docs', label: 'White-label tenants', soon: true },
      { href: '/docs', label: 'Custom retrievers', soon: true },
      { href: '/docs', label: 'Audit & compliance', soon: true },
    ],
  },
];

export default function DocsPage() {
  return (
    <>
      <MarketingNav />
      <main className="bg-paper">
        <section className="section relative overflow-hidden">
          <div className="bg-grid pointer-events-none absolute inset-0" />
          <div className="bg-wash pointer-events-none absolute inset-0" />
          <Container size="default" className="relative">
            <div className="max-w-3xl">
              <Eyebrow>Docs</Eyebrow>
              <h1 className="text-ink mt-5 text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-7xl">
                Build with Horus.
              </h1>
              <p className="text-ink-faded mt-5 text-[17px] leading-relaxed md:text-[19px]">
                Most of the docs are still being written. The ones that exist are linked below. Need
                something specific?{' '}
                <Link href="/contact" className="text-ink underline-offset-4 hover:underline">
                  Talk to the team
                </Link>
                .
              </p>
            </div>
          </Container>
        </section>

        <section className="pb-24">
          <Container size="default">
            <div className="grid gap-4 md:grid-cols-2">
              {sections.map((s) => (
                <div key={s.title} className="border-hairline bg-paper rounded-3xl border p-7">
                  <h2 className="text-ink text-xl font-semibold tracking-tight">{s.title}</h2>
                  <p className="text-ink-faded mt-1.5 text-[14px]">{s.description}</p>
                  <ul className="mt-5 space-y-2">
                    {s.links.map((l) => (
                      <li key={l.label}>
                        <Link
                          href={l.href}
                          className="hover:bg-paper-soft group flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 transition-colors"
                        >
                          <span
                            className={
                              l.soon
                                ? 'text-ink-faded text-[14px]'
                                : 'text-ink text-[14px] font-medium'
                            }
                          >
                            {l.label}
                          </span>
                          {l.soon ? (
                            <span className="font-technical text-ink-mute text-[10px] uppercase tracking-[0.18em]">
                              Soon
                            </span>
                          ) : (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 14 14"
                              fill="none"
                              className="text-ink-faded transition-transform group-hover:translate-x-0.5"
                            >
                              <path
                                d="M3 7h8m0 0L7 3m4 4l-4 4"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Container>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
