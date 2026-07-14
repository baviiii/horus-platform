import { prisma } from '@horus/db';
import { PageHeader, Panel, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';

export const metadata = { title: 'Usage & billing · Admin · Horus' };
export const dynamic = 'force-dynamic';

const METER_LABELS: Record<string, string> = {
  RAG_QUERIES: 'RAG queries',
  AGENTIC_QUERIES: 'Agentic queries',
  GRAPH_QUERIES: 'Graph queries',
  EMBEDDINGS: 'Embeddings',
  DOCUMENTS_PROCESSED: 'Documents processed',
  COMPLETION_TOKENS_IN: 'Tokens in',
  COMPLETION_TOKENS_OUT: 'Tokens out',
  STORAGE_BYTES: 'Storage bytes',
};

export default async function UsagePage() {
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [byMeter, records30d, chatTokens] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ['meter'],
      where: { occurredAt: { gte: since30d } },
      _sum: { quantity: true },
    }),
    prisma.usageRecord.count({ where: { occurredAt: { gte: since30d } } }),
    // Chat message token columns are the live usage signal until metering lands everywhere.
    prisma.chatMessage.aggregate({
      where: { createdAt: { gte: since30d } },
      _sum: { tokensIn: true, tokensOut: true },
      _count: true,
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Usage."
        description="Metered usage across all tenants — 30-day window, live from the database."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Usage records · 30d" value={records30d.toLocaleString()} />
        <StatCard label="Chat messages · 30d" value={chatTokens._count.toLocaleString()} />
        <StatCard
          label="Tokens in · 30d"
          value={(chatTokens._sum.tokensIn ?? 0).toLocaleString()}
        />
        <StatCard
          label="Tokens out · 30d"
          value={(chatTokens._sum.tokensOut ?? 0).toLocaleString()}
        />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel
          title="Meters · 30d"
          description="UsageRecord sums by meter. Billing (Stripe) attaches to these meters later."
        >
          {byMeter.length === 0 ? (
            <p className="text-ink-faded py-2 text-[13.5px]">
              No usage records yet — metering writes land as the platform surfaces emit them. Chat
              token counts above come from persisted chat messages.
            </p>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {byMeter.map((m) => (
                <li key={m.meter} className="flex items-center justify-between py-3 text-[13.5px]">
                  <span className="text-ink font-medium">{METER_LABELS[m.meter] ?? m.meter}</span>
                  <span className="num text-ink-faded">
                    {(m._sum.quantity ?? 0n).toLocaleString()}
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
