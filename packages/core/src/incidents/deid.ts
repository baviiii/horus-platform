/**
 * De-identification — the second rendition of every incident.
 *
 * NDIS incident data flows two directions: identified internally (care
 * follow-up needs names) and de-identified outward (board packs, trend
 * analysis, insurers). This produces the outward copy:
 *
 *  layer 1 (deterministic): PII-marked fields → role pseudonyms for person
 *    names ("Participant A", "Staff Member 1") or `[REDACTED — label]` for
 *    identifiers; the pseudonym map then scrubs every free-text value.
 *  layer 2 (service-backed): Azure AI Language PII detection sweeps free text
 *    for stray names/identifiers layer 1 didn't know about.
 *  layer 3 (regex): AU phone numbers, emails, and long digit runs (NDIS /
 *    Medicare numbers) as a final net.
 *
 * The pseudonym map is persisted on the incident so re-exports stay stable.
 */
import { detectPii } from '../clients/language.js';
import type { IncidentFields, TemplateField, TemplateSchema } from './schema.js';

export interface DeidResult {
  fields: IncidentFields;
  title: string;
  summary: string;
  evidenceTexts: Array<{ id: string; text: string }>;
  /** realName → pseudonym. Persist and pass back in on re-export. */
  map: Record<string, string>;
  /** False when the Language sweep was unavailable — flag it on the export. */
  languageServiceUsed: boolean;
}

type Role = 'participant' | 'staff' | 'witness' | 'person';

function roleForField(field: TemplateField): Role {
  const hint = `${field.key} ${field.label}`.toLowerCase();
  if (/participant|client|person with disability|resident/.test(hint)) return 'participant';
  if (/staff|worker|employee|supervisor|manager|reporter/.test(hint)) return 'staff';
  if (/witness/.test(hint)) return 'witness';
  return 'person';
}

function isNameField(field: TemplateField): boolean {
  // Matches "participant_name", "reported_by", "Participant name", "Full name" —
  // word-boundary "name" in either the key or the label.
  return /(^|[_\s])(name|reported_by|completed_by)($|[_\s])|full name|name of/i.test(
    `${field.key} ${field.label.toLowerCase()}`,
  );
}

class PseudonymAssigner {
  private counts: Record<Role, number> = { participant: 0, staff: 0, witness: 0, person: 0 };

  constructor(private readonly map: Record<string, string>) {
    // Re-seed counters from an existing map so re-exports continue the series.
    for (const pseudonym of Object.values(map)) {
      const m = /^(Participant|Staff Member|Witness|Person) ([A-Z]|\d+)$/.exec(pseudonym);
      if (!m) continue;
      const role: Role =
        m[1] === 'Participant'
          ? 'participant'
          : m[1] === 'Staff Member'
            ? 'staff'
            : m[1] === 'Witness'
              ? 'witness'
              : 'person';
      this.counts[role]++;
    }
  }

