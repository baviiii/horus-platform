import Link from 'next/link';
import { Container, MarketingFooter, MarketingNav, Eyebrow } from '@/components/horus';

export const metadata = { title: 'Quickstart · Horus' };

export default function QuickstartPage() {
  return (
    <>
      <MarketingNav />
      <main className="bg-paper">
        <section className="section relative overflow-hidden">
          <div className="bg-grid pointer-events-none absolute inset-0" />
          <div className="bg-wash pointer-events-none absolute inset-0" />
          <Container size="narrow" className="relative">
            <div className="flex items-center gap-3 text-[12px]">
              <Link
                href="/docs"
                className="text-ink-faded hover:text-ink underline-offset-4 hover:underline"
              >
                Docs
              </Link>
              <span className="text-ink-mute">/</span>
              <span className="text-ink">Quickstart</span>
            </div>

            <div className="mt-6">
              <Eyebrow>Get started</Eyebrow>
              <h1 className="text-ink mt-5 text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.025em] md:text-6xl">
                Five minutes to first answer.
              </h1>
              <p className="text-ink-faded mt-5 text-[17px] leading-relaxed">
                Install the SDK, authenticate, and run a query with citations. We'll write the full
                guided walkthrough against the live API. Until then, here's the shape.
              </p>
            </div>
          </Container>
        </section>

        <section className="pb-24">
          <Container size="narrow">
            <ol className="space-y-10">
              <Step
                n={1}
                title="Install the SDK"
                body="TypeScript and Python today. Go and Swift soon."
                code={`pnpm add @horus/sdk
# or
npm install @horus/sdk`}
                lang="bash"
              />
              <Step
                n={2}
                title="Authenticate"
                body="Generate a key in your workspace settings. Keep it on the server."
                code={`import { Horus } from '@horus/sdk';

const horus = new Horus({
  apiKey: process.env.HORUS_KEY!,
});`}
                lang="ts"
              />
              <Step
                n={3}
                title="Add a document"
                body="Horus chunks, embeds, and graphs it for you. Idempotent on filename + hash."
                code={`await horus.documents.upload({
  path: './policy/q3-risk-memo.pdf',
  category: 'underwriting',
});`}
                lang="ts"
              />
              <Step
                n={4}
                title="Ask a question"
                body="Hybrid retrieval, reasoning, and citations — one call."
                code={`const answer = await horus.answer({
  question: 'What changed in Q3 underwriting risk?',
  cite: true,
});

console.log(answer.content);   // text with [1][2] markers
console.log(answer.sources);   // [{ doc, page, span }, ...]`}
                lang="ts"
              />
            </ol>

            <div className="border-hairline bg-paper-soft mt-16 rounded-3xl border p-8 text-center">
              <h2 className="text-ink text-2xl font-semibold tracking-tight">
                That's it. You're querying intelligence.
              </h2>
              <p className="text-ink-faded mt-2 text-[15px]">
                Stuck? We answer founder emails in under a working day.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link
                  href="/signup"
                  className="bg-ink text-paper hover:bg-ink-soft inline-flex h-11 items-center rounded-full px-6 text-[14px] font-medium transition-colors"
                >
                  Get an API key
                </Link>
                <Link
                  href="/contact"
                  className="border-hairline-strong bg-paper text-ink hover:bg-paper inline-flex h-11 items-center rounded-full border px-6 text-[14px] font-medium transition-colors"
                >
                  Talk to founders
                </Link>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}

function Step({
  n,
  title,
  body,
  code,
  lang,
}: {
  n: number;
  title: string;
  body: string;
  code: string;
  lang: string;
}) {
  return (
    <li className="relative grid gap-6 md:grid-cols-[120px_1fr]">
      <div>
        <div className="font-technical text-accent text-[11px] font-medium uppercase tracking-[0.2em]">
          Step {String(n).padStart(2, '0')}
        </div>
      </div>
      <div>
        <h2 className="text-ink text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="text-ink-faded mt-2 text-[15px] leading-relaxed">{body}</p>
        <div className="border-hairline bg-ink mt-5 overflow-hidden rounded-2xl border">
          <div className="border-paper/10 flex items-center justify-between border-b px-4 py-2">
            <span className="font-technical text-paper/40 text-[10px] uppercase tracking-[0.2em]">
              {lang}
            </span>
          </div>
          <pre className="font-technical text-paper/90 overflow-x-auto p-5 text-[12.5px] leading-[1.85]">
            {code}
          </pre>
        </div>
      </div>
    </li>
  );
}
