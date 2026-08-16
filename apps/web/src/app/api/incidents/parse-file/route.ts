import { prisma } from '@horus/db';
import { extractDocx, extractPdf } from '@horus/core/knowledge';
import { moderateTexts } from '@horus/core/safety';
import { requireMemberApi, forbidViewerApi } from '@/lib/tenant-api';
import { storeTenantBlob } from '@/lib/evidence-blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Text-extract an uploaded form or supporting document (PDF / .docx / text).
 *
 * Two callers, one pipeline:
 *  - template absorption: no incidentId — returns { filename, text } for the
 *    incidents.absorbTemplate mutation to digest
 *  - evidence attach: with incidentId — also persists an IncidentEvidence
 *    DOCUMENT row (original stored to blob when storage is configured)
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const slug = String(form.get('tenant') ?? '');
  const incidentId = form.get('incidentId') ? String(form.get('incidentId')) : null;
  const file = form.get('file');
  if (!slug || !(file instanceof File)) {
    return Response.json({ error: 'Missing tenant or file' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json({ error: 'File must be between 1 byte and 10 MB' }, { status: 400 });
  }

  const auth = await requireMemberApi(slug);
  if ('error' in auth) return auth.error;
  const viewerBlock = forbidViewerApi(auth);
  if (viewerBlock) return viewerBlock;

  const name = file.name || 'upload';
  const data = new Uint8Array(await file.arrayBuffer());

  let text: string;
  try {
    if (/\.pdf$/i.test(name)) {
      const pdf = await extractPdf(data);
      if (pdf.text.length < 80) {
        return Response.json(
          { error: 'Could not extract text — this looks like a scanned/image PDF.' },
          { status: 422 },
        );
      }
      text = pdf.text;
    } else if (/\.docx$/i.test(name)) {
      text = (await extractDocx(data)).text;
    } else if (/\.(txt|md)$/i.test(name)) {
      text = new TextDecoder().decode(data);
    } else {
      return Response.json({ error: 'Supported formats: PDF, .docx, .txt, .md' }, { status: 415 });
    }
  } catch {
    return Response.json({ error: 'Failed to read that file' }, { status: 422 });
  }

  text = text.trim();
  if (text.length < 40) {
    return Response.json({ error: 'File contained no usable text' }, { status: 422 });
  }

  const verdict = await moderateTexts([text]);
  if (verdict.blocked) {
    return Response.json(
      { error: `File was blocked by the content policy (${verdict.category}).` },
      { status: 400 },
    );
  }

  if (!incidentId) {
    return Response.json({ filename: name, text, chars: text.length });
  }

  // Evidence mode — verify the incident belongs to this tenant, then persist.
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, tenantId: auth.tenant.id },
  });
  if (!incident) return Response.json({ error: 'Unknown incident' }, { status: 404 });

  const blobUrl = await storeTenantBlob({
    tenantId: auth.tenant.id,
    prefix: `incidents/${incident.id}`,
    filename: name,
    data,
    mimeType: file.type || 'application/octet-stream',
  });

  const evidence = await prisma.incidentEvidence.create({
    data: {
      tenantId: auth.tenant.id,
      incidentId: incident.id,
      kind: 'DOCUMENT',
      label: name,
      text: text.slice(0, 24_000),
      blobUrl,
      mimeType: file.type || null,
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
      meta: { kind: 'DOCUMENT', label: name },
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: auth.tenant.id,
      userId: auth.user.id,
      action: 'incidents.evidence.document',
      resource: 'incident',
      resourceId: incident.id,
      metadata: { filename: name, bytes: file.size },
    },
  });

  return Response.json({ evidence: { id: evidence.id, label: evidence.label, kind: 'DOCUMENT' } });
}
