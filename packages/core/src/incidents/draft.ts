/**
 * Intake drafting — fill a template's fields from evidence, with per-field
 * citations.
 *
 * The hard rule that makes this sellable to a regulated buyer: the model may
 * only use what the evidence says. Every value carries a verbatim quote from
 * a named evidence item; anything the evidence doesn't establish stays empty
 * and lands on the missing-required list for a human. We recompute
 * missing-required deterministically after the model — we never trust it to
 * self-report gaps.
 */
import { infer } from '../inference/infer.js';
import { NDIS_PACK } from './reference.js';
import {
  FieldDraftSchema,
  requiredMissing,
  type FieldDraft,
  type IncidentFields,
  type TemplateSchema,
} from './schema.js';

const MAX_EVIDENCE_CHARS_EACH = 6_000;
const MAX_EVIDENCE_CHARS_TOTAL = 24_000;

export interface DraftEvidenceInput {
  /** IncidentEvidence.id — cited back as evidenceId. */
  id: string;
  label: string;
  text: string;
}

export interface DraftParams {
  schema: TemplateSchema;
  evidence: DraftEvidenceInput[];
  /** Existing values the human already set; the model must not contradict them. */
  manualFields?: IncidentFields;
}

export type SeverityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DraftResult {
  fields: IncidentFields;
  missingRequired: string[];
  suggestedCategoryKey: string | null;
  suggestedSeverity: SeverityLevel;
  title: string;
  summary: string;
  /** ISO datetime of the incident if the evidence states it, else null. */
  occurredAtIso: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SEVERITIES: SeverityLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function buildSystem(schema: TemplateSchema): string {
  const categories = NDIS_PACK.categories.map((c) => `- ${c.key}: ${c.label}`).join('\n');

  const fieldSpec = schema.fields
    .map((f) => {
      const bits = [
        `key=${f.key}`,
        `label="${f.label}"`,
        `type=${f.type}`,
        f.required ? 'required' : 'optional',
      ];
      if (f.options?.length) bits.push(`options=${JSON.stringify(f.options)}`);
      if (f.conditional) bits.push(`only_if ${f.conditional.field}=${f.conditional.equals}`);
      return `- ${bits.join(' | ')}`;
    })
    .join('\n');

  return `You draft incident reports for an Australian NDIS provider by filling a form from evidence.

STRICT RULES — a hallucinated value in a regulator-facing document is a serious failure:
1. Fill a field ONLY when the evidence supports it. Never invent names, dates, times, medications, or events.
2. Every filled field cites its evidence: the evidence id plus a verbatim quote (max 200 chars) copied from that evidence.
3. If the evidence does not establish a field, OMIT the field entirely.
4. Value formats by type: date → "YYYY-MM-DD"; datetime → "YYYY-MM-DDTHH:MM" (as stated in evidence, no timezone guessing); time → "HH:MM"; checkbox → true/false; select → exactly one of its options; multiselect → array of its options; number → a number; text/textarea → string.
5. For textarea fields, write clear factual prose synthesised from the evidence — but every sentence must be traceable to the quotes you cite.
6. "title" is a short handle (max 80 chars). Use initials, never full names.
7. "summary" is 2–4 factual sentences.

The form's fields:
${fieldSpec}

NDIS reportable-incident categories (for suggested_category_key — use null if none clearly applies):
${categories}

Severity guidance: CRITICAL = death, life-threatening injury, alleged assault/abuse; HIGH = injury needing medical treatment, unauthorised restraint with harm; MEDIUM = incident with potential for harm; LOW = near miss / no harm.

Return ONLY a JSON object:
{
  "fields": { "<field_key>": { "value": ..., "confidence": "high"|"medium"|"low", "evidence": [{ "evidenceId": string, "quote": string }] } },
  "suggested_category_key": string | null,
  "suggested_severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "title": string,
  "summary": string,
  "occurred_at_iso": string | null
}`;
}

function buildUserMessage(params: DraftParams): string {
  let total = 0;
  const evidence = params.evidence.map((e) => {
    const clamped = e.text.slice(0, MAX_EVIDENCE_CHARS_EACH);
    const room = Math.max(0, MAX_EVIDENCE_CHARS_TOTAL - total);
    const text = clamped.slice(0, room);
    total += text.length;
    return { id: e.id, label: e.label, text };
  });

  const manual = Object.entries(params.manualFields ?? {})
    .filter(([, draft]) => draft.confidence === 'manual')
    .map(([key, draft]) => ({ key, value: draft.value }));

  return JSON.stringify({
    evidence,
    ...(manual.length > 0 && {
      human_entered_values_do_not_contradict: manual,
    }),
  });
}

/** Coerce a model value into the field's declared type; null = reject. */
function coerceValue(
  type: string,
  options: string[] | undefined,
  value: unknown,
): FieldDraft['value'] | undefined {
  if (value === null || value === undefined) return undefined;
  switch (type) {
    case 'checkbox':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'yes') return true;
      if (value === 'false' || value === 'no') return false;
      return undefined;
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'multiselect': {
      const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
      if (!arr) return undefined;
      const valid = arr.filter(
        (v): v is string => typeof v === 'string' && (!options || options.includes(v)),
      );
      return valid.length > 0 ? valid : undefined;
    }
    case 'select': {
      if (typeof value !== 'string') return undefined;
      return !options || options.includes(value) ? value : undefined;
    }
    default:
      return typeof value === 'string' ? value : undefined;
  }
}

