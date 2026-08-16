import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { UploadDocumentsButton } from './upload-button';

export const metadata = { title: 'Documents · Horus' };
export const dynamic = 'force-dynamic';

export default async function DocumentsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const [documents, indexed, processing, failed] = await Promise.all([
    prisma.document.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.document.count({ where: { tenantId: tenant.id, status: 'INDEXED' } }),
    prisma.document.count({
      where: { tenantId: tenant.id, status: { in: ['PENDING', 'PROCESSING'] } },
    }),
    prisma.document.count({ where: { tenantId: tenant.id, status: 'FAILED' } }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="The knowledge this workspace runs on."
        description="Every document here is chunked, embedded, and indexed for retrieval. Agents cite them by passage."
        actions={<UploadDocumentsButton slug={slug} />}
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Total" value={String(documents.length)} />
        <StatCard label="Indexed" value={String(indexed)} />
        <StatCard label="Processing" value={String(processing)} />
        <StatCard label="Failed" value={String(failed)} />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="All documents">
          {documents.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-ink text-[15px] font-medium">No documents yet.</p>
              <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
                Upload a PDF and it runs the same chunk → embed → index pipeline as the playground,
                into this workspace's permanent partition. The workspace agent cites it by passage
                from that moment on.
              </p>
            </div>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {documents.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-ink truncate text-[14px] font-medium">{doc.title}</div>
                    <div className="text-ink-faded mt-0.5 flex flex-wrap items-center gap-2 text-[12px]">
                      <span>{doc.category ?? 'document'}</span>
                      <span>·</span>
                      <span>{doc.chunksCount} chunks</span>
                      {doc.pageCount ? (
                        <>
                          <span>·</span>
                          <span>{doc.pageCount} pp</span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span>{doc.createdAt.toLocaleDateString()}</span>
                    </div>
                    {doc.errorMessage && (
                      <div className="text-destructive mt-1 text-[12px]">{doc.errorMessage}</div>
                    )}
                  </div>
                  <Pill
                    tone={
                      doc.status === 'INDEXED'
                        ? 'success'
                        : doc.status === 'FAILED'
                          ? 'danger'
                          : 'warn'
                    }
                  >
                    {doc.status.toLowerCase()}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
