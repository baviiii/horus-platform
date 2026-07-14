import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';

export const metadata = { title: 'Knowledge graph · Horus' };
export const dynamic = 'force-dynamic';

export default async function GraphPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const [entityCount, relationshipCount, topEntities] = await Promise.all([
    prisma.entity.count({ where: { tenantId: tenant.id } }),
    prisma.relationship.count({ where: { tenantId: tenant.id } }),
    prisma.entity.findMany({
      where: { tenantId: tenant.id },
      include: { _count: { select: { documents: true, outgoing: true, incoming: true } } },
      orderBy: { documents: { _count: 'desc' } },
      take: 10,
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Knowledge graph"
        title="Entities, relationships, paths."
        description="Extracted from your documents as they index — organizations, concepts, obligations and how they connect."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-3">
        <StatCard label="Entities" value={entityCount.toLocaleString()} />
        <StatCard label="Relationships" value={relationshipCount.toLocaleString()} />
        <StatCard
          label="Avg links / entity"
          value={entityCount > 0 ? (relationshipCount / entityCount).toFixed(1) : '—'}
        />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="Most connected entities">
          {topEntities.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-ink text-[15px] font-medium">Graph is empty.</p>
              <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
                Entity extraction runs during document ingestion — once workspace documents flow,
                this graph populates automatically.
              </p>
            </div>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {topEntities.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-ink text-[14px] font-medium">{e.name}</span>
                    <Pill>{e.type}</Pill>
                  </div>
                  <span className="num text-ink-faded text-[12px]">
                    {e._count.documents} docs · {e._count.outgoing + e._count.incoming} links
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
