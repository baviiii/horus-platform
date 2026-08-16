/**
 * Template absorption — turn a provider's existing incident form (PDF/docx
 * text) into a machine-readable TemplateSchema.
 *
 * This is the defensible half of the product: we eat *their* form instead of
 * imposing ours. The model proposes sections + typed fields + PII marking;
 * `normalizeTemplateSchema` then enforces the contract, so a bad model day
 * degrades to a validation error, never to a corrupt template.
 */
import { infer } from '../inference/infer.js';
import { FIELD_TYPES, normalizeTemplateSchema, type TemplateSchema } from './schema.js';

const MAX_SOURCE_CHARS = 28_000;

const SYSTEM = `You digitise paper/PDF incident-report forms for Australian disability (NDIS) providers into a strict JSON schema.

Return ONLY a JSON object of this exact shape:
{
  "name": string,                       // short form title, e.g. "Incident Report Form"
  "description": string,                // one sentence: what this form is for
  "sections": [{ "key": snake_case, "title": string, "description"?: string }],
  "fields": [{
    "key": snake_case,                  // unique, stable, derived from the label
    "label": string,                    // the form's own wording, verbatim where possible
    "type": one of ${JSON.stringify([...FIELD_TYPES])},
    "required": boolean,                // true only if the form marks it mandatory or it is clearly essential
    "pii": boolean,
    "section": snake_case,              // key of the section it belongs to
    "options"?: string[],               // for select/multiselect: the form's checkboxes/choices
    "help"?: string,                    // guidance text printed under the field on the form
    "conditional"?: { "field": snake_case, "equals": string }  // only when the form clearly gates it
  }]
}

Rules:
- Mark "pii": true for anything identifying a person: names, dates of birth, addresses, phone, email, NDIS participant numbers, Medicare numbers, signatures, next-of-kin details.
- Long free-text answers (descriptions, accounts of events) are "textarea".
- Yes/No questions are "checkbox". Checkbox groups with several choices are "multiselect".
- Use "conditional" for sections like "complete only if a restrictive practice was used" — gate on a checkbox field with equals "true".
- Preserve the form's structure and wording. Do not invent fields the form does not have. Do not drop fields it does have.
- Maximum 96 fields, 16 sections.`;

export interface AbsorbParams {
  /** Extracted text of the source form. */
  sourceText: string;
  filename: string;
}

export interface AbsorbResult {
  name: string;
  description: string;
  schema: TemplateSchema;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function absorbTemplate(params: AbsorbParams): Promise<AbsorbResult> {
  const source = params.sourceText.slice(0, MAX_SOURCE_CHARS);

  const result = await infer({
    task: 'incidents.absorb_template',
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Source form "${params.filename}":\n\n${source}`,
      },
    ],
    model: 'deep',
    temperature: 0.1,
    maxTokens: 6000,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(result.content);
  } catch {
    throw new Error('Template absorption failed: model returned unparseable JSON.');
  }

  const obj = raw as { name?: unknown; description?: unknown };
  const schema = normalizeTemplateSchema(raw);

  return {
    name:
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name.trim().slice(0, 120)
        : params.filename.replace(/\.(pdf|docx|txt|md)$/i, ''),
    description: typeof obj.description === 'string' ? obj.description.trim().slice(0, 300) : '',
    schema,
    model: result.model,
    usage: result.usage,
  };
}