export async function draftIncidentFields(params: DraftParams): Promise<DraftResult> {
  const result = await infer({
    task: 'incidents.draft_fields',
    system: buildSystem(params.schema),
    messages: [{ role: 'user', content: buildUserMessage(params) }],
    model: 'deep',
    temperature: 0.1,
    maxTokens: 6000,
  });

  let raw: {
    fields?: Record<string, unknown>;
    suggested_category_key?: unknown;
    suggested_severity?: unknown;
    title?: unknown;
    summary?: unknown;
    occurred_at_iso?: unknown;
  };
  try {
    raw = JSON.parse(result.content) as typeof raw;
  } catch {
    throw new Error('Drafting failed: model returned unparseable JSON.');
  }

  const knownEvidence = new Set(params.evidence.map((e) => e.id));
  const byKey = new Map(params.schema.fields.map((f) => [f.key, f]));
  const fields: IncidentFields = {};

  for (const [key, value] of Object.entries(raw.fields ?? {})) {
    const field = byKey.get(key);
    if (!field) continue; // model invented a field — drop it
    // Human-entered values always win.
    if (params.manualFields?.[key]?.confidence === 'manual') continue;

    const parsed = FieldDraftSchema.safeParse(value);
    if (!parsed.success) continue;

    const coerced = coerceValue(field.type, field.options, parsed.data.value);
    if (coerced === undefined) continue;

    fields[key] = {
      value: coerced,
      confidence: parsed.data.confidence ?? 'low',
      evidence: (parsed.data.evidence ?? [])
        .filter((ref) => knownEvidence.has(ref.evidenceId))
        .slice(0, 6),
    };
  }

  // Merge: manual values carried over untouched.
  for (const [key, draft] of Object.entries(params.manualFields ?? {})) {
    if (draft.confidence === 'manual' && byKey.has(key)) fields[key] = draft;
  }

  const categoryKey =
    typeof raw.suggested_category_key === 'string' &&
    NDIS_PACK.categories.some((c) => c.key === raw.suggested_category_key)
      ? raw.suggested_category_key
      : null;

  const severity = SEVERITIES.includes(raw.suggested_severity as SeverityLevel)
    ? (raw.suggested_severity as SeverityLevel)
    : 'MEDIUM';

  const occurredAtIso =
    typeof raw.occurred_at_iso === 'string' &&
    !Number.isNaN(new Date(raw.occurred_at_iso).getTime())
      ? raw.occurred_at_iso
      : null;

  return {
    fields,
    // Deterministic — never trust the model's own gap report.
    missingRequired: requiredMissing(params.schema, fields),
    suggestedCategoryKey: categoryKey,
    suggestedSeverity: severity,
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim().slice(0, 80)
        : 'Untitled incident',
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 1200) : '',
    occurredAtIso,
    model: result.model,
    usage: result.usage,
  };
}
