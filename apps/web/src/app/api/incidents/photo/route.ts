import { prisma } from '@horus/db';
import { analyzeIncidentPhoto, photoAnalysisToText } from '@horus/core/incidents';
import { moderateImage } from '@horus/core/safety';
import { requireMemberApi, forbidViewerApi } from '@/lib/tenant-api';
import { storeTenantBlob } from '@/lib/evidence-blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Photo evidence: Content Safety screen → blob store (when configured) →
 * gpt-4o vision analysis → citable IncidentEvidence PHOTO row.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const slug = String(form.get('tenant') ?? '');
  const incidentId = String(form.get('incidentId') ?? '');
  const hint = form.get('hint') ? String(form.get('hint')).slice(0, 300) : undefined;
  const file = form.get('file');
  if (!slug || !incidentId || !(file instanceof File)) {
    return Response.json({ error: 'Missing tenant, incidentId, or file' }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json({ error: 'Supported photo formats: JPEG, PNG, WebP' }, { status: 415 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json({ error: 'Photo must be between 1 byte and 8 MB' }, { status: 400 });
  }

  const auth = await requireMemberApi(slug);
  if ('error' in auth) return auth.error;
  const viewerBlock = forbidViewerApi(auth);
  if (viewerBlock) return viewerBlock;

  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, tenantId: auth.tenant.id },
  });
  if (!incident) return Response.json({ error: 'Unknown incident' }, { status: 404 });

  const data = new Uint8Array(await file.arrayBuffer());

  const verdict = await moderateImage(data);
  if (verdict.blocked) {
    return Response.json(
      { error: `Photo was blocked by the content policy (${verdict.category}).` },
      { status: 400 },
    );
  }

  let analysisText: string;
  try {
    const analysis = await analyzeIncidentPhoto({ data, mimeType: file.type, hint });
    analysisText = photoAnalysisToText(analysis);
  } catch {
    return Response.json({ error: 'Photo analysis failed — try again' }, { status: 502 });
  }

  const blobUrl = await storeTenantBlob({
    tenantId: auth.tenant.id,
    prefix: `incidents/${incident.id}`,
    filename: file.name || 'photo',
    data,
    mimeType: file.type,
  });

  const evidence = await prisma.incidentEvidence.create({
    data: {
      tenantId: auth.tenant.id,
      incidentId: incident.id,
      kind: 'PHOTO',
      label: file.name || 'Photo evidence',
      text: analysisText,
      blobUrl,
      mimeType: file.type,
      bytes: file.size,
      addedById: auth.user.id,
    },
  });
  await prisma.incidentEvent.create({
    data: {
      tenantId: auth.tenant.id,
      incidentId: incident.id,
      kind: 'evidence_added',
      actorId: auth.user.id,
      meta: { kind: 'PHOTO', label: evidence.label },
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: auth.tenant.id,
      userId: auth.user.id,
      action: 'incidents.evidence.photo',
      resource: 'incident',
      resourceId: incident.id,
      metadata: { filename: evidence.label, bytes: file.size },
    },
  });

  return Response.json({
    evidence: {
      id: evidence.id,
      label: evidence.label,
      kind: 'PHOTO',
      text: analysisText,
    },
  });
}
