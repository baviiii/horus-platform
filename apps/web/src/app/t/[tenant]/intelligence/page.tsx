import { prisma } from '@horus/db';
import { PageHeader } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { IntelligenceClient } from './intelligence-client';

export const metadata = { title: 'Intelligence · Horus' };
export const dynamic = 'force-dynamic';

export default async function IntelligencePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  // Suggested subjects = the graph's best-connected sectors/programs/occupations.
  // Ties the briefing surface directly to what the corpus actually covers.
  const [suggestions, categories, years] = await Promise.all([
    prisma.entity.findMany({
      where: {
        tenantId: tenant.id,
        type: { in: ['sector', 'program', 'occupation', 'organization'] },
      },
      include: { _count: { select: { documents: true } } },
      orderBy: { documents: { _count: 'desc' } },
      take: 12,
    }),
    prisma.document.groupBy({
      by: ['category'],
      where: { tenantId: tenant.id, status: 'INDEXED' },
      _count: true,
    }),
    prisma.document.findMany({
      where: { tenantId: tenant.id, status: 'INDEXED' },
      select: { metadata: true },
    }),
  ]);

  const yearSet = new Set<number>();
  for (const doc of years) {
    const y = (doc.metadata as { year?: unknown })?.year;
    if (typeof y === 'number') yearSet.add(y);
  }

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Deep dives, grounded and cited."
        description="Pick a field, occupation, program or organisation. Horus walks the knowledge graph for structure, retrieves the passages that back it, and writes a brief where every number cites the document it came from."
      />
      <Reveal as="div">
        <IntelligenceClient
          suggestions={suggestions.map((s) => ({ name: s.name, type: s.type }))}
          categories={categories
            .map((c) => c.category)
            .filter((c): c is string => Boolean(c))
            .sort()}
          years={[...yearSet].sort((a, b) => b - a)}
        />
      </Reveal>
    </>
  );
}
