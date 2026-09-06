/**
 * Graph extraction — chunks → typed entities + relationships.
 *
 * The GraphRAG substrate: gpt over chunk batches proposes entities
 * (organizations, programs, sectors, occupations, skills, locations,
 * funding…) and edges between them, each edge carrying a verbatim evidence
 * quote. Everything is validated against the canonical type enums before it
 * can touch the database — an invented type or a dangling edge is dropped,
 * never stored.
 */
import { z } from 'zod';
import { infer, type ModelTier } from '../inference/infer.js';
import {
  EntityTypeSchema,
  RelationshipTypeSchema,
  type EntityType,
  type RelationshipType,
} from '../graph/types.js';

export const ExtractedEntitySchema = z.object({
  name: z.string().min(2).max(120),
  type: EntityTypeSchema,
  aliases: z.array(z.string().min(1).max(80)).max(6).optional(),
  /** e.g. { amount_aud: 50000000, period: "2026-27" } on funding entities. */
  attributes: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

export const ExtractedRelationshipSchema = z.object({
  from: z.string().min(2).max(120),
  /** Optional in practice — endpoint resolution falls back to name matching. */
  from_type: EntityTypeSchema.optional(),
  to: z.string().min(2).max(120),
  to_type: EntityTypeSchema.optional(),
  type: RelationshipTypeSchema,
  /** Verbatim quote (≤200 chars) from the chunk that states this edge. */
  evidence: z.string().max(300),
  confidence: z.number().min(0).max(1).default(0.7),
});

export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;
export type ExtractedRelationship = z.infer<typeof ExtractedRelationshipSchema>;

export interface GraphExtraction {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  /** Edges dropped because their endpoint types were semantically invalid. */
  rejectedByType: number;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

const SYSTEM = `You extract a knowledge graph from Australian government / labour-market documents (budgets, industry strategies, jobs & skills reports).

Entity types (use ONLY these): organization, program, policy, funding, skill, occupation, location, sector, qualification, date_period, metric, person, event, concept.
Relationship types (use ONLY these): funds, employs, requires, located_in, part_of, targets, leads_to, contradicts, supports, competes_with, references, mentions.

Extraction rules:
1. Extract only what the text states. Never infer entities or edges from world knowledge.
2. Prefer specific over generic: "Department for Education" (organization), "Fee-Free TAFE" (program), "defence shipbuilding" (sector), "software engineer" (occupation).
3. Funding: when a dollar amount is attached to a program/measure, put the amount on the FUNDING or PROGRAM entity as attributes { "amount_aud": <number>, "period": "<e.g. 2026-27>" } and add a "funds" edge from the funding organization to the target.
3a. TABLES: chunks may contain HTML tables. A budget row carries one figure PER YEAR COLUMN — read the header row to decide which year a figure belongs to, and take the column you can actually justify. Never guess a period from column position alone: if the header does not tell you the year, give the amount with no "period" rather than an invented one.
3b. Figures in these documents are frequently in thousands ($000) — check the table's unit heading and convert to whole dollars for "amount_aud". Digits separated by spaces are one number: "4 769" is 4769, not two values.
3c. A row's meaning depends on the section heading above it ("Cash inflows" vs "Cash outflows"). Money received and money paid are opposite directions — set the "funds" edge accordingly, and if the section is not visible in the chunk, omit the edge rather than assuming a direction.
4. Canonical names: singular, title case for proper nouns, no trailing punctuation, expand obvious acronyms into aliases (e.g. name "Department of State Development", aliases ["DSD"]).
5. Every relationship's "from" and "to" MUST exactly match the "name" of an entity you list in the same response.
6. Every relationship carries a short verbatim "evidence" quote from the text.
7. Quality over volume: at most ~15 entities and ~15 relationships per response. Skip boilerplate, headings, tables of contents.

Return ONLY JSON of this exact shape:
{
  "entities": [
    { "name": string, "type": <entity type>, "aliases"?: string[], "attributes"?: { "amount_aud"?: number, "period"?: string } }
  ],
  "relationships": [
    { "from": string, "from_type": <entity type>, "to": string, "to_type": <entity type>, "type": <relationship type>, "evidence": string, "confidence": number 0-1 }
  ]
}`;

/**
 * Careers profile.
 *
 * The general prompt caps each batch at ~15 entities, and in a government
 * document programs and policies win that budget every time — which is how a
 * corpus containing an occupation encyclopedia produced a graph where only 3%
 * of edges touch an occupation or skill. This profile spends the same budget
 * on the career pathway instead: who does the work, what they need to know,
 * and what qualifies them.
 *
 * The chain it exists to build:
 *   sector --employs--> occupation --requires--> skill
 *   qualification --leads_to--> occupation
 *   organization --targets--> qualification        (who delivers the training)
 *
 * That chain is what lets a brief answer "what should I study to work in
 * defence in SA" — a question no single passage in the corpus answers.
 */
const CAREERS_SYSTEM = `You extract a CAREER PATHWAY knowledge graph from Australian labour-market, education and industry documents.

Entity types (use ONLY these): organization, program, policy, funding, skill, occupation, location, sector, qualification, date_period, metric, person, event, concept.
Relationship types (use ONLY these): funds, employs, requires, located_in, part_of, targets, leads_to, contradicts, supports, competes_with, references, mentions.

YOUR PRIORITY, in order:
1. occupation — every job title or role the text names ("Registered Nurse", "Welder", "Software Engineer"). Extract them even when mentioned in passing or in a list.
2. skill — capabilities a job needs ("welding", "data analysis", "AI literacy"). NEVER extract classification bands like "Skill Level 1" — those are statistical codes, not skills.
3. qualification — certificates, diplomas, degrees, apprenticeships ("Certificate III in Engineering", "Bachelor of Nursing").
4. sector — the industry that employs those occupations.
5. Everything else (organization, program, funding) ONLY when it connects to the above.

THE EDGES THAT MATTER MOST — extract these wherever the text supports them:
- sector --employs--> occupation
- occupation --requires--> skill
- occupation --requires--> qualification
- qualification --leads_to--> occupation
- organization --targets--> qualification    (a provider delivering the training)
- program --supports--> occupation           (a program creating those jobs)

Extraction rules:
1. Extract only what the text states. Never infer from world knowledge.
2. For EVERY occupation you extract, look hard for the skills, qualifications and sector the text associates with it, and emit those edges. An occupation with no edges is nearly worthless — prefer 6 well-connected occupations over 15 isolated ones.
3. Canonical names: singular and specific. "Registered Nurse" not "nurses"; "Certificate III in Engineering" not "a cert".
4. Every relationship's "from" and "to" MUST exactly match the "name" of an entity you list in the same response.
5. Every relationship carries a short verbatim "evidence" quote from the text.
6. At most ~15 entities and ~15 relationships per response. Skip boilerplate, headings, contents pages.

Return ONLY JSON of this exact shape:
{
  "entities": [
    { "name": string, "type": <entity type>, "aliases"?: string[], "attributes"?: { "anzsco"?: string, "skill_level"?: string } }
  ],
  "relationships": [
    { "from": string, "from_type": <entity type>, "to": string, "to_type": <entity type>, "type": <relationship type>, "evidence": string, "confidence": number 0-1 }
  ]
}`;

/**
 * Extraction profiles. `general` reads a document as government/budget
 * intelligence; `careers` reads the same document as a pathway map. Running
 * both over the same corpus is deliberate — they populate different regions
 * of one graph and meet at shared entities like a sector.
 */
export const EXTRACTION_PROFILES = {
  general: SYSTEM,
  careers: CAREERS_SYSTEM,
} as const;

export type ExtractionProfile = keyof typeof EXTRACTION_PROFILES;

export interface ExtractChunkBatchParams {
  docTitle: string;
  category: string;
  year: number;
  chunks: Array<{ chunkIx: number; text: string }>;
  model?: ModelTier;
  /** Which lens to read the document through. Defaults to `general`. */
  profile?: ExtractionProfile;
}

/**
 * Australian financial year, or a plain/spanning year: 2026-27, 2026-2027,
 * 2026, or "2025-26 to 2029-30". Anything else is not a period we recognise.
 */
const PERIOD_RE =
  /^(?:\d{4}-\d{2}|\d{4}-\d{4}|\d{4})(?:\s*(?:to|–|—|-)\s*(?:\d{4}-\d{2}|\d{4}-\d{4}|\d{4}))?$/;

/**
 * An order of magnitude above any real line item — the whole Commonwealth
 * budget is ~$0.7tn. A value past this is arithmetic on corrupted text, not
 * money.
 */
const MAX_PLAUSIBLE_AUD = 1e12;

/**
 * Money guard.
 *
 * `amount_aud` is the most load-bearing thing the extractor produces and the
 * easiest to corrupt. A budget row offers four figures (one per year column),
 * and page furniture can weld itself onto the last one — the raw text really
 * did contain `1 9552025-26`, which is a page footer glued to a value. A
 * number derived from that looks every bit as authoritative as a correct one,
 * and the evidence quote backing it is genuinely verbatim, so nothing
 * downstream can tell them apart.
 *
 * So: implausible magnitudes lose the amount, and unparseable periods lose the
 * period rather than mislabelling the year. A period is NOT required — plenty
 * of legitimate figures are stated in prose without one ("$2.4 billion for the
 * Sovereign Steel Package"), and demanding one would discard good data to
 * chase bad. The entity and its edges always survive; only the suspect
 * attribute is dropped.
 */
export function sanitizeAttributes(
  attrs: ExtractedEntity['attributes'],
): ExtractedEntity['attributes'] {
  if (!attrs) return attrs;
  const out = { ...attrs };

  if ('period' in out) {
    const period = typeof out.period === 'string' ? out.period.trim() : '';
    if (!PERIOD_RE.test(period)) delete out.period;
    else out.period = period;
  }

  if ('amount_aud' in out) {
    const raw = out.amount_aud;
    const n =
      typeof raw === 'number'
        ? raw
        : Number(
            String(raw)
              .replace(/[\s,$]/g, '')
              .replace(/[^\d.]/g, ''),
          );
    if (!Number.isFinite(n) || n <= 0 || n >= MAX_PLAUSIBLE_AUD) delete out.amount_aud;
    else out.amount_aud = n;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export async function extractGraphFromChunks(
  params: ExtractChunkBatchParams,
): Promise<GraphExtraction> {
  const body = params.chunks
    .map((c) => `[chunk ${c.chunkIx}]\n${c.text}`)
    .join('\n\n')
    .slice(0, 18_000);

  const result = await infer({
    task: `entities.extract_graph.${params.profile ?? 'general'}`,
    system: EXTRACTION_PROFILES[params.profile ?? 'general'],
    messages: [
      {
        role: 'user',
        content: `Document: "${params.docTitle}" (category: ${params.category}, year: ${params.year})\n\n${body}`,
      },
    ],
    model: params.model ?? 'fast',
    temperature: 0,
    maxTokens: 3000,
  });

  let raw: { entities?: unknown[]; relationships?: unknown[] };
  try {
    raw = JSON.parse(result.content) as typeof raw;
  } catch {
    // One malformed batch must not sink a document run.
    return {
      entities: [],
      relationships: [],
      rejectedByType: 0,
      usage: result.usage,
      model: result.model,
    };
  }

  const entities: ExtractedEntity[] = [];
  for (const candidate of raw.entities ?? []) {
    const parsed = ExtractedEntitySchema.safeParse(candidate);
    if (parsed.success) {
      entities.push({
        ...parsed.data,
        name: canonicalName(parsed.data.name, parsed.data.type),
        attributes: sanitizeAttributes(parsed.data.attributes),
      });
    }
  }

  // Endpoint resolution: exact type:name when the model supplies types,
  // name-only fallback otherwise (types are advisory; names are the anchor).
  const byTypeName = new Set(entities.map((e) => `${e.type}:${e.name.toLowerCase()}`));
  const typeByName = new Map<string, ExtractedEntity['type']>();
  for (const e of entities) {
    if (!typeByName.has(e.name.toLowerCase())) typeByName.set(e.name.toLowerCase(), e.type);
  }
  const resolveType = (
    name: string,
    declared: ExtractedEntity['type'] | undefined,
  ): ExtractedEntity['type'] | null => {
    const key = name.toLowerCase();
    if (declared && byTypeName.has(`${declared}:${key}`)) return declared;
    return typeByName.get(key) ?? null;
  };

  const relationships: ExtractedRelationship[] = [];
  let rejectedByType = 0;
  for (const candidate of raw.relationships ?? []) {
    const parsed = ExtractedRelationshipSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const from = canonicalName(parsed.data.from, parsed.data.from_type);
    const to = canonicalName(parsed.data.to, parsed.data.to_type);
    const fromType = resolveType(from, parsed.data.from_type);
    const toType = resolveType(to, parsed.data.to_type);
    // Rule 5, enforced: both endpoints must exist in this batch's entity list.
    if (!fromType || !toType || from.toLowerCase() === to.toLowerCase()) continue;
    // Rule 6, enforced: the endpoint types must make sense for the relation.
    // Catches confident nonsense like `sector --employs--> location`.
    if (!isEdgeTypeValid(parsed.data.type, fromType, toType)) {
      rejectedByType++;
      continue;
    }
    relationships.push({ ...parsed.data, from, to, from_type: fromType, to_type: toType });
  }

  return { entities, relationships, rejectedByType, usage: result.usage, model: result.model };
}

/**
 * Which endpoint types each relationship is allowed to connect.
 *
 * The model reliably picks plausible-sounding relationships that are
 * semantically impossible — `Construction --employs--> New South Wales` puts a
 * location where an occupation belongs. The prompt asks for correctness; this
 * enforces it, the same way endpoint existence is enforced rather than trusted.
 *
 * `from` / `to` are allow-lists. An empty array means "any type" — used where
 * a relation genuinely is generic (`mentions`, `references`, `part_of`).
 */
const EDGE_TYPE_RULES: Record<
  RelationshipType,
  { from?: readonly EntityType[]; to?: readonly EntityType[] }
> = {
  // An employer is an organisation or a sector; the employed is an occupation.
  employs: {
    from: ['organization', 'sector', 'program', 'policy'],
    to: ['occupation'],
  },
  // Something needs a capability, credential, or role — not a place or a date.
  requires: {
    to: ['skill', 'qualification', 'occupation', 'concept'],
  },
  // Only a credential or programme leads to an occupation or qualification.
  leads_to: {
    from: ['qualification', 'program', 'skill', 'concept', 'policy'],
    to: ['occupation', 'qualification', 'skill', 'concept', 'event', 'metric'],
  },
  // Money flows from a body with money to a thing that receives it. `funding`
  // is a legitimate target — "Government of SA funds the Housing Fast-Track
  // Fund" is a real edge, and an earlier version of this rule wrongly cut it.
  funds: {
    from: ['organization', 'program', 'policy', 'funding', 'event', 'sector'],
    to: [
      'program',
      'organization',
      'sector',
      'policy',
      'funding',
      'concept',
      'location',
      'occupation',
      'qualification',
      'event',
      'metric',
    ],
  },
  located_in: { to: ['location'] },
  targets: {
    to: [
      'sector',
      'occupation',
      'location',
      'concept',
      'skill',
      'qualification',
      'program',
      'organization',
      'policy',
      'metric',
    ],
  },
  // Deliberately unconstrained — these are legitimately generic.
  part_of: {},
  supports: {},
  contradicts: {},
  competes_with: {},
  references: {},
  mentions: {},
};

/** True when an edge's endpoint types are semantically permissible. */
export function isEdgeTypeValid(
  type: RelationshipType,
  fromType: EntityType,
  toType: EntityType,
): boolean {
  const rule = EDGE_TYPE_RULES[type];
  if (!rule) return true;
  if (rule.from && !rule.from.includes(fromType)) return false;
  if (rule.to && !rule.to.includes(toType)) return false;
  return true;
}

/** Words that stay lowercase inside a title-cased phrase. */
const MINOR_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'in', 'to', 'a', 'an', 'on', 'at']);

function titleCase(value: string): string {
  return value
    .split(' ')
    .map((word, i) =>
      i > 0 && MINOR_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/**
 * Normalize an entity name so upserts converge on one row per real-world
 * thing. The model writes the same entity several ways across a corpus —
 * "transport sector", "Transport and Logistics", "the Transport sector" —
 * and each variant would otherwise become its own node.
 *
 * Deliberately conservative: casing is only forced when the model wrote the
 * whole name lowercase (i.e. a common-noun phrase, not a proper name), so
 * "TAFE SA" and "AUKUS" keep their intended form.
 */
export function canonicalName(name: string, type?: ExtractedEntity['type']): string {
  let out = name
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/g, '')
    .replace(/^the\s+/i, '')
    .trim();

  // "transport sector" and "transport" are the same node.
  if (type === 'sector') out = out.replace(/\s+(sector|industry)$/i, '').trim();

  if (out === out.toLowerCase() && /[a-z]/.test(out)) out = titleCase(out);

  return out.trim();
}
