import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Database, KeyRound, Plug, ShieldCheck } from 'lucide-react';
import { prisma } from '@horus/db';
import { getMarketplaceCatalogItem } from '@horus/core/marketplace';
import { Container, Eyebrow, MarketingFooter, MarketingNav, Section } from '@/components/horus';
import { LiveExplorer } from '@/components/marketplace/live-explorer';
import { SnippetTabs } from '@/components/marketplace/snippet-tabs';
import { getCurrentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = await getMarketplaceCatalogItem(slug);
  return {
    title: item ? `${item.name} · Horus Marketplace` : 'Marketplace · Horus',
    description: item?.tagline,
  };
}

export default async function MarketplaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getCurrentUser().catch(() => null);

  const memberships = user
    ? await prisma.tenantMember
        .findMany({
          where: { userId: user.id, tenant: { isActive: true } },
          include: { tenant: { select: { id: true, slug: true, name: true, plan: true } } },
          orderBy: { joinedAt: 'asc' },
        })
        .catch(() => [])
    : [];

  const primaryTenant = memberships[0]?.tenant ?? null;
  const item = await getMarketplaceCatalogItem(slug, {
    viewerTenantId: primaryTenant?.id,
  });
  if (!item) notFound();

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  const workspaces = memberships.map((m) => ({
    slug: m.tenant.slug,
    name: m.tenant.name,
    plan: m.tenant.plan,
  }));

  return (
    <>
      <MarketingNav pathname="/marketplace" />

      <main className="bg-paper">
        <Section className="!pb-10 pt-14 md:pt-20">
          <Container size="wide">
            <Link
              href="/marketplace"
              className="text-ink-faded hover:text-ink inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors"
            >
              <ArrowLeft size={14} />
              Back to Marketplace
            </Link>

            <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-3xl">
                <div className="flex flex-wrap items-center gap-2">
                  <Eyebrow dot={false}>
                    <span className="inline-flex items-center gap-1.5">
                      {item.kind === 'INDEX' ? <Database size={13} /> : <Plug size={13} />}
                      {item.kind === 'INDEX' ? 'Knowledge Index + MCP' : 'MCP Tool Server'}
                    </span>
                  </Eyebrow>
                  <span className="border-hairline text-ink-faded font-technical rounded-full border px-2.5 py-0.5 text-[10.5px] uppercase">
                    {item.minPlan} plan+
                  </span>
                  <span className="border-hairline text-ink-faded rounded-full border px-2.5 py-0.5 text-[11px] capitalize">
                    {item.category.replace(/-/g, ' ')}
                  </span>
                </div>

                <h1 className="text-ink mt-4 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
                  {item.name}
                </h1>

                <div className="text-ink-faded mt-3 flex flex-wrap items-center gap-3 text-[13.5px]">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    Published by <strong className="text-ink">{item.publisherName}</strong>
                    {item.verified && <CheckCircle2 size={14} className="text-accent" />}
                  </span>
                  <span>·</span>
                  <span className="font-technical text-[12px]">{item.mcpPath}</span>
                </div>

                <p className="text-ink-faded mt-5 text-base leading-relaxed md:text-lg">
                  {item.description}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {primaryTenant ? (
                  <Link
                    href={`/t/${primaryTenant.slug}/marketplace?focus=${encodeURIComponent(item.slug)}`}
                    className="bg-ink text-paper shadow-blue hover:shadow-blue-lg inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium transition-shadow"
                  >
                    <KeyRound size={15} />
                    {item.slug === 'workspace'
                      ? `Mint key in ${primaryTenant.name}`
                      : `Install & mint key in ${primaryTenant.name}`}
                  </Link>
                ) : (
                  <Link
                    href={`/login?next=${encodeURIComponent(`/marketplace/${item.slug}`)}`}
                    className="bg-ink text-paper shadow-blue inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-medium"
                  >
                    <KeyRound size={15} />
                    Sign in to get API key
                  </Link>
                )}
              </div>
            </div>

            {/* KPI bar */}
            {item.stats ? (
              <div className="border-hairline bg-paper-soft mt-8 grid grid-cols-2 gap-4 rounded-3xl border p-5 md:grid-cols-4">
                <Stat label="Indexed documents" value={item.stats.documents.toLocaleString()} />
                <Stat label="Embedded chunks" value={item.stats.chunks.toLocaleString()} />
                <Stat label="Graph entities" value={item.stats.entities.toLocaleString()} />
                <Stat
                  label="Graph relationships"
                  value={item.stats.relationships.toLocaleString()}
                />
              </div>
            ) : (
              <div className="border-hairline bg-paper-soft mt-8 grid grid-cols-2 gap-4 rounded-3xl border p-5 md:grid-cols-4">
                <Stat label="MCP tools" value={String(item.tools.length)} />
                <Stat label="Transport" value="Streamable HTTP" />
                <Stat label="Session state" value="Stateless" />
                <Stat label="Auth" value="Horus API key" />
              </div>
            )}
          </Container>
        </Section>

        <Section className="!pt-4">
          <Container size="wide">
            <div className="grid gap-8 lg:grid-cols-12">
              {/* Left 7 cols: Live explorer + Tools schema + Categories */}
              <div className="space-y-8 lg:col-span-7">
                <LiveExplorer
                  listingSlug={item.slug}
                  kind={item.kind}
                  samplePrompts={item.samplePrompts}
                  tools={item.tools}
                  workspaces={workspaces}
                  signedIn={Boolean(user)}
                />

                {/* Exposed MCP Tools */}
                <div className="border-hairline bg-paper rounded-3xl border p-6 md:p-7">
                  <h2 className="text-ink text-lg font-semibold tracking-tight">
                    Exposed MCP tools ({item.tools.length})
                  </h2>
                  <p className="text-ink-faded mt-1 text-[13.5px]">
                    Available automatically when connected over Streamable-HTTP MCP or attached to a
                    Horus workspace agent.
                  </p>

                  <div className="divide-hairline mt-4 divide-y">
                    {item.tools.map((tool) => {
                      const props = (
                        tool.inputSchema as {
                          properties?: Record<string, { type?: string; description?: string }>;
                          required?: string[];
                        }
                      )?.properties;
                      const reqSet = new Set(
                        (tool.inputSchema as { required?: string[] })?.required ?? [],
                      );
                      const propEntries = props ? Object.entries(props) : [];

                      return (
                        <div key={tool.name} className="py-4 first:pt-2 last:pb-1">
                          <div className="flex items-center gap-2">
                            <code className="font-technical text-accent text-[13.5px] font-semibold">
                              {tool.name}
                            </code>
                            <span className="border-hairline text-ink-mute font-technical rounded-full border px-2 py-0.5 text-[10px]">
                              MCP tool
                            </span>
                          </div>
                          <p className="text-ink-faded mt-1 text-[13.5px] leading-relaxed">
                            {tool.description}
                          </p>
                          {propEntries.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {propEntries.map(([k, v]) => (
                                <span
                                  key={k}
                                  className="border-hairline bg-paper-soft font-technical text-ink-soft rounded-lg border px-2 py-0.5 text-[11px]"
                                >
                                  {k}
                                  {reqSet.has(k) ? '*' : '?'}: {v?.type ?? 'any'}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Categories / Tags */}
                {item.stats && item.stats.categories.length > 0 && (
                  <div className="border-hairline bg-paper rounded-3xl border p-6 md:p-7">
                    <h2 className="text-ink text-lg font-semibold tracking-tight">
                      Filterable corpus categories
                    </h2>
                    <p className="text-ink-faded mt-1 text-[13.5px]">
                      Pass any category below to `search_index` or `ask_index` to narrow retrieval.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.stats.categories.map((cat) => (
                        <span
                          key={cat}
                          className="border-hairline bg-paper-soft font-technical text-ink-soft rounded-full border px-3 py-1 text-[12px]"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right 5 cols: Connect Everywhere */}
              <div className="space-y-6 lg:col-span-5">
                <div className="border-hairline bg-paper-soft rounded-3xl border p-6">
                  <h2 className="text-ink text-lg font-semibold tracking-tight">
                    Connect from any platform
                  </h2>
                  <p className="text-ink-faded mt-1 text-[13.5px] leading-relaxed">
                    Use a workspace API key (`horus_sk_live_...`) with `mcp:call` or
                    `marketplace:read` scope. Every call is tenant-isolated and metered to your
                    workspace.
                  </p>

                  <div className="mt-4">
                    <SnippetTabs
                      origin={origin}
                      slug={item.slug}
                      kind={item.kind}
                      firstToolName={item.tools[0]?.name}
                      sampleQuery={item.samplePrompts[0]}
                    />
                  </div>

                  <div className="border-hairline bg-paper mt-5 flex items-start gap-3 rounded-2xl border p-4">
                    <ShieldCheck size={18} className="text-accent mt-0.5 shrink-0" />
                    <div className="text-[12.5px] leading-relaxed">
                      <div className="text-ink font-medium">Read-only, cited &amp; isolated</div>
                      <p className="text-ink-faded mt-0.5">
                        External callers never touch upstream credentials or unpublished workspace
                        collections. Revoke keys anytime in Workspace Settings.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </Section>
      </main>

      <MarketingFooter />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-ink-faded text-[12px] font-medium">{label}</div>
      <div className="num text-ink mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
