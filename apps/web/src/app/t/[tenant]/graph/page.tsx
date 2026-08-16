import { prisma } from '@horus/db';
import { PageHeader, Panel, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { GraphExplorer } from './graph-explorer';

export const metadata = { title: 'Knowledge graph · Horus' };
export const dynamic = 'force-dynamic';

export default async function GraphPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const [entityCount, relationshipCount, byType, docsInGraph] = await Promise.all([
    prisma.entity.count({ where: { tenantId: tenant.id } }),
    prisma.relationship.count({ where: { tenantId: tenant.id } }),
    prisma.entity.groupBy({
      by: ['type'],
      where: { tenantId: tenant.id },
      _count: true,
      orderBy: { _count: { type: 'desc' } },
    }),
    prisma.documentEntity
      .findMany({
        where: { tenantId: tenant.id },
        select: { documentId: true },
        distinct: ['documentId'],
      })
      .then((rows) => rows.length),
  ]);

  const types = byType.map((t) => ({ type: t.type, count: t._count }));
  const maxType = Math.max(1, ...types.map((t) => t.count));

  return (
    <>
      <PageHeader
        eyebrow="Knowledge graph"
        title="Entities, relationships, paths."
        description="Extracted from this workspace's documents — organisations, programs, sectors, occupations, skills and how they connect. Every edge carries the sentence it came from."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Entities" value={entityCount.toLocaleString()} />
        <StatCard label="Relationships" value={relationshipCount.toLocaleString()} />
        <StatCard
          label="Avg links / entity"
          value={entityCount > 0 ? (relationshipCount / entityCount).toFixed(1) : '—'}
        />
        <StatCard label="Documents in graph" value={String(docsInGraph)} />
      </div>

      {entityCount === 0 ? (
        <Reveal as="div" className="mt-8">
          <Panel>
            <div className="py-8 text-center">
              <p className="text-ink text-[15px] font-medium">Graph is empty.</p>
              <p className="text-ink-faded mx-auto mt-1.5 max-w-lg text-[13.5px] leading-relaxed">
                Ingest documents, then run{' '}
                <code className="bg-paper-soft rounded px-1.5 py-0.5 text-[12.5px]">
                  pnpm exec tsx scripts/build-graph.ts
                </code>{' '}
                to extract entities and relationships from them.
              </p>
            </div>
          </Panel>
        </Reveal>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-4">
          <Reveal as="div" className="lg:col-span-1">
            <Panel title="Entity types">
              <ul className="space-y-3">
                {types.map((t) => (
                  <li key={t.type}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-ink truncate text-[13px]">
                        {t.type.replace(/_/g, ' ')}
                      </span>
                      <span className="num text-ink-faded text-[12px]">{t.count}</span>
                    </div>
                    <div className="bg-paper-soft mt-1.5 h-1.5 overflow-hidden rounded-full">
                      <div
                        className="bg-accent/70 h-full rounded-full"
                        style={{ width: `${Math.max(6, (t.count / maxType) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </Reveal>

          <Reveal as="div" className="lg:col-span-3">
            <GraphExplorer types={types.map((t) => t.type)} />
          </Reveal>
        </div>
      )}
    </>
  );
}
