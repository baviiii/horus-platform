import { revalidatePath } from 'next/cache';
import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { requireTenantMember } from '@/lib/tenant-context';

export const metadata = { title: 'Alerts · Horus' };
export const dynamic = 'force-dynamic';

export default async function AlertsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const alerts = await prisma.alert.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const open = alerts.filter((a) => a.status === 'OPEN').length;
  const ack = alerts.filter((a) => a.status === 'ACKNOWLEDGED').length;
  const resolved = alerts.filter((a) => a.status === 'RESOLVED').length;

  async function setStatus(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!id || !['ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'].includes(status)) return;
    // Re-verify membership inside the action — actions are public endpoints.
    const ctx = await requireTenantMember(slug);
    await prisma.alert.update({
      where: { id, tenantId: ctx.tenant.id },
      data: {
        status: status as 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED',
        ...(status === 'RESOLVED' && { resolvedAt: new Date() }),
      },
    });
    revalidatePath(`/t/${slug}/alerts`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Alerts"
        title="Signals from your knowledge and feeds."
        description="Anything Horus flags — anomalies, contradictions, source changes — lands here for triage."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-3">
        <StatCard label="Open" value={String(open)} />
        <StatCard label="Acknowledged" value={String(ack)} />
        <StatCard label="Resolved" value={String(resolved)} />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="All alerts">
          {alerts.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-ink text-[15px] font-medium">No alerts.</p>
              <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
                This feed is live — proactive intelligence (feed watchers, contradiction detection)
                will publish here as those modules come online.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => (
                <li key={a.id} className="border-hairline bg-paper rounded-2xl border p-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill
                          tone={
                            a.severity === 'HIGH' || a.severity === 'CRITICAL'
                              ? 'danger'
                              : a.severity === 'MEDIUM'
                                ? 'warn'
                                : 'default'
                          }
                        >
                          {a.severity}
                        </Pill>
                        <Pill
                          tone={
                            a.status === 'OPEN'
                              ? 'danger'
                              : a.status === 'ACKNOWLEDGED'
                                ? 'warn'
                                : 'success'
                          }
                        >
                          {a.status.toLowerCase()}
                        </Pill>
                        <span className="text-ink-mute text-[12px]">
                          {a.createdAt.toLocaleString()}
                        </span>
                      </div>
                      <h3 className="text-ink mt-2 text-[15.5px] font-semibold leading-snug tracking-tight">
                        {a.title}
                      </h3>
                      <p className="text-ink-faded mt-1 text-[13.5px] leading-relaxed">
                        {a.description}
                      </p>
                    </div>
                    {a.status === 'OPEN' && (
                      <div className="flex shrink-0 gap-2">
                        <form action={setStatus}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="status" value="ACKNOWLEDGED" />
                          <Button variant="outline" size="sm" type="submit">
                            Acknowledge
                          </Button>
                        </form>
                        <form action={setStatus}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="status" value="RESOLVED" />
                          <Button size="sm" type="submit">
                            Resolve
                          </Button>
                        </form>
                      </div>
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
