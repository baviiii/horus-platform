import { redirect } from 'next/navigation';
import { prisma } from '@horus/db';
import { NDIS_PACK } from '@horus/core/incidents';
import { PageHeader } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { NewIncidentClient } from './new-client';

export const metadata = { title: 'New incident · Horus' };
export const dynamic = 'force-dynamic';

export default async function NewIncidentPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const templates = await prisma.incidentTemplate.findMany({
    where: { tenantId: tenant.id, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true },
  });
  if (templates.length === 0) redirect(`/t/${slug}/incidents/templates`);

  return (
    <>
      <PageHeader
        eyebrow="Incidents / New"
        title="Tell it once."
        description="Write what happened the way you'd tell a colleague. Attach photos or documents if you have them. Horus fills your form with cited values and flags what's still missing."
      />
      <Reveal as="div">
        <NewIncidentClient
          slug={slug}
          templates={templates}
          categories={NDIS_PACK.categories.map((c) => ({ key: c.key, label: c.label }))}
        />
      </Reveal>
    </>
  );
}
