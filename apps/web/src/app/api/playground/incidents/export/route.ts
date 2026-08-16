import { z } from 'zod';
import {
  categoryByKey,
  computeDeadlines,
  deidentifyIncident,
  IncidentFieldsSchema,
  NDIS_PACK,
  renderIncidentDocx,
  STARTER_NDIS_TEMPLATE,
  STARTER_TEMPLATE_NAME,
} from '@horus/core/incidents';
import { checkRateLimit, clientIp, rateLimitResponse } from '../../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXPORTS_PER_HOUR = 20;

const BodySchema = z.object({
  mode: z.enum(['identified', 'deidentified']).default('identified'),
  title: z.string().min(1).max(120),
  summary: z.string().max(2000).default(''),
  categoryKey: z.string().max(64).nullable().default(null),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  awareAtIso: z.string().datetime().optional(),
  occurredAtIso: z.string().nullable().default(null),
  narrative: z.string().max(8000).default(''),
  photoText: z.string().max(4000).nullable().default(null),
  fields: IncidentFieldsSchema,
});

/**
 * Demo .docx export — the client posts the draft back, we render and stream
 * a DEMO-watermarked Word document. Stateless like the draft endpoint.
 */
export async function POST(req: Request) {
  const rate = checkRateLimit('incident-export', clientIp(req), EXPORTS_PER_HOUR);
  if (!rate.ok) return rateLimitResponse(rate);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: 'Body must be valid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid draft payload' }, { status: 400 });
  }
  const body = parsed.data;

  const awareAt = body.awareAtIso ? new Date(body.awareAtIso) : new Date();
  const deadlines = computeDeadlines(body.categoryKey, awareAt);

  let fields = body.fields;
  let title = body.title;
  let summary = body.summary;
  let narrative = body.narrative;
  let photoText = body.photoText;
  let deidDegraded = false;

  if (body.mode === 'deidentified') {
    const deid = await deidentifyIncident({
      schema: STARTER_NDIS_TEMPLATE,
      fields,
      title,
      summary,
      evidenceTexts: [
        { id: 'narrative', text: narrative },
        ...(photoText ? [{ id: 'photo', text: photoText }] : []),
      ],
    });
    fields = deid.fields;
    title = deid.title;
    summary = deid.summary;
    narrative = deid.evidenceTexts.find((e) => e.id === 'narrative')?.text ?? '';
    photoText = deid.evidenceTexts.find((e) => e.id === 'photo')?.text ?? photoText;
    deidDegraded = !deid.languageServiceUsed;
  }

  const buffer = await renderIncidentDocx({
    org: 'Sample Provider (Horus demo)',
    templateName: STARTER_TEMPLATE_NAME,
    mode: body.mode,
    demo: true,
    incident: {
      ref: 'INC-DEMO-0001',
      title,
      status: 'DRAFT',
      severity: body.severity,
      categoryLabel: categoryByKey(body.categoryKey)?.label ?? null,
      occurredAt: body.occurredAtIso ? new Date(body.occurredAtIso) : null,
      discoveredAt: awareAt,
      location: null,
      summary,
      notifyDueAt: deadlines.notifyDueAt,
      reportDueAt: deadlines.reportDueAt,
      deadlineBasis: deadlines.basis,
      approvedByName: null,
      approvedAt: null,
      createdAt: awareAt,
    },
    schema: STARTER_NDIS_TEMPLATE,
    fields,
    evidence: [
      ...(narrative ? [{ label: 'Reporter narrative', kind: 'NARRATIVE', text: narrative }] : []),
      ...(photoText
        ? [{ label: 'Photo evidence (AI analysis)', kind: 'PHOTO', text: photoText }]
        : []),
    ],
    disclaimer: NDIS_PACK.disclaimer,
    deidDegraded,
  });

  const filename = `INC-DEMO-0001${body.mode === 'deidentified' ? '-deidentified' : ''}.docx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': DOCX_MIME,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
