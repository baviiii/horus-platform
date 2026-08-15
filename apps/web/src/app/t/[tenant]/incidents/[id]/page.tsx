import { notFound } from 'next/navigation';
import { prisma } from '@horus/db';
import { categoryByKey, NDIS_PACK, normalizeTemplateSchema } from '@horus/core/incidents';
import { requireTenantMember } from '@/lib/tenant-context';
import { IncidentClient, type IncidentView } from './incident-client';

export const metadata = { title: 'Incident · Horus' };
export const dynamic = 'force-dynamic';

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant: slug, id } = await params;
  const { tenant, user } = await requireTenantMember(slug);

  const incident = await prisma.incident.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      template: true,
      evidence: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  if (!incident || !incident.template) notFound();

  const schema = normalizeTemplateSchema(incident.template.schema);

  const view: IncidentView = {
    id: incident.id,
    ref: incident.ref,
    title: incident.title,
    status: incident.status,
    severity: incident.severity,
    categoryKey: incident.categoryKey,
    categoryLabel: categoryByKey(incident.categoryKey)?.label ?? null,
    occurredAt: incident.occurredAt?.toISOString() ?? null,
    discoveredAt: incident.discoveredAt?.toISOString() ?? null,
    location: incident.location,
    summary: incident.summary,
    fields: incident.fields as unknown as IncidentView['fields'],
    missingRequired: incident.missingRequired,
    notifyDueAt: incident.notifyDueAt?.toISOString() ?? null,
    reportDueAt: incident.reportDueAt?.toISOString() ?? null,
    approvedAt: incident.approvedAt?.toISOString() ?? null,
    createdAt: incident.createdAt.toISOString(),
    templateName: incident.template.name,
    schema,
    evidence: incident.evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      text: e.text,
      createdAt: e.createdAt.toISOString(),
    })),
    events: incident.events.map((e) => ({
      id: e.id,
      kind: e.kind,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  };

  return (
    <IncidentClient
      slug={slug}
      incident={view}
      role={user.role}
      categories={NDIS_PACK.categories.map((c) => ({ key: c.key, label: c.label }))}
      disclaimer={NDIS_PACK.disclaimer}
    />
  );
}
