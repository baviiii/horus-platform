import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { KnowledgeClient } from './knowledge-client';

export const metadata = { title: 'Knowledge · Horus' };
export const dynamic = 'force-dynamic';

export default async function KnowledgePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const [collections, ungrouped, totalDocs, totalChunks] = await Promise.all([
    prisma.knowledgeCollection.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { documents: true } } },
    }),
    prisma.document.count({ where: { tenantId: tenant.id, collectionId: null } }),
    prisma.document.count({ where: { tenantId: tenant.id } }),
    prisma.chunk.count({ where: { tenantId: tenant.id } }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Customer portal · Knowledge"
        title="Collections of what this tenant knows."
        description="Group documents into named silos. Agents and voice surfaces bind to one or more collections so each customer-facing surface stays scoped to its own knowledge."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Collections" value={String(collections.length)} />
        <StatCard label="Documents" value={String(totalDocs)} />
        <StatCard label="Ungrouped" value={String(ungrouped)} />
        <StatCard label="Chunks" value={String(totalChunks)} />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="Collections">
          <KnowledgeClient
            slug={slug}
            initial={collections.map((c) => ({
              id: c.id,
              name: c.name,
              slug: c.slug,
              description: c.description,
              category: c.category,
              isDefault: c.isDefault,
              docCount: c._count.documents,
            }))}
          />
        </Panel>
      </Reveal>

      <Reveal as="div" className="mt-6">
        <Panel
          title="How it fits"
          description="Documents → collections → agents. The same partition flows through chat, voice and automations."
        >
          <div className="text-ink-faded grid gap-3 text-[13.5px] leading-relaxed md:grid-cols-3">
            <div>
              <Pill tone="accent">1 · ingest</Pill>
              <p className="mt-2">
                Upload PDFs from{' '}
                <a className="text-accent underline" href={`/t/${slug}/documents`}>
                  Documents
                </a>{' '}
                — they land in the workspace partition, optionally tagged with a collection.
              </p>
            </div>
            <div>
              <Pill tone="accent">2 · group</Pill>
              <p className="mt-2">
                Collections bundle documents by audience or topic (e.g. "NDIS policies", "Product
                help"). One collection can back many agents.
              </p>
            </div>
            <div>
              <Pill tone="accent">3 · expose</Pill>
              <p className="mt-2">
                Bind a collection to an{' '}
                <a className="text-accent underline" href={`/t/${slug}/agents`}>
                  agent
                </a>{' '}
                and the chat or voice surface cites only that knowledge.
              </p>
            </div>
          </div>
        </Panel>
      </Reveal>
    </>
  );
}
