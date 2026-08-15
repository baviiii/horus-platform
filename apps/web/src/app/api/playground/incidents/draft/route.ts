import {
  categoryByKey,
  computeDeadlines,
  draftIncidentFields,
  NDIS_PACK,
  photoAnalysisToText,
  analyzeIncidentPhoto,
  STARTER_NDIS_TEMPLATE,
  STARTER_TEMPLATE_NAME,
} from '@horus/core/incidents';
import { moderateImage, moderateText } from '@horus/core/safety';
import { checkRateLimit, clientIp, rateLimitResponse } from '../../_lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const MAX_NARRATIVE = 6_000;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DRAFTS_PER_HOUR = 10;

/**
 * Open playground: narrative (+ optional photo) → drafted NDIS incident form
 * with per-field citations and statutory deadline clocks.
 *
 * Deliberately stateless — nothing a visitor types is persisted anywhere.
 * That is the demo's privacy story and it must stay true.
 */
export async function POST(req: Request) {
  const rate = checkRateLimit('incident-draft', clientIp(req), DRAFTS_PER_HOUR);
  if (!rate.ok) return rateLimitResponse(rate);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const narrative = String(form.get('narrative') ?? '').trim();
  if (narrative.length < 60) {
    return Response.json(
      { error: 'Describe the incident in a few sentences first (60+ characters).' },
      { status: 400 },
    );
  }
  if (narrative.length > MAX_NARRATIVE) {
    return Response.json(
      { error: 'Narrative is too long for the demo (6,000 chars).' },
      { status: 400 },
    );
  }

  const verdict = await moderateText(narrative);
  if (verdict.blocked) {
    return Response.json(
      { error: `Narrative was blocked by the content policy (${verdict.category}).` },
      { status: 400 },
    );
  }

  const evidence = [{ id: 'narrative', label: 'Reporter narrative', text: narrative }];
  let photo: { description: string; text: string } | null = null;

  const file = form.get('photo');
  if (file instanceof File && file.size > 0) {
    if (!PHOTO_TYPES.has(file.type)) {
      return Response.json({ error: 'Photo must be JPEG, PNG, or WebP' }, { status: 415 });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return Response.json({ error: 'Photo must be under 4 MB in the demo' }, { status: 400 });
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const imageVerdict = await moderateImage(data);
    if (imageVerdict.blocked) {
      return Response.json(
        { error: `Photo was blocked by the content policy (${imageVerdict.category}).` },
        { status: 400 },
      );
    }
    try {
      const analysis = await analyzeIncidentPhoto({ data, mimeType: file.type });
      const text = photoAnalysisToText(analysis);
      photo = { description: analysis.description, text };
      evidence.push({ id: 'photo', label: 'Photo evidence (AI analysis)', text });
    } catch {
      // Demo keeps moving on vision hiccups; the narrative still drafts.
      photo = null;
    }
  }

  let draft;
  try {
    draft = await draftIncidentFields({ schema: STARTER_NDIS_TEMPLATE, evidence });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Drafting failed — try again' },
      { status: 502 },
    );
  }

  // Demo assumption: the provider became aware just now.
  const awareAt = new Date();
  const deadlines = computeDeadlines(draft.suggestedCategoryKey, awareAt);
  const category = categoryByKey(draft.suggestedCategoryKey);

  return Response.json({
    template: { name: STARTER_TEMPLATE_NAME, schema: STARTER_NDIS_TEMPLATE },
    fields: draft.fields,
    missingRequired: draft.missingRequired,
    categoryKey: draft.suggestedCategoryKey,
    categoryLabel: category?.label ?? null,
    severity: draft.suggestedSeverity,
    title: draft.title,
    summary: draft.summary,
    occurredAtIso: draft.occurredAtIso,
    awareAtIso: awareAt.toISOString(),
    deadlines: {
      notifyDueAt: deadlines.notifyDueAt?.toISOString() ?? null,
      reportDueAt: deadlines.reportDueAt?.toISOString() ?? null,
      basis: deadlines.basis,
    },
    photo,
    narrativeChars: narrative.length,
    pack: {
      name: NDIS_PACK.name,
      version: NDIS_PACK.version,
      disclaimer: NDIS_PACK.disclaimer,
      sources: NDIS_PACK.sources,
    },
    remaining: rate.remaining,
  });
}
