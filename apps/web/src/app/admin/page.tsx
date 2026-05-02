import { prisma } from '@horus/db';

export default async function AdminOverview() {
  const [tenantCount, documentCount, queryCount] = await Promise.all([
    prisma.tenant.count(),
    prisma.document.count(),
    prisma.usageRecord.aggregate({
      where: { meter: 'RAG_QUERIES' },
      _sum: { quantity: true },
    }),
  ]);

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Stat label="Tenants" value={tenantCount} />
      <Stat label="Documents indexed" value={documentCount} />
      <Stat label="Total RAG queries" value={Number(queryCount._sum.quantity ?? 0)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}
