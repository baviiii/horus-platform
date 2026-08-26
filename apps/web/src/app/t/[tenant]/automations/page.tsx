import { prisma } from '@horus/db';
import { PageHeader, Panel, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { AutomationsClient } from './automations-client';

export const metadata = { title: 'Automations · Horus' };
export const dynamic = 'force-dynamic';

export default async function AutomationsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const [automations, active, paused, runs] = await Promise.all([
    prisma.automation.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.automation.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
    prisma.automation.count({ where: { tenantId: tenant.id, status: 'PAUSED' } }),
    prisma.automation.aggregate({
      where: { tenantId: tenant.id },
      _sum: { runCount: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Customer portal · Automations"
        title="Trigger → action rules for this tenant."
        description="Wire events (a document finishing ingestion, a chat session ending, a schedule, an inbound webhook) to actions (alert, email, webhook, AI inference). Phase 1 is the registry + on/off switch; a worker picks up ACTIVE automations."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Total" value={String(automations.length)} />
        <StatCard label="Active" value={String(active)} />
        <StatCard label="Paused" value={String(paused)} />
        <StatCard label="Total runs" value={String(runs._sum.runCount ?? 0)} />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="Automations">
          <AutomationsClient
            initial={automations.map((a) => ({
              id: a.id,
              name: a.name,
              description: a.description,
              trigger: a.trigger,
              status: a.status,
              runCount: a.runCount,
              lastRunAt: a.lastRunAt?.toISOString() ?? null,
              lastError: a.lastError,
            }))}
          />
        </Panel>
      </Reveal>
    </>
  );
}
