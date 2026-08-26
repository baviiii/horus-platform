import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';

export const metadata = { title: 'Usage · Horus' };
export const dynamic = 'force-dynamic';

const METER_LABEL: Record<string, string> = {
  RAG_QUERIES: 'RAG queries',
  AGENTIC_QUERIES: 'Agentic queries',
  GRAPH_QUERIES: 'Graph queries',
  EMBEDDINGS: 'Embeddings',
  DOCUMENTS_PROCESSED: 'Documents processed',
  COMPLETION_TOKENS_IN: 'Tokens in',
  COMPLETION_TOKENS_OUT: 'Tokens out',
  STORAGE_BYTES: 'Storage (bytes)',
};

export default async function UsagePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [meters, documents, sessions, agents, recent] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ['meter'],
      where: { tenantId: tenant.id, occurredAt: { gte: since30d } },
      _sum: { quantity: true },
      _count: true,
    }),
    prisma.document.count({ where: { tenantId: tenant.id } }),
    prisma.chatSession.count({ where: { tenantId: tenant.id, createdAt: { gte: since30d } } }),
    prisma.agent.count({ where: { tenantId: tenant.id, status: 'ACTIVE' } }),
    prisma.usageRecord.findMany({
      where: { tenantId: tenant.id },
      orderBy: { occurredAt: 'desc' },
      take: 25,
    }),
  ]);

  const meterMap = new Map(meters.map((m) => [m.meter, m]));
  const get = (key: string) => meterMap.get(key as never);
  const num = (v: bigint | null | undefined) => (v == null ? 0 : Number(v));

  return (
    <>
      <PageHeader
        eyebrow="Customer portal · Usage"
        title="What this tenant consumed — last 30 days."
        description="Read-only view over usage_records. Billing lives under Settings → Billing; this page is about visibility: tokens, queries, embeddings, documents."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard
          label="Tokens in (30d)"
          value={num(get('COMPLETION_TOKENS_IN')?._sum.quantity).toLocaleString()}
        />
        <StatCard
          label="Tokens out (30d)"
          value={num(get('COMPLETION_TOKENS_OUT')?._sum.quantity).toLocaleString()}
        />
        <StatCard
          label="RAG queries (30d)"
          value={num(get('RAG_QUERIES')?._sum.quantity).toLocaleString()}
        />
        <StatCard
          label="Documents processed (30d)"
          value={num(get('DOCUMENTS_PROCESSED')?._sum.quantity).toLocaleString()}
        />
      </div>

      <Reveal as="div" className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel title="All meters (30d)">
          {meters.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-ink text-[15px] font-medium">No usage recorded yet.</p>
              <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
                Once the tenant starts chatting, uploading, or running agents, meters show up here.
              </p>
            </div>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {meters.map((m) => (
                <li key={m.meter} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Pill tone="accent">{METER_LABEL[m.meter] ?? m.meter}</Pill>
                    <span className="text-ink-mute text-[12px]">{m._count} events</span>
                  </div>
                  <div className="text-ink num text-[14px] font-semibold">
                    {num(m._sum.quantity).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Snapshot">
          <ul className="text-ink-faded space-y-2 text-[13.5px]">
            <li className="flex justify-between">
              <span>Documents in knowledge</span>
              <span className="text-ink font-medium">{documents}</span>
            </li>
            <li className="flex justify-between">
              <span>Chat sessions (30d)</span>
              <span className="text-ink font-medium">{sessions}</span>
            </li>
            <li className="flex justify-between">
              <span>Active agents</span>
              <span className="text-ink font-medium">{agents}</span>
            </li>
          </ul>
        </Panel>
      </Reveal>

      <Reveal as="div" className="mt-6">
        <Panel title="Recent activity">
          {recent.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-ink-faded text-[13.5px]">Nothing yet.</p>
            </div>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 py-2">
                  <div>
                    <span className="text-ink text-[13px] font-medium">
                      {METER_LABEL[r.meter] ?? r.meter}
                    </span>
                    <span className="text-ink-mute ml-2 text-[12px]">
                      {r.occurredAt.toLocaleString()}
                    </span>
                  </div>
                  <span className="text-ink num text-[13px] font-semibold">
                    {Number(r.quantity).toLocaleString()}
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
