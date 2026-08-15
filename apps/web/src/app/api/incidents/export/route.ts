import { prisma } from '@horus/db';
import {
  categoryByKey,
  computeDeadlines,
  deidentifyIncident,
  NDIS_PACK,
  normalizeTemplateSchema,
  renderIncidentDocx,
  type IncidentFields,
} from '@horus/core/incidents';
import { requireMemberApi } from '@/lib/tenant-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * GET /api/incidents/export?tenant=slug&id=...&mode=identified|deidentified
 *
 * Renders the incident as .docx. De-identified mode runs the full de-ID
 * pipeline and persists the pseudonym map so re-exports stay stable. An
 * APPROVED incident becomes EXPORTED on its first export; drafts export with
 * a NOT-APPROVED banner. Horus never submits anywhere — this download is the
 * end of our involvement, by design.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get('tenant') ?? '';
  const id = url.searchParams.get('id') ?? '';
  const mode = url.searchParams.get('mode') === 'deidentified' ? 'deidentified' : 'identified';
  if (!slug || !id) return Response.json({ error: 'Missing params' }, { status: 400 });

  const auth = await requireMemberApi(slug);
  if ('error' in auth) return auth.error;

  const incident = await prisma.incident.findFirst({
    where: { id, tenantId: auth.tenant.id },
    include: {
      template: true,
      evidence: { orderBy: { createdAt: 'asc' } },
      events: { where: { kind: 'approved' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!incident || !incident.template) {
    return Response.json({ error: 'Incident or template not found' }, { status: 404 });
  }

  const schema = normalizeTemplateSchema(incident.template.schema);
  let fields = (incident.fields ?? {}) as IncidentFields;
  let title = incident.title;
  let summary = incident.summary ?? '';
  let evidenceTexts = incident.evidence.map((e) => ({ id: e.id, text: e.text ?? '' }));
  let deidDegraded = false;

  if (mode === 'deidentified') {
    const deid = await deidentifyIncident({
      schema,
      fields,
      title,
      summary,
      evidenceTexts,
      existingMap: (incident.deidMap ?? undefined) as Record<string, string> | undefined,
    });
    fields = deid.fields;
    title = deid.title;
    summary = deid.summary;
    evidenceTexts = deid.evidenceTexts;
    deidDegraded = !deid.languageServiceUsed;
    // Stable pseudonyms across re-exports.
    await prisma.incident.update({
      where: { id: incident.id },
      data: { deidMap: deid.map as object },
    });
  }

  const approvedEvent = incident.events[0];
  const approverEmail =
    approvedEvent && typeof (approvedEvent.meta as { email?: unknown })?.email === 'string'
      ? (approvedEvent.meta as { email: string }).email
      : null;

  const awareAt = incident.discoveredAt ?? incident.occurredAt ?? incident.createdAt;
  const deadlineBasis = incident.categoryKey
    ? computeDeadlines(incident.categoryKey, awareAt).basis
    : null;

  const branding = ((auth.tenant.config as Record<string, unknown>)?.branding ?? {}) as {
    name?: string;
  };

  const evidenceById = new Map(evidenceTexts.map((e) => [e.id, e.text]));
  const buffer = await renderIncidentDocx({
    org: branding.name || auth.tenant.name,
    templateName: incident.template.name,
    mode,
    incident: {
      ref: incident.ref,
      title,
      status: incident.status,
      severity: incident.severity,
      categoryLabel: categoryByKey(incident.categoryKey)?.label ?? null,
      occurredAt: incident.occurredAt,
      discoveredAt: incident.discoveredAt,
      location: incident.location,
      summary,
      notifyDueAt: incident.notifyDueAt,
      reportDueAt: incident.reportDueAt,
      deadlineBasis,
      approvedByName: incident.approvedById ? (approverEmail ?? 'Workspace admin') : null,
      approvedAt: incident.approvedAt,
      createdAt: incident.createdAt,
    },
    schema,
    fields,
    evidence: incident.evidence.map((e) => ({
      label: mode === 'deidentified' ? e.kind.toLowerCase() : e.label,
      kind: e.kind,
      text: evidenceById.get(e.id) ?? null,
    })),
    disclaimer: NDIS_PACK.disclaimer,
    deidDegraded,
  });

  // First export of an approved incident advances the lifecycle.
  if (incident.status === 'APPROVED') {
    await prisma.incident.update({
      where: { id: incident.id },
      data: { status: 'EXPORTED', exportedAt: incident.exportedAt ?? new Date() },
    });
  }
  await prisma.incidentEvent.create({
    data: {
      tenantId: auth.tenant.id,
      incidentId: incident.id,
      kind: mode === 'deidentified' ? 'exported_deidentified' : 'exported_identified',
      actorId: auth.user.id,
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: auth.tenant.id,
      userId: auth.user.id,
      action: `incidents.export.${mode}`,
      resource: 'incident',
      resourceId: incident.id,
      metadata: { ref: incident.ref },
    },
  });

  const filename = `${incident.ref}${mode === 'deidentified' ? '-deidentified' : ''}.docx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': DOCX_MIME,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
