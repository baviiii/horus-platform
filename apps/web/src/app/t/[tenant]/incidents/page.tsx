import Link from 'next/link';
import { prisma } from '@horus/db';
import { categoryByKey, NDIS_PACK } from '@horus/core/incidents';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { requireTenantMember } from '@/lib/tenant-context';
import { severityTone, statusLabel, statusTone } from './ui';

export const metadata = { title: 'Incidents · Horus' };
export const dynamic = 'force-dynamic';

function timeLeft(due: Date, now: Date): { text: string; overdue: boolean } {
  const ms = due.getTime() - now.getTime();
  if (ms <= 0) {
    const hours = Math.floor(-ms / 3_600_000);
    return {
      text: hours < 48 ? `${hours}h overdue` : `${Math.floor(hours / 24)}d overdue`,
      overdue: true,
    };
  }
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return { text: `${hours}h left`, overdue: false };
  return { text: `${Math.floor(hours / 24)}d left`, overdue: false };
}

export default async function IncidentsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [open, inReview, overdue, thisMonth, activeTemplates, byCategory, clocks, recent] =
    await Promise.all([
      prisma.incident.count({
        where: { tenantId: tenant.id, status: { in: ['DRAFT', 'IN_REVIEW'] } },
      }),
      prisma.incident.count({ where: { tenantId: tenant.id, status: 'IN_REVIEW' } }),
      prisma.incident.count({
        where: {
          tenantId: tenant.id,
          status: { in: ['DRAFT', 'IN_REVIEW'] },
          notifyDueAt: { lt: now },
        },
      }),
      prisma.incident.count({ where: { tenantId: tenant.id, createdAt: { gte: monthStart } } }),
      prisma.incidentTemplate.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
      prisma.incident.groupBy({
        by: ['categoryKey'],
        where: { tenantId: tenant.id },
        _count: true,
      }),
      prisma.incident.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: ['DRAFT', 'IN_REVIEW'] },
          notifyDueAt: { not: null },
        },
        orderBy: { notifyDueAt: 'asc' },
        take: 6,
        select: {
          id: true,
          ref: true,
          title: true,
          status: true,
          severity: true,
          categoryKey: true,
          notifyDueAt: true,
          reportDueAt: true,
        },
      }),
      prisma.incident.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { template: { select: { name: true } } },
      }),
    ]);

  const categories = byCategory
    .map((c) => ({
      key: c.categoryKey,
      label: c.categoryKey
        ? (categoryByKey(c.categoryKey)?.label ?? c.categoryKey)
        : 'Unclassified',
      count: c._count,
    }))
    .sort((a, b) => b.count - a.count);
  const maxCategory = Math.max(1, ...categories.map((c) => c.count));

  return (
    <>
      <PageHeader
        eyebrow="Incidents"
        title="Reportable incidents, drafted from evidence."
        description="Describe what happened; Horus fills your own form with cited values, tracks the statutory clocks, and exports the Word document you file. A human approves every report — nothing is ever submitted for you."
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={`/t/${slug}/incidents/templates`}>Templates</Link>
            </Button>
            {activeTemplates === 0 ? (
              <Button size="sm" variant="accent" disabled title="Add a template first">
                New incident
              </Button>
            ) : (
              <Button asChild size="sm" variant="accent">
                <Link href={`/t/${slug}/incidents/new`}>New incident</Link>
              </Button>
            )}
          </>
        }
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Open" value={String(open)} />
        <StatCard label="In review" value={String(inReview)} />
        <StatCard
          label="Overdue clocks"
          value={String(overdue)}
          {...(overdue > 0 && { delta: 'act now', trend: 'down' as const })}
        />
        <StatCard label="This month" value={String(thisMonth)} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <Reveal as="div" className="lg:col-span-3">
          <Panel
            title="Statutory clocks"
            description={`NDIS pack v${NDIS_PACK.version} — notification windows run from when your team became aware.`}
          >
            {clocks.length === 0 ? (
              <p className="text-ink-faded py-4 text-center text-[13.5px]">
                No open incidents with a reportable category. Clocks appear the moment a draft is
                classified.
              </p>
            ) : (
              <ul className="divide-hairline -my-2 divide-y">
                {clocks.map((incident) => {
                  const notify = incident.notifyDueAt ? timeLeft(incident.notifyDueAt, now) : null;
                  return (
                    <li key={incident.id}>
                      <Link
                        href={`/t/${slug}/incidents/${incident.id}`}
                        className="hover:bg-paper-soft -mx-3 flex flex-wrap items-center gap-3 rounded-lg px-3 py-3 transition-colors"
                      >
                        <span className="num text-ink-faded text-[12px]">{incident.ref}</span>
                        <span className="text-ink min-w-0 flex-1 truncate text-[13.5px] font-medium">
                          {incident.title}
                        </span>
                        <span className="text-ink-faded hidden text-[12px] sm:inline">
                          {categoryByKey(incident.categoryKey)?.label ?? 'Unclassified'}
                        </span>
                        {notify && (
                          <Pill tone={notify.overdue ? 'danger' : 'warn'}>
                            notify · {notify.text}
                          </Pill>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-ink-mute mt-4 text-[11.5px] leading-relaxed">
              {NDIS_PACK.disclaimer}
            </p>
          </Panel>
        </Reveal>

        <Reveal as="div" className="lg:col-span-2">
          <Panel title="By category" description="All time, this workspace.">
            {categories.length === 0 ? (
              <p className="text-ink-faded py-4 text-center text-[13.5px]">No incidents yet.</p>
            ) : (
              <ul className="space-y-3">
                {categories.map((c) => (
                  <li key={c.key ?? 'none'}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink truncate text-[13px]">{c.label}</span>
                      <span className="num text-ink-faded text-[12px]">{c.count}</span>
                    </div>
                    <div className="bg-paper-soft mt-1.5 h-1.5 overflow-hidden rounded-full">
                      <div
                        className="bg-accent/70 h-full rounded-full"
                        style={{ width: `${Math.max(6, (c.count / maxCategory) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Reveal>
      </div>

      <Reveal as="div" className="mt-6">
        <Panel title="Recent incidents">
          {recent.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-ink text-[15px] font-medium">No incidents yet.</p>
              <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
                {activeTemplates === 0 ? (
                  <>
                    Start by adding a template — absorb your own incident form, or use the NDIS
                    starter — then report your first incident from a plain-language account.
                  </>
                ) : (
                  <>Report the first one: a few sentences of narrative becomes a cited draft.</>
                )}
              </p>
              <div className="mt-4">
                <Button asChild size="sm" variant="accent">
                  <Link
                    href={
                      activeTemplates === 0
                        ? `/t/${slug}/incidents/templates`
                        : `/t/${slug}/incidents/new`
                    }
                  >
                    {activeTemplates === 0 ? 'Set up a template' : 'New incident'}
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {recent.map((incident) => (
                <li key={incident.id}>
                  <Link
                    href={`/t/${slug}/incidents/${incident.id}`}
                    className="hover:bg-paper-soft -mx-3 flex flex-wrap items-center gap-3 rounded-lg px-3 py-3 transition-colors"
                  >
                    <span className="num text-ink-faded text-[12px]">{incident.ref}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-ink truncate text-[14px] font-medium">
                        {incident.title}
                      </div>
                      <div className="text-ink-faded mt-0.5 text-[12px]">
                        {incident.template?.name ?? 'No template'} ·{' '}
                        {incident.createdAt.toLocaleDateString('en-AU')}
                      </div>
                    </div>
                    <Pill tone={severityTone(incident.severity)}>
                      {incident.severity.toLowerCase()}
                    </Pill>
                    <Pill tone={statusTone(incident.status)}>{statusLabel(incident.status)}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
