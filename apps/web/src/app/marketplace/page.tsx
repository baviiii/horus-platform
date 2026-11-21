import Link from 'next/link';
import { prisma } from '@horus/db';
import { listMarketplaceCatalog } from '@horus/core/marketplace';
import { Container, Eyebrow, MarketingFooter, MarketingNav, Section } from '@/components/horus';
import { Aurora, Magnetic, Reveal, WordBloom } from '@/components/motion';
import { getCurrentUser } from '@/lib/supabase/server';
import { MarketplaceCatalogClient } from './marketplace-catalog-client';

export const metadata = {
  title: 'Marketplace & MCP Hub · Horus',
  description:
    'Connect Horus Knowledge Indexes, Entity Graphs, and MCP tool servers to Cursor, Claude Desktop, external platforms, or your signed-in Horus workspace.',
};

export const dynamic = 'force-dynamic';

export default async function MarketplacePage() {
  const [listings, user] = await Promise.all([
    listMarketplaceCatalog(),
    getCurrentUser().catch(() => null),
  ]);

  const memberships = user
    ? await prisma.tenantMember
        .findMany({
          where: { userId: user.id, tenant: { isActive: true } },
          include: { tenant: { select: { slug: true, name: true, plan: true } } },
          orderBy: { joinedAt: 'asc' },
        })
        .catch(() => [])
    : [];

  const primaryWorkspace = memberships[0]?.tenant ?? null;
  const totalTools = listings.reduce((sum, l) => sum + l.tools.length, 0);
  const indexCount = listings.filter((l) => l.kind === 'INDEX').length;
  const mcpCount = listings.filter((l) => l.kind === 'MCP').length;

  return (
    <>
      <MarketingNav pathname="/marketplace" />

      <main className="bg-paper">
        {/* Hero */}
        <Aurora intensity={1}>
          <Section className="overflow-hidden pb-12 pt-20 md:pt-28">
            <div className="bg-grid pointer-events-none absolute inset-0" />
            <div className="bg-wash pointer-events-none absolute inset-0" />

            <Container size="wide" className="relative">
              <div className="max-w-4xl">
                <Eyebrow>Marketplace &amp; MCP Hub</Eyebrow>

                <h1 className="mt-5 text-balance text-5xl font-semibold leading-[1.03] tracking-[-0.04em] md:text-7xl">
                  <span className="text-display block">
                    <WordBloom text="Indexes and MCP tools," stagger={65} />
                  </span>
                  <span className="serif-italic text-cobalt font-normal">
                    <WordBloom text="wired everywhere." stagger={65} delay={220} />
                  </span>
                </h1>

                <Reveal delay={250} className="mt-6 max-w-2xl">
                  <p className="text-ink-faded text-lg leading-relaxed md:text-xl">
                    Mount Horus knowledge indexes, citation engines, entity graphs, and stateless
                    MCP servers directly inside Cursor, Claude Desktop, Windsurf, external backends,
                    or your Horus workspace in one click.
                  </p>
                </Reveal>

                <Reveal delay={380} className="mt-8 flex flex-wrap items-center gap-3">
                  {primaryWorkspace ? (
                    <>
                      <Magnetic strength={8}>
                        <Link
                          href={`/t/${primaryWorkspace.slug}/marketplace`}
                          className="bg-ink text-paper shadow-blue hover:shadow-blue-lg inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium transition-shadow"
                        >
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          Open in {primaryWorkspace.name}
                        </Link>
                      </Magnetic>
                      <Link
                        href="/marketplace/workspace"
                        className="border-hairline-strong bg-paper/70 text-ink hover:border-accent/50 hover:text-accent inline-flex h-11 items-center rounded-full border px-6 text-[14px] font-medium backdrop-blur-md transition-colors"
                      >
                        Bridge your own index
                      </Link>
                    </>
                  ) : (
                    <>
                      <Magnetic strength={8}>
                        <Link
                          href={user ? '/onboarding' : '/signup'}
                          className="bg-ink text-paper shadow-blue hover:shadow-blue-lg inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium transition-shadow"
                        >
                          {user ? 'Create workspace to connect' : 'Start free · Get API key'}
                        </Link>
                      </Magnetic>
                      {!user && (
                        <Link
                          href="/login?next=/marketplace"
                          className="border-hairline-strong bg-paper/70 text-ink hover:border-accent/50 hover:text-accent inline-flex h-11 items-center rounded-full border px-6 text-[14px] font-medium backdrop-blur-md transition-colors"
                        >
                          Sign in to existing workspace
                        </Link>
                      )}
                    </>
                  )}
                </Reveal>

                {/* Live summary strip */}
                <Reveal
                  delay={480}
                  className="border-hairline bg-paper/80 mt-10 inline-grid grid-cols-3 gap-6 rounded-2xl border px-6 py-4 backdrop-blur-md sm:gap-10"
                >
                  <div>
                    <div className="num text-ink text-2xl font-semibold">{indexCount}</div>
                    <div className="text-ink-faded text-[12px]">Knowledge indexes</div>
                  </div>
                  <div>
                    <div className="num text-ink text-2xl font-semibold">{mcpCount}</div>
                    <div className="text-ink-faded text-[12px]">MCP tool servers</div>
                  </div>
                  <div>
                    <div className="num text-ink text-2xl font-semibold">{totalTools}</div>
                    <div className="text-ink-faded text-[12px]">Callable MCP tools</div>
                  </div>
                </Reveal>
              </div>
            </Container>
          </Section>
        </Aurora>

        {/* Directory */}
        <Section className="!pt-6">
          <Container size="wide">
            <MarketplaceCatalogClient
              listings={listings}
              primaryWorkspaceSlug={primaryWorkspace?.slug ?? null}
              signedIn={Boolean(user)}
            />
          </Container>
        </Section>

        {/* Architecture & Publish callout */}
        <div className="dark">
          <Aurora intensity={1.1}>
            <Section invert className="overflow-hidden">
              <div className="bg-grid pointer-events-none absolute inset-0 opacity-40" />
              <Container size="wide" className="relative">
                <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
                  <div>
                    <Eyebrow>Open protocols · Strict isolation</Eyebrow>
                    <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.08] tracking-tight md:text-5xl">
                      One scoped key reaches{' '}
                      <span className="serif-italic text-paper/75 font-normal">
                        every host and runtime.
                      </span>
                    </h2>
                    <p className="text-paper/65 mt-5 max-w-xl text-base leading-relaxed">
                      Horus speaks native Streamable-HTTP Model Context Protocol alongside typed
                      REST v1 and `@horus/sdk`. Signed-in teams can attach listings inside their
                      Horus agents, connect outside IDEs, or publish their own curated collections
                      and MCP servers to the directory.
                    </p>
                    <div className="mt-7 flex flex-wrap gap-3">
                      <Link
                        href={
                          primaryWorkspace ? `/t/${primaryWorkspace.slug}/marketplace` : '/signup'
                        }
                        className="bg-accent hover:shadow-blue inline-flex h-11 items-center rounded-full px-6 text-[14px] font-medium text-white transition-all"
                      >
                        {primaryWorkspace ? 'Publish from your workspace' : 'Publish your index'}
                      </Link>
                      <Link
                        href="/api/v1/marketplace"
                        className="border-paper/20 text-paper hover:border-paper/40 inline-flex h-11 items-center rounded-full border px-6 text-[14px] font-medium transition-colors"
                      >
                        JSON Registry API
                      </Link>
                    </div>
                  </div>

                  <div className="border-paper/10 bg-paper/5 rounded-3xl border p-6 backdrop-blur-md">
                    <div className="font-technical text-paper/50 mb-3 text-[11px] uppercase tracking-wider">
                      .cursor/mcp.json · Streamable HTTP
                    </div>
                    <pre className="font-technical text-paper/90 overflow-x-auto text-[12.5px] leading-[1.8]">
                      {`{
  "mcpServers": {
    "horus-policy-index": {
      "type": "http",
      "url": "https://horus.ai/api/mcp/careercraft-index",
      "headers": {
        "Authorization": "Bearer horus_sk_live_..."
      }
    },
    "horus-interview-coach": {
      "type": "http",
      "url": "https://horus.ai/api/mcp/interview-coach",
      "headers": {
        "Authorization": "Bearer horus_sk_live_..."
      }
    }
  }
}`}
                    </pre>
                  </div>
                </div>
              </Container>
            </Section>
          </Aurora>
        </div>
      </main>

      <MarketingFooter />
    </>
  );
}
