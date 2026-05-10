import Link from 'next/link';
import {
  Container,
  Eyebrow,
  MarketingFooter,
  MarketingNav,
  Section,
  Card,
} from '@/components/horus';
import { ProductVisual } from '@/components/horus/product-visual';
import { Aurora, CountUp, Magnetic, Reveal, WordBloom } from '@/components/motion';

export default function HomePage() {
  return (
    <>
      <MarketingNav />

      {/* ───────────────────────────────────────────────────────────
         Hero — aurora-tracked, word-bloom headline
         ─────────────────────────────────────────────────────────── */}
      <Aurora intensity={1}>
        <Section className="overflow-hidden pb-0 pt-20 md:pt-28">
          <div className="bg-grid pointer-events-none absolute inset-0" />
          <div className="bg-wash pointer-events-none absolute inset-0" />

          <Container size="wide" className="relative">
            <div className="mx-auto max-w-4xl text-center">
              <div className="animate-rise mb-7 flex justify-center">
                <span className="chip chip-dot">
                  <span>Now in private beta · Cohort 02</span>
                </span>
              </div>

              <h1 className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.04em] md:text-7xl lg:text-8xl">
                <span className="text-display block">
                  <WordBloom text="The intelligence" stagger={70} />
                </span>
                <span className="text-display block">
                  <WordBloom text="layer for software" stagger={70} delay={120} />{' '}
                  <span className="serif-italic text-cobalt font-normal">
                    <WordBloom text="that thinks." stagger={70} delay={520} />
                  </span>
                </span>
              </h1>

              <Reveal delay={400} className="mx-auto mt-7 max-w-2xl">
                <p className="text-ink-faded text-balance text-lg leading-relaxed md:text-xl">
                  One unified API for retrieval, reasoning, and knowledge graphs. Multi-tenant,
                  white-label, production-grade — so you can ship intelligent products in days, not
                  quarters.
                </p>
              </Reveal>

              <Reveal delay={600} className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Magnetic strength={10}>
                  <Link
                    href="/signup"
                    className="bg-ink text-paper shadow-blue hover:shadow-blue-lg group relative inline-flex h-12 items-center gap-1 overflow-hidden rounded-full px-7 text-[15px] font-medium transition-shadow duration-500"
                  >
                    <span className="from-accent-deep via-accent to-accent-glow absolute inset-0 -translate-x-full bg-gradient-to-r transition-transform duration-700 ease-out group-hover:translate-x-0" />
                    <span className="relative flex items-center gap-1.5">
                      Start building
                      <Arrow />
                    </span>
                  </Link>
                </Magnetic>
                <Magnetic strength={6}>
                  <Link
                    href="/docs"
                    className="border-hairline-strong bg-paper/60 text-ink hover:border-accent/50 hover:text-accent inline-flex h-12 items-center gap-1 rounded-full border px-7 text-[15px] font-medium backdrop-blur-md transition-all"
                  >
                    Read the docs
                  </Link>
                </Magnetic>
              </Reveal>

              <Reveal delay={800}>
                <p className="font-technical text-ink-mute mt-5 text-[11px] uppercase tracking-[0.2em]">
                  No credit card · Free up to 10k queries/mo
                </p>
              </Reveal>
            </div>

            {/* Hero product surface — floats up with parallax-style scrub */}
            <Reveal variant="scale" delay={400} className="relative mx-auto mt-20 max-w-5xl">
              <div className="from-accent/25 via-accent/10 absolute -inset-x-12 -inset-y-8 -z-10 rounded-[3rem] bg-gradient-to-b to-transparent blur-3xl" />
              <div className="from-accent/15 absolute -inset-x-4 -inset-y-2 -z-10 rounded-[2.5rem] bg-gradient-to-b via-transparent to-transparent blur-xl" />
              <div data-scrub-rise>
                <ProductVisual />
              </div>
            </Reveal>
          </Container>
        </Section>
      </Aurora>

      {/* ───────────────────────────────────────────────────────────
         Marquee logo strip
         ─────────────────────────────────────────────────────────── */}
      <Section className="!py-20">
        <Container size="wide">
          <Reveal>
            <p className="font-technical text-ink-faded mb-10 text-center text-[11px] uppercase tracking-[0.22em]">
              Powering teams at
            </p>
          </Reveal>
          <div className="marquee">
            <div className="marquee__track">
              {[...logos, ...logos].map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="font-technical text-ink-faded hover:text-accent text-sm font-medium tracking-[0.22em] transition-colors"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* ───────────────────────────────────────────────────────────
         Product overview — dark, aurora-tracked
         ─────────────────────────────────────────────────────────── */}
      <div className="dark">
        <Aurora intensity={1.2}>
          <Section invert id="product" className="overflow-hidden">
            <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
            <Container size="wide" className="relative">
              <div className="grid gap-16 md:grid-cols-2 md:items-center">
                <div>
                  <Reveal>
                    <Eyebrow>The product</Eyebrow>
                  </Reveal>
                  <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
                    <WordBloom text="Retrieval, reasoning, and graphs —" />{' '}
                    <span className="serif-italic text-paper/70 font-normal">
                      <WordBloom text="in one call." delay={420} />
                    </span>
                  </h2>
                  <Reveal delay={300}>
                    <p className="text-paper/60 mt-6 max-w-xl text-lg leading-relaxed">
                      Most teams stitch together six tools to build one intelligent feature. Horus
                      replaces the stack with a typed API and a purpose-built runtime — vector
                      search, knowledge graphs, and agentic reasoning, sharing context.
                    </p>
                  </Reveal>

                  <div className="mt-10 grid gap-4 sm:grid-cols-2">
                    {[
                      ['Hybrid retrieval', 'Vector + keyword + graph in one query'],
                      ['Citations always', 'Every claim links back to source spans'],
                      ['Streaming first', 'SSE end-to-end, < 250ms first token'],
                      ['Multi-tenant', 'Per-tenant isolation by Postgres RLS'],
                    ].map(([title, body], i) => (
                      <Reveal key={title} delay={400 + i * 80} variant="rise">
                        <div className="border-paper/10 bg-paper/5 hover:border-accent/40 hover:bg-paper/10 group relative overflow-hidden rounded-2xl border p-5 backdrop-blur-sm transition-all duration-500">
                          <div className="via-accent/50 absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                          <div className="text-paper font-medium">{title}</div>
                          <div className="text-paper/60 mt-1 text-sm">{body}</div>
                        </div>
                      </Reveal>
                    ))}
                  </div>
                </div>

                <Reveal variant="right" delay={200}>
                  <CodeSample />
                </Reveal>
              </div>
            </Container>
          </Section>
        </Aurora>
      </div>

      {/* ───────────────────────────────────────────────────────────
         Capabilities grid — staggered card reveal
         ─────────────────────────────────────────────────────────── */}
      <Section id="capabilities">
        <Container size="wide">
          <Reveal className="max-w-2xl">
            <Eyebrow>Capabilities</Eyebrow>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              <span className="text-display">Built for the work</span>
              <br />
              <span className="serif-italic text-cobalt font-normal">ambitious teams ship.</span>
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {capabilities.map((c, i) => (
              <Reveal key={c.title} delay={i * 80}>
                <Card hoverable className="group !p-7 [transform-style:preserve-3d]">
                  <div className="bg-accent/8 text-accent ring-accent/15 group-hover:bg-accent group-hover:shadow-blue mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 transition-all duration-500 group-hover:scale-110 group-hover:text-white">
                    {c.icon}
                  </div>
                  <h3 className="text-ink text-[19px] font-semibold tracking-tight">{c.title}</h3>
                  <p className="text-ink-faded mt-2 text-[15px] leading-relaxed">{c.body}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ───────────────────────────────────────────────────────────
         How it works — three connected steps
         ─────────────────────────────────────────────────────────── */}
      <Section className="bg-paper-soft">
        <Container size="wide">
          <Reveal className="max-w-2xl">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              <span className="text-display">Three steps,</span>{' '}
              <span className="serif-italic text-cobalt font-normal">no glue code.</span>
            </h2>
          </Reveal>

          <div className="border-hairline bg-hairline mt-14 grid gap-px overflow-hidden rounded-3xl border md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 120}>
                <div className="bg-paper hover:bg-paper-soft group relative h-full p-8 transition-colors duration-500 md:p-10">
                  <div className="num font-technical text-accent text-[11px] font-medium uppercase tracking-[0.2em]">
                    Step {String(i + 1).padStart(2, '0')}
                  </div>
                  <h3 className="text-ink mt-5 text-2xl font-semibold tracking-tight">{s.title}</h3>
                  <p className="text-ink-faded mt-3 text-[15px] leading-relaxed">{s.body}</p>
                  <div className="border-hairline bg-paper-soft font-technical text-ink-soft group-hover:border-accent/30 group-hover:bg-paper mt-7 rounded-xl border px-4 py-3 text-[12px] transition-colors">
                    <span className="text-accent">$</span> {s.code}
                  </div>
                  {/* Connecting line on hover */}
                  {i < 2 && (
                    <div className="from-accent/0 via-accent to-accent/0 absolute right-0 top-1/2 hidden h-px w-6 -translate-y-1/2 translate-x-3 bg-gradient-to-r opacity-0 transition-opacity duration-500 group-hover:opacity-100 md:block" />
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ───────────────────────────────────────────────────────────
         Metrics — count-up on scroll, dark
         ─────────────────────────────────────────────────────────── */}
      <div className="dark">
        <Aurora intensity={1.4}>
          <Section invert>
            <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
            <Container size="wide" className="relative">
              <Reveal className="max-w-2xl">
                <Eyebrow>Performance</Eyebrow>
                <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
                  <span className="text-paper">Built for production from</span>{' '}
                  <span className="serif-italic text-cobalt font-normal">day one.</span>
                </h2>
              </Reveal>

              <div className="mt-14 grid gap-12 md:grid-cols-4">
                <Reveal delay={0}>
                  <MetricInvert
                    value={<CountUp to={218} />}
                    suffix="ms"
                    label="Median p50 latency"
                  />
                </Reveal>
                <Reveal delay={80}>
                  <MetricInvert
                    value={<CountUp to={99.99} decimals={2} />}
                    suffix="%"
                    label="Uptime SLA"
                  />
                </Reveal>
                <Reveal delay={160}>
                  <MetricInvert
                    value={<CountUp to={3.1} decimals={1} />}
                    suffix="B"
                    label="Tokens served weekly"
                  />
                </Reveal>
                <Reveal delay={240}>
                  <MetricInvert
                    value={<CountUp to={42} />}
                    suffix="ms"
                    label="Time to first token"
                  />
                </Reveal>
              </div>
            </Container>
          </Section>
        </Aurora>
      </div>

      {/* ───────────────────────────────────────────────────────────
         Pricing
         ─────────────────────────────────────────────────────────── */}
      <Section id="pricing">
        <Container size="wide">
          <Reveal className="max-w-2xl">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              <span className="text-display">Pay for what you use.</span>{' '}
              <span className="serif-italic text-cobalt font-normal">Nothing more.</span>
            </h2>
            <p className="text-ink-faded mt-5 text-lg leading-relaxed">
              Start free. Scale on metered usage. Move to a contract when you outgrow the meter —
              most teams take a year.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {plans.map((p, i) => (
              <Reveal key={p.name} delay={i * 100}>
                <div
                  className={
                    p.featured
                      ? 'border-accent from-accent-deep via-accent to-accent-bright shadow-blue-lg group relative h-full overflow-hidden rounded-3xl border bg-gradient-to-br p-8 text-white transition-all duration-500 hover:-translate-y-1'
                      : 'border-hairline bg-paper hover:border-accent/40 group relative h-full overflow-hidden rounded-3xl border p-8 transition-all duration-500 hover:-translate-y-1 hover:shadow-md'
                  }
                >
                  {p.featured && (
                    <>
                      <span className="text-accent-deep absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wider shadow-md">
                        Most picked
                      </span>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_-20%,white,transparent_50%)] opacity-30"
                      />
                    </>
                  )}
                  <div className={p.featured ? 'eyebrow !text-white/80' : 'eyebrow'}>{p.name}</div>
                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="num text-5xl font-semibold tracking-tight">{p.price}</span>
                    <span className={p.featured ? 'text-white/70' : 'text-ink-faded'}>
                      {p.unit}
                    </span>
                  </div>
                  <p
                    className={
                      p.featured
                        ? 'mt-3 text-[14px] text-white/85'
                        : 'text-ink-faded mt-3 text-[14px]'
                    }
                  >
                    {p.tagline}
                  </p>

                  <Link
                    href={p.href}
                    className={
                      p.featured
                        ? 'text-accent-deep mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[14px] font-medium transition-all hover:scale-[1.02]'
                        : 'border-ink bg-paper text-ink hover:bg-ink hover:text-paper mt-7 inline-flex h-11 w-full items-center justify-center rounded-full border text-[14px] font-medium transition-all'
                    }
                  >
                    {p.cta}
                  </Link>

                  <ul className="mt-7 space-y-3 text-[14px]">
                    {p.features.map((f) => (
                      <li
                        key={f}
                        className={
                          p.featured
                            ? 'flex items-start gap-2 text-white/90'
                            : 'text-ink-soft flex items-start gap-2'
                        }
                      >
                        <Check featured={p.featured} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ───────────────────────────────────────────────────────────
         Closing CTA — aurora-tracked
         ─────────────────────────────────────────────────────────── */}
      <Section className="!pt-12">
        <Container size="wide">
          <Aurora intensity={0.8} className="rounded-[2rem]">
            <Reveal>
              <div className="border-hairline bg-paper-soft relative overflow-hidden rounded-[2rem] border p-12 text-center md:p-20">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_100%,hsl(var(--accent)/0.18),transparent_60%)]"
                />
                <h2 className="relative mx-auto max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
                  <span className="text-display">Ship the intelligent feature.</span>
                  <br />
                  <span className="serif-italic text-cobalt font-normal">Skip the foundry.</span>
                </h2>
                <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
                  <Magnetic strength={10}>
                    <Link
                      href="/signup"
                      className="bg-accent shadow-blue hover:shadow-blue-lg group inline-flex h-12 items-center gap-1 rounded-full px-7 text-[15px] font-medium text-white transition-shadow"
                    >
                      Start free <Arrow />
                    </Link>
                  </Magnetic>
                  <Magnetic strength={6}>
                    <Link
                      href="/contact"
                      className="border-hairline-strong bg-paper text-ink hover:border-accent/50 inline-flex h-12 items-center rounded-full border px-7 text-[15px] font-medium transition-colors"
                    >
                      Talk to sales
                    </Link>
                  </Magnetic>
                </div>
              </div>
            </Reveal>
          </Aurora>
        </Container>
      </Section>

      <MarketingFooter />
    </>
  );
}

function Arrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className="transition-transform duration-300 group-hover:translate-x-1"
    >
      <path
        d="M3 7h8m0 0L7 3m4 4l-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Check({ featured }: { featured?: boolean }) {
  return (
    <svg
      className={featured ? 'mt-1 shrink-0 text-white' : 'text-accent mt-1 shrink-0'}
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
    >
      <path
        d="M2 7l3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricInvert({
  value,
  label,
  suffix,
}: {
  value: React.ReactNode;
  label: string;
  suffix?: string;
}) {
  return (
    <div className="group">
      <div className="num text-5xl font-medium tracking-tight md:text-6xl">
        <span className="from-paper to-paper/70 bg-gradient-to-b bg-clip-text text-transparent">
          {value}
        </span>
        {suffix && <span className="text-paper/60 text-2xl font-normal md:text-3xl">{suffix}</span>}
      </div>
      <div className="text-paper/60 group-hover:text-accent-glow mt-2 text-sm transition-colors">
        {label}
      </div>
    </div>
  );
}

function CodeSample() {
  return (
    <div className="relative">
      <div className="bg-accent/20 absolute -inset-3 -z-10 rounded-3xl blur-2xl" />
      <div className="from-accent/30 via-accent/10 absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-br to-transparent blur" />
      <div className="border-paper/10 bg-paper/5 overflow-hidden rounded-2xl border backdrop-blur-md">
        <div className="border-paper/10 flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="bg-paper/20 h-2 w-2 rounded-full" />
            <span className="bg-paper/20 h-2 w-2 rounded-full" />
            <span className="bg-paper/20 h-2 w-2 rounded-full" />
          </div>
          <span className="font-technical text-paper/40 text-[10px] tracking-wider">
            example.ts
          </span>
        </div>
        <pre className="font-technical text-paper/85 overflow-x-auto p-5 text-[12.5px] leading-[1.85]">
          {`import { Horus } from '@horus/sdk';

const horus = new Horus({ apiKey: env.HORUS_KEY });

`}
          <span className="text-accent-glow">{`// retrieval + reasoning + graph, one call`}</span>
          {`
const answer = await horus.answer({
  question: 'Q3 underwriting risk?',
  cite: true,
  graph: 'portfolio',
});

`}
          <span className="text-paper/40">{`// →`}</span>
          {` `}
          <span className="text-accent-glow">{`{ content, sources, telemetry }`}</span>
        </pre>
      </div>
    </div>
  );
}

const logos = [
  'NORTHWIND',
  'CONSTELLA',
  'AMBER & CO',
  'KEYSTONE',
  'PARALLAX',
  'HARBOUR',
  'MERIDIAN',
  'CORDIS',
];

const capabilities = [
  {
    title: 'Hybrid retrieval',
    body: 'Vector, keyword, and graph traversal in a single query plan. Configure weights per tenant, per route, per call.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M14 14l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Agentic reasoning',
    body: 'Tool-using agents with traceable thoughts. Every plan, retrieval, and call is recorded for replay.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 15.4l-4.8 2.5.9-5.4L2.2 8.7l5.4-.8L10 3z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: 'Knowledge graphs',
    body: 'Auto-built from your documents. Query relationships in natural language. Visualize evolution over time.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="15" cy="5" r="2" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="10" cy="15" r="2" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M6.4 6.4L8.6 13.6M11.4 13.6l2.2-7.2M7 5h6"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
    ),
  },
  {
    title: 'White-label tenants',
    body: 'Per-tenant config, branding, custom domains, and isolated data. One platform, many products.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 8h14M8 3v14" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    title: 'Streaming & SSE',
    body: 'Server-sent events end-to-end. Sub-50ms first token. Cancellation propagates to the model.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M3 10h4l2-5 2 10 2-5h4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: 'Built-in observability',
    body: 'Every call traced, every token costed, every retrieval auditable. Export to your warehouse.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
];

const steps = [
  {
    title: 'Connect a source',
    body: 'Point Horus at your documents, databases, or live feeds. We chunk, embed, and graph automatically.',
    code: 'horus sources add ./policy/*.pdf',
  },
  {
    title: 'Call the API',
    body: 'One typed endpoint covers retrieval, reasoning, and citations. SDKs for TS, Python, Go, Swift.',
    code: 'horus.answer({ question, cite: true })',
  },
  {
    title: 'Ship the feature',
    body: 'Drop the response into your UI. Citations and graph context come included — no plumbing.',
    code: 'git push origin main',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    unit: '/ month',
    tagline: 'Generous starting tier. Everything you need to prototype and prove the value.',
    cta: 'Start free',
    href: '/signup',
    featured: false,
    features: [
      '10,000 queries / month',
      '500 documents indexed',
      '1 tenant, community support',
      'All capabilities, no asterisks',
    ],
  },
  {
    name: 'Studio',
    price: '$249',
    unit: '/ month',
    featured: true,
    tagline: 'For teams shipping production features. Predictable pricing with metered overage.',
    cta: 'Start 14-day trial',
    href: '/signup?plan=studio',
    features: [
      '500,000 queries / month',
      '50,000 documents indexed',
      '10 tenants · custom domains',
      'Email support · 99.9% SLA',
    ],
  },
  {
    name: 'Scale',
    price: 'Talk',
    unit: 'to us',
    tagline:
      'For platforms with serious volume. Dedicated infrastructure, custom contracts, named support.',
    cta: 'Contact sales',
    href: '/contact',
    featured: false,
    features: [
      'Unlimited queries · usage-based',
      'Unlimited tenants',
      'Dedicated VPC option',
      '99.99% SLA · named CSM',
    ],
  },
];
