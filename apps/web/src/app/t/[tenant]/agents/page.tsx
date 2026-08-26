import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { AgentsClient } from './agents-client';

export const metadata = { title: 'Agents · Horus' };
export const dynamic = 'force-dynamic';

export default async function AgentsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const [agents, collections, active, drafts] = await Promise.all([
    prisma.agent.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.knowledgeCollection.findMany({
      where: { tenantId: tenant.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.agent.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
    prisma.agent.count({ where: { tenantId: tenant.id, status: 'DRAFT' } }),
  ]);

  const collectionsById = Object.fromEntries(collections.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        eyebrow="Customer portal · Agents"
        title="Chat and voice surfaces for this tenant's customers."
        description="Each agent is grounded in one or more knowledge collections and can carry MCP tool connections. Voice is configured here and switched on when a voice provider connection exists."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Total agents" value={String(agents.length)} />
        <StatCard label="Active" value={String(active)} />
        <StatCard label="Drafts" value={String(drafts)} />
        <StatCard label="Collections" value={String(collections.length)} />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="Agents">
          <AgentsClient
            slug={slug}
            collections={collections}
            initial={agents.map((a) => ({
              id: a.id,
              name: a.name,
              slug: a.slug,
              kind: a.kind,
              status: a.status,
              persona: a.persona,
              collectionIds: a.collectionIds,
              toolSlugs: a.toolSlugs,
            }))}
            collectionNames={collectionsById}
          />
        </Panel>
      </Reveal>

      <Reveal as="div" className="mt-6">
        <Panel title="Embed or expose" description="How customers reach an agent once it's active.">
          <div className="text-ink-faded space-y-2 text-[13.5px] leading-relaxed">
            <p>
              <Pill tone="accent">End-user portal</Pill> Every active chat agent appears
              automatically in the tenant's end-user portal at{' '}
              <code className="text-ink text-[12px]">/t/{slug}/portal</code>.
            </p>
            <p>
              <Pill tone="accent">Embed</Pill> Copy the agent slug into a widget snippet (iframe or
              web component) — the snippet template lives in{' '}
              <code className="text-ink text-[12px]">docs/CUSTOMER-PORTAL-MAP.md</code>.
            </p>
            <p>
              <Pill tone="accent">Voice</Pill> Switch an agent to <em>voice</em> or <em>hybrid</em>{' '}
              and fill in `voiceConfig` (provider, voice, language). The portal shows the voice
              surface once a voice connection is live.
            </p>
          </div>
        </Panel>
      </Reveal>
    </>
  );
}
