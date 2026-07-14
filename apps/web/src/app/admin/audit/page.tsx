import { prisma } from '@horus/db';
import { PageHeader, Panel, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';

export const metadata = { title: 'Audit log · Admin · Horus' };
export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [entries, total, week] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 100,
      include: { tenant: { select: { slug: true } } },
    }),
    prisma.auditLog.count(),
    prisma.auditLog.count({ where: { occurredAt: { gte: since7d } } }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Audit log."
        description="Every recorded platform action, newest first."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-2">
        <StatCard label="Total entries" value={total.toLocaleString()} />
        <StatCard label="Last 7 days" value={week.toLocaleString()} />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="Recent activity">
          {entries.length === 0 ? (
            <p className="text-ink-faded py-2 text-[13.5px]">
              No audit entries yet — writes appear here as surfaces adopt the audit trail (key
              creation, document uploads, membership changes).
            </p>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 text-[13px]">
                  <span className="mono bg-paper-soft text-ink rounded-md px-2 py-0.5 text-[11.5px]">
                    {e.action}
                  </span>
                  <span className="text-ink-faded min-w-0 flex-1 truncate">
                    {e.resource ?? '—'}
                    {e.resourceId ? ` · ${e.resourceId.slice(0, 8)}` : ''}
                  </span>
                  <span className="font-technical text-ink-mute text-[11.5px]">
                    {e.tenant.slug} · {e.occurredAt.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
