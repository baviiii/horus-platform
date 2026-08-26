import Link from 'next/link';
import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';

export const metadata = { title: 'Customer portal · Horus' };
export const dynamic = 'force-dynamic';

export default async function PortalHome({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ agent?: string }>;
}) {
  const { tenant: slug } = await params;
  const { agent: agentSlug } = await searchParams;
  const { tenant } = await requireTenantMember(slug);

  const agents = await prisma.agent.findMany({
    where: { tenantId: tenant.id, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
  });

  const branding = ((tenant.config as Record<string, unknown>)?.branding ?? {}) as {
    name?: string;
  };
  const displayName = branding.name || tenant.name;

  const featured = agentSlug ? agents.find((a) => a.slug === agentSlug) : undefined;

  return (
    <>
      <PageHeader
        eyebrow={displayName}
        title="How can we help?"
        description="Pick an assistant below. Each one is grounded in its own knowledge — answers cite the passages they came from."
      />

      {featured && (
        <Reveal as="div" className="mb-6">
          <Panel title={featured.name} description={featured.persona ?? undefined}>
            <div className="flex items-center gap-3">
              <Link
                href={`/t/${slug}/portal/chat?agent=${featured.slug}`}
                className="bg-accent text-accent-ink hover:bg-accent/90 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors"
              >
                Start chat
              </Link>
              {(featured.kind === 'VOICE' || featured.kind === 'HYBRID') && (
                <Link
                  href={`/t/${slug}/portal/voice?agent=${featured.slug}`}
                  className="border-hairline text-ink hover:border-accent/50 rounded-xl border px-4 py-2.5 text-[13px] font-medium transition-colors"
                >
                  Talk instead
                </Link>
              )}
            </div>
          </Panel>
        </Reveal>
      )}

      <Reveal as="div">
        <Panel title="Assistants">
          {agents.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-ink text-[15px] font-medium">Nothing here yet.</p>
              <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
                Once the workspace publishes an agent, it shows up here.
              </p>
            </div>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {agents.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-ink text-[14.5px] font-medium">{a.name}</span>
                      <Pill tone="accent">{a.kind.toLowerCase()}</Pill>
                    </div>
                    {a.persona && (
                      <p className="text-ink-faded mt-1 line-clamp-2 text-[13px]">{a.persona}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/t/${slug}/portal/chat?agent=${a.slug}`}
                      className="bg-accent text-accent-ink hover:bg-accent/90 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition-colors"
                    >
                      Chat
                    </Link>
                    {(a.kind === 'VOICE' || a.kind === 'HYBRID') && (
                      <Link
                        href={`/t/${slug}/portal/voice?agent=${a.slug}`}
                        className="border-hairline text-ink hover:border-accent/50 rounded-lg border px-3.5 py-2 text-[12.5px] font-medium transition-colors"
                      >
                        Voice
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
