/**
 * Incident template schema — the machine-readable shape of an absorbed form.
 *
 * A template is a set of sections + typed fields. This is the contract shared
 * by absorption (form → schema), intake drafting (evidence → values), the
 * form renderer in the dashboard, and the .docx exporter. Everything that
 * writes a schema or field values validates against these zod shapes first.
 */
import { z } from 'zod';

export const FIELD_TYPES = [
  'text',
  'textarea',
  'date',
  'time',
  'datetime',
  'select',
  'multiselect',
  'checkbox',
  'number',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** snake_case stable identifiers for fields + sections. */
const KeyRe = /^[a-z][a-z0-9_]{0,63}$/;

export const TemplateFieldSchema = z.object({
  key: z.string().regex(KeyRe, 'field keys must be snake_case'),
  label: z.string().min(1).max(160),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  /**
   * Marks values that identify a person (names, DOB, addresses, contact
   * details, NDIS/Medicare numbers, signatures). Drives de-identified export.
   */
  pii: z.boolean().default(false),
  section: z.string().regex(KeyRe),
  options: z.array(z.string().min(1).max(120)).max(30).optional(),
  /** Guidance text shown under the field (carried over from the source form). */
  help: z.string().max(500).optional(),
  /** Show this field only when another field equals a value. */
  conditional: z.object({ field: z.string().regex(KeyRe), equals: z.string().max(120) }).optional(),
});

export const TemplateSectionSchema = z.object({
  key: z.string().regex(KeyRe, 'section keys must be snake_case'),
  title: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
});

export const TemplateSchemaSchema = z.object({
  sections: z.array(TemplateSectionSchema).min(1).max(16),
  fields: z.array(TemplateFieldSchema).min(1).max(96),
});

export type TemplateField = z.infer<typeof TemplateFieldSchema>;
export type TemplateSection = z.infer<typeof TemplateSectionSchema>;
export type TemplateSchema = z.infer<typeof TemplateSchemaSchema>;

/* ── Field values ─────────────────────────────────────────────────────── */

export const FieldValueSchema = z.union([
  z.string().max(20_000),
  z.array(z.string().max(300)).max(30),
  z.boolean(),
  z.number(),
  z.null(),
]);

export type FieldValue = z.infer<typeof FieldValueSchema>;

export const EvidenceRefSchema = z.object({
  /** IncidentEvidence.id (or a synthetic id like "narrative" in the demo). */
  evidenceId: z.string().max(64),
  /** Verbatim quote from that evidence backing this value. */
  quote: z.string().max(300),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const FieldDraftSchema = z.object({
  value: FieldValueSchema,
  /** "manual" marks human-entered values the AI never overwrites. */
  confidence: z.enum(['high', 'medium', 'low', 'manual']).optional(),
  evidence: z.array(EvidenceRefSchema).max(6).optional(),
});

export type FieldDraft = z.infer<typeof FieldDraftSchema>;

/** The Incident.fields JSON column: fieldKey → draft value. */
export const IncidentFieldsSchema = z.record(z.string().regex(KeyRe), FieldDraftSchema);
export type IncidentFields = z.infer<typeof IncidentFieldsSchema>;

/* ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Validate + normalize a raw (model-produced or user-edited) template schema:
 * dedupe field keys, drop dangling conditionals, and reattach fields whose
 * section key doesn't exist to the first section instead of failing.
 */
export function normalizeTemplateSchema(raw: unknown): TemplateSchema {
  const parsed = TemplateSchemaSchema.parse(raw);

  const sectionKeys = new Set(parsed.sections.map((s) => s.key));
  const firstSection = parsed.sections[0]!.key;
  const seen = new Set<string>();
  const fields: TemplateField[] = [];

  for (const field of parsed.fields) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    fields.push({
      ...field,
      section: sectionKeys.has(field.section) ? field.section : firstSection,
      // select/multiselect without options degrade to free text.
      ...(field.type === 'select' || field.type === 'multiselect'
        ? field.options && field.options.length > 0
          ? {}
          : { type: 'text' as const, options: undefined }
        : { options: undefined }),
    });
  }

  const fieldKeys = new Set(fields.map((f) => f.key));
  const cleaned = fields.map((f) =>
    f.conditional && !fieldKeys.has(f.conditional.field) ? { ...f, conditional: undefined } : f,
  );

  return { sections: parsed.sections, fields: cleaned };
}

function isEmptyValue(value: FieldValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false; // booleans and numbers count as answered
}

/** Is this field currently visible given the other values? */
export function isFieldVisible(field: TemplateField, fields: IncidentFields): boolean {
  if (!field.conditional) return true;
  const controlling = fields[field.conditional.field]?.value;
  if (typeof controlling === 'boolean') {
    return String(controlling) === field.conditional.equals;
  }
  if (Array.isArray(controlling)) return controlling.includes(field.conditional.equals);
  return controlling === field.conditional.equals;
}

/** Required fields that are visible but still unanswered. */
export function requiredMissing(schema: TemplateSchema, fields: IncidentFields): string[] {
  return schema.fields
    .filter((f) => f.required && isFieldVisible(f, fields) && isEmptyValue(fields[f.key]?.value))
    .map((f) => f.key);
}

/** Human-readable rendering of a field value (UI + docx share this). */
export function formatFieldValue(field: TemplateField, value: FieldValue | undefined): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—';
  if (typeof value === 'number') return String(value);
  const text = value.trim();
  if (!text) return '—';
  if (field.type === 'date') {
    const d = new Date(`${text}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  if (field.type === 'datetime') {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }
  return text;
}