  assign(realName: string, role: Role): string {
    const existing = this.map[realName];
    if (existing) return existing;
    const n = ++this.counts[role];
    const pseudonym =
      role === 'participant'
        ? `Participant ${String.fromCharCode(64 + Math.min(n, 26))}`
        : role === 'staff'
          ? `Staff Member ${n}`
          : role === 'witness'
            ? `Witness ${n}`
            : `Person ${n}`;
    this.map[realName] = pseudonym;
    return pseudonym;
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace a name (and its standalone word-parts ≥3 chars) with its pseudonym. */
function scrubName(text: string, realName: string, pseudonym: string): string {
  let out = text.replace(new RegExp(`\\b${escapeRe(realName)}\\b`, 'gi'), pseudonym);
  for (const part of realName.split(/\s+/)) {
    if (part.length < 3) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(part)}\\b`, 'g'), pseudonym);
  }
  return out;
}

/** Final regex net: AU phones, emails, and 8+ digit identifier runs. */
function scrubPatterns(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[REDACTED — email]')
    .replace(/(?:\+?61|0)[\s-]?[2-9](?:[\s-]?\d){8}/g, '[REDACTED — phone]')
    .replace(/\b\d[\d\s-]{7,14}\d\b/g, '[REDACTED — identifier]');
}

const LANGUAGE_PERSON = 'Person';
/** Language categories that are safe to keep (roles, orgs stay useful). */
const LANGUAGE_KEEP = new Set(['PersonType', 'Organization', 'DateTime', 'Quantity', 'Event']);

export interface DeidParams {
  schema: TemplateSchema;
  fields: IncidentFields;
  title: string;
  summary: string;
  evidenceTexts: Array<{ id: string; text: string }>;
  /** Previously persisted map — keeps pseudonyms stable across exports. */
  existingMap?: Record<string, string>;
}

export async function deidentifyIncident(params: DeidParams): Promise<DeidResult> {
  const map: Record<string, string> = { ...(params.existingMap ?? {}) };
  const assigner = new PseudonymAssigner(map);
  const byKey = new Map(params.schema.fields.map((f) => [f.key, f]));

  // Layer 1a — collect names from PII name-fields, assign role pseudonyms.
  for (const [key, draft] of Object.entries(params.fields)) {
    const field = byKey.get(key);
    if (!field?.pii || !isNameField(field)) continue;
    const value = draft.value;
    if (typeof value !== 'string' || !value.trim()) continue;
    assigner.assign(value.trim(), roleForField(field));
  }

  // Layer 2 — Language PII sweep over all free text for stray names.
  const freeText = [
    params.title,
    params.summary,
    ...Object.values(params.fields)
      .map((d) => d.value)
      .filter((v): v is string => typeof v === 'string'),
    ...params.evidenceTexts.map((e) => e.text),
  ]
    .join('\n')
    .slice(0, 26_000);

  const detection = await detectPii(freeText);
  const nonPersonEntities: string[] = [];
  for (const entity of detection.entities) {
    if (LANGUAGE_KEEP.has(entity.category) || entity.confidenceScore < 0.6) continue;
    if (entity.category === LANGUAGE_PERSON) {
      // Names already mapped keep their pseudonym; new ones get "Person N".
      const known = Object.keys(map).some((name) =>
        name.toLowerCase().includes(entity.text.toLowerCase()),
      );
      if (!known) assigner.assign(entity.text, 'person');
    } else if (entity.text.length >= 4) {
      nonPersonEntities.push(entity.text);
    }
  }

  // Longest names first so "Jane Doe-Smith" wins over "Jane".
  const names = Object.keys(map).sort((a, b) => b.length - a.length);

  const scrubText = (text: string): string => {
    let out = text;
    for (const name of names) out = scrubName(out, name, map[name]!);
    for (const raw of nonPersonEntities) {
      out = out.replace(new RegExp(escapeRe(raw), 'g'), '[REDACTED]');
    }
    return scrubPatterns(out);
  };

  // Layer 1b + 3 — rewrite every field value.
  const fields: IncidentFields = {};
  for (const [key, draft] of Object.entries(params.fields)) {
    const field = byKey.get(key);
    if (!field) continue;

    if (field.pii) {
      if (isNameField(field) && typeof draft.value === 'string' && draft.value.trim()) {
        fields[key] = {
          ...draft,
          value: map[draft.value.trim()] ?? '[REDACTED — name]',
          evidence: [],
        };
      } else {
        fields[key] = { ...draft, value: `[REDACTED — ${field.label}]`, evidence: [] };
      }
      continue;
    }

    fields[key] =
      typeof draft.value === 'string'
        ? { ...draft, value: scrubText(draft.value), evidence: draft.evidence }
        : draft;
  }

  return {
    fields,
    title: scrubText(params.title),
    summary: scrubText(params.summary),
    evidenceTexts: params.evidenceTexts.map((e) => ({ id: e.id, text: scrubText(e.text) })),
    map,
    languageServiceUsed: detection.ok,
  };
}
