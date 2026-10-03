/**
 * Budget reads over the knowledge graph.
 *
 * The graph extractor puts `{ amount_aud, period }` on funding/program entities
 * and records a `funds` edge — carrying verbatim evidence quotes — from the
 * body paying for it. That is enough to answer "what did this budget allocate,
 * to what, and where does that claim come from" without a model in the loop:
 * these procedures are pure reads, so a figure on screen is the figure in the
 * PDF, not a generated restatement of it.
 *
 * ── THE ONE RULE THIS MODULE IS BUILT AROUND ──────────────────────────────
 * It never sums amounts across entities, and it deliberately offers no
 * endpoint that would.
 *
 * `amount_aud` is not a homogeneous series. The same column holds discrete
 * measures ("Fee-Free TAFE"), portfolio roll-ups ("Total Consolidated Account
 * payments", $27.3bn) and balance-sheet stocks ("General Government Sector
 * Total Assets", $127bn) — and the corpus spans two budget years and two
 * jurisdictions, so the same measure is frequently extracted more than once.
 * Adding those together yields a large, authoritative-looking number that
 * corresponds to nothing in any document, and no reader could tell.
 *
 * So every number this router returns is ONE extracted value, carrying the
 * document it came from and the sentence that states it. Aggregation is
 * limited to counting — "this funder appears on 115 measures" is checkable;
 * "this funder spent $X" is not.
 *
 * ── WHAT COUNTS AS A MEASURE ──────────────────────────────────────────────
 * Ranking only means something among like things, so two kinds of figure are
 * kept out of every read:
 *  - `metric` entities, where balance-sheet stocks live (net worth is a stock,
 *    not an allocation);
 *  - totals, revenue, financing and accounting-statement lines that the
 *    extractor typed as `funding`/`program` — see `measureNameFilter`. This is
 *    a name rule, so it is approximate in both directions; the durable fix is
 *    for the extractor to tag each figure's kind, at which point the rule goes.
 *
 * ── TENANCY ───────────────────────────────────────────────────────────────
 * These are raw SQL reads, which do NOT pass through the tenant-scoping Prisma
 * extension in `createTenantScopedClient` — that extension only rewrites
 * `where` clauses on model operations. Every table in every query below is
 * therefore filtered on `"tenantId"` explicitly and parameterised, including
 * tables reached through a join: the schema's single-column foreign keys do
 * not stop a join row pointing across tenants, so being reached through a
 * tenant-filtered row is not enough. Do not remove those predicates.
 */
import { z } from 'zod';
import { Prisma } from '@horus/db';
import { router, scopedProcedure } from '../trpc.js';

/**
 * Entity types that represent money being allocated to something.
 *
 * `metric` is excluded on purpose (see the module header): it is where
 * balance-sheet stocks live. `concept`/`location`/`sector` also carry amounts
 * occasionally, but the figure there is usually a restatement of a measure
 * extracted elsewhere, so they stay out of the default view.
 */
const ALLOCATION_TYPES = ['program', 'funding', 'policy'] as const;

/**
 * Which label to keep when several extractions are merged into one row. The
 * extractor commonly emits one measure as both a `program` and a `funding`
 * entity with an identical amount; `program` names the thing being funded, so
 * it is the better label for a reader.
 */
const TYPE_PREFERENCE: Record<string, number> = { program: 0, policy: 1, funding: 2 };

/**
 * Names that mark a figure as something other than a discrete measure.
 *
 * Calibrated 2026-10-02 against the live graph (2,084 allocation-typed figures
 * with an amount). Whole words only: "RevenueSA Information Online system" is
 * a measure, "Commonwealth Sourced Revenues" is not.
 *  - anything starting "Total" — portfolio and agency roll-ups. Also catches a
 *    few single-initiative totals ("Total Algal Bloom Response"); accepted,
 *    since their component lines are usually extracted too;
 *  - revenue, receipts, appropriations, borrowings, liabilities, assets —
 *    income, financing and agency-level appropriation lines;
 *  - investing / capital programs and expenditure — functional roll-ups;
 *  - operating balance, net worth/debt/lending, cash surplus/deficit.
 * Parameters, not SQL text: Postgres regex syntax (\m, \M) passed as values.
 */
const TOTAL_NAME_PATTERN = [
  String.raw`^total\M`,
  String.raw`\m(revenues?|receipts|appropriations?|borrowings?|liabilit(y|ies)|assets)\M`,
  String.raw`\m(investing|capital) (programs?|expenditure|investment)\M`,
  String.raw`\m(operating (balance|result)|net (worth|debt|lending)|cash (surplus|deficit))\M`,
].join('|');

/**
 * Accounting-statement lines ("Employee Related Payments", "Other Expenses")
 * end in one of these words and are short. The length limit is what keeps
 * long measure names that happen to end the same way —
 * "Further Reducing Spending on Consultants, …, and Non-wage Expenses".
 */
const STATEMENT_LINE_SUFFIX = String.raw`\m(expenses|payments|expenditure)$`;
const STATEMENT_LINE_MAX_WORDS = 6;
const WHITESPACE_RUN = String.raw`\s+`;

/** SQL predicate: the entity aliased `alias` is a measure, not a total. */
function measureNameFilter(alias: 'e' | 'te'): Prisma.Sql {
  const name = Prisma.raw(`${alias}.name`);
  return Prisma.sql`NOT (
    ${name} ~* ${TOTAL_NAME_PATTERN}
    OR (
      ${name} ~* ${STATEMENT_LINE_SUFFIX}
      AND array_length(regexp_split_to_array(btrim(${name}), ${WHITESPACE_RUN}), 1)
          <= ${STATEMENT_LINE_MAX_WORDS}
    )
  )`;
}

/** Period strings shaped like a financial year sort ahead of prose periods. */
const FINANCIAL_YEAR = String.raw`^\d{4}-\d{2}$`;

/** Where a figure was published — a federal measure must never read as a state one. */
export type BudgetSource = 'federal' | 'state' | 'other';

/* ── Does the quote state the figure? ──────────────────────────────────────── */

interface AmountCandidate {
  value: number;
  /** Multipliers under which this number may stand for the amount. */
  scales: number[];
}

/** Budget tables are denominated in $000 or $m; the extractor stores whole dollars. */
const TABLE_SCALES = [1, 1e3, 1e6];
const MAGNITUDE: Record<string, number> = {
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  million: 1e6,
  m: 1e6,
  thousand: 1e3,
  k: 1e3,
};
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
/** Longest run of table columns read as one number: up to 999 billion. */
const MAX_TABLE_GROUPS = 4;

/**
 * Every number in a sentence that could plausibly be the stated amount.
 *
 * The previous version pulled every digit sequence out and tried each at
 * ×1/×1e3/×1e6, which "confirmed" figures the sentence never states: the 27 in
 * "2026-27" stood for $27m, "4 years" for $4m, and the pieces of
 * "$8,670,233,000" for $670m and $233m. Three changes stop that:
 *
 *  1. Dates and financial years are removed first ("Dec 2031", "2026-27") —
 *     they are never amounts, and in capital-works tables they sit directly
 *     before the figure ("Dec 2031 15 400 000") where they would otherwise
 *     weld onto it.
 *  2. Each pass consumes what it matches, so a grouped number is read whole
 *     and never again as its fragments.
 *  3. Only numbers shaped like table cells are scaled: grouped numbers and
 *     whole numbers of 100 or more. "$8.6 billion" is already scaled by its
 *     word; a bare "4" or "2.4" is a count or a programme number, never
 *     "$4 thousand". (A `$` sign proves nothing about units — Commonwealth
 *     tables in $000 write "$54,803" for $54.8m.)
 *
 * What it still cannot do is check units: if the extractor forgot that a
 * table is in $000 and stored $15,400 for "15 400", the digits match and the
 * flag says so. Catching that needs the table's unit recorded at extraction.
 */
function amountCandidates(text: string): AmountCandidate[] {
  const found: AmountCandidate[] = [];
  const cut = (s: string, re: RegExp, take: (m: RegExpMatchArray) => void) =>
    s.replace(re, (...args) => {
      take(args.slice(0, -2) as unknown as RegExpMatchArray);
      return ' | ';
    });
  const num = (raw: string) => Number(raw.replace(/[,\s]/g, ''));
  const push = (value: number, scales: number[]) => {
    if (Number.isFinite(value) && value > 0) found.push({ value, scales });
  };

  let s = text
    .replace(new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s+(?:19|20)\\d{2}\\b`, 'gi'), ' | ')
    .replace(/\b(?:19|20)\d{2}\s*[-–/]\s*\d{2}(?:\d{2})?\b/g, ' | ')
    // A bare year. A 4-digit run is never a later group of a space-grouped
    // number, so stripping it can only stop it welding onto the figure after it.
    .replace(/(?<![\d,.$])\b(?:19|20)\d{2}\b(?![\d,])/g, ' | ');

  // "$8.6 billion", "$53m", "1,200 million" — already scaled by the word.
  s = cut(
    s,
    /\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(billion|bn|b|million|m|thousand|k)\b/gi,
    (m) => push(num(m[1]!) * MAGNITUDE[m[2]!.toLowerCase()]!, [1]),
  );
  // "$9,232,506,000" (dollars) or "$54,803" (a $000 table cell — Commonwealth
  // tables put `$` on cells too, so the sign says nothing about the unit).
  s = cut(s, /\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, (m) => push(num(m[0]!), TABLE_SCALES));
  // "365 361 164 400": space-grouped table columns, often several in a row.
  // Any run of 2–4 adjacent groups may be one cell.
  s = cut(s, /\d{1,3}(?: \d{3})+/g, (m) => {
    const groups = m[0]!.split(' ');
    for (let start = 0; start < groups.length; start++) {
      for (let len = 2; len <= MAX_TABLE_GROUPS && start + len <= groups.length; len++) {
        push(num(groups.slice(start, start + len).join('')), TABLE_SCALES);
      }
    }
  });
  // Whatever is left. "232." in a $m table is a cell; "4" or "2.4" never is.
  cut(s, /(?<![\d.,])\d+(?:\.\d+)?(?![\d,]|\.\d)/g, (m) => {
    const value = Number(m[0]!);
    push(value, Number.isInteger(value) && value >= 100 ? TABLE_SCALES : [1]);
  });

  return found;
}

/**
 * Does the evidence quote actually state this figure?
 *
 * This matters more than it first appears. The evidence quote hangs off the
 * `funds` EDGE — it is proof that "X funds Y", not necessarily proof of the
 * amount, which the extractor may have read from a table cell elsewhere in the
 * chunk. Observed in the live graph: AUKUS carries amount_aud = 30bn and the
 * quote "…funding is already supporting large scale economic recovery…
 * including … AUKUS", which states no figure at all. Rendering that amount
 * beside that quote implies a corroboration that does not exist.
 *
 * So the flag is computed and passed to the client, which labels the two cases
 * differently rather than letting a reader assume the stronger one. A 1%
 * tolerance absorbs rounded prose ("$8.6 billion" for 8,612,000,000).
 */
export function evidenceStatesAmount(evidence: string | null, amount: number): boolean {
  if (!evidence || !Number.isFinite(amount) || amount === 0) return false;
  const target = Math.abs(amount);
  return amountCandidates(evidence).some(({ value, scales }) =>
    scales.some((scale) => Math.abs(value * scale - target) <= target * 0.01),
  );
}

export interface BudgetDocumentRef {
  id: string;
  title: string;
  category: string | null;
}

export interface BudgetAllocation {
  id: string;
  name: string;
  /**
   * Other names the same measure was extracted under — same amount, same
   * period, same source document. Shown as "also called …" rather than as
   * separate bars, which would rank one measure three times.
   */
  aliases: string[];
  /** Graph entity type — `program`, `funding` or `policy`. */
  type: string;
  amountAud: number;
  /** As stated in the document ("2026-27", "2025-26 to 2029-30"), or null. */
  period: string | null;
  source: BudgetSource;
  /**
   * Verbatim sentence backing this measure: the first quote, across every
   * `funds` edge into it (strongest edge first), that states the amount;
   * failing that, the strongest edge's first quote.
   */
  evidence: string | null;
  /**
   * True when `evidence` itself states `amountAud`. False means the quote
   * establishes the funding relationship but not the figure — the client must
   * not present it as the figure's source. See `evidenceStatesAmount`.
   */
  evidenceStatesAmount: boolean;
  /** Entities the graph says fund this measure. */
  funders: string[];
  /** Corpus documents this measure was extracted from. */
  documents: BudgetDocumentRef[];
}

/** Raw row shape returned by the allocations query. */
interface AllocationRow {
  id: string;
  name: string;
  type: string;
  amount: number;
  period: string | null;
  /** Computed in SQL so the filter and the label can never disagree. */
  source: BudgetSource;
  /** Every quote on every incoming `funds` edge, strongest edge first. */
  quotes: string[] | null;
  funders: string[] | null;
  documents: BudgetDocumentRef[] | null;
}

/** Minimal union-find over row indexes. */
function makeUnionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  return {
    find,
    union: (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    },
  };
}

/** Words too common in budget lines to show that two of them are one measure. */
const GENERIC_WORDS = new Set([
  'program',
  'programme',
  'programs',
  'fund',
  'funds',
  'funding',
  'package',
  'initiative',
  'initiatives',
  'investment',
  'investments',
  'support',
  'reduction',
  'government',
  'australia',
  'australian',
  'australians',
  'national',
  'state',
  'south',
  'cost',
  'costs',
  'measure',
  'measures',
  'grant',
  'grants',
  'scheme',
  'round',
  'plan',
  'strategy',
  'service',
  'services',
  'project',
  'projects',
  'infrastructure',
  'budget',
  'additional',
  'billion',
  'million',
  'with',
  'from',
  'that',
  'this',
  'will',
  'into',
  'over',
  'their',
  'more',
  'than',
  'also',
]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w))
      // Australian and US spellings both occur ("Modernisation"/"Modernization").
      .map((w) => w.replace(/is(ation|e|ed|es|ing)$/, 'iz$1')),
  );
}

const isSubset = (small: Set<string>, big: Set<string>) =>
  small.size > 0 && [...small].every((w) => big.has(w));

/**
 * Do two same-amount rows from one document describe the same measure?
 *
 * Sharing a document is not enough: round amounts collide. The SA papers fund
 * both a $500m "Apartment Fast-Track Fund" (CBD apartments) and a $500m
 * "Housing Fast-Track Fund" (strategic land) — different measures that share
 * every document, the amount and even "Fast-Track". So the test looks for
 * positive evidence of sameness, and when in doubt leaves two bars rather
 * than hiding a measure inside another:
 *
 *  - an identical quote;
 *  - one name's distinctive words contained in the other's ("Fuel Excise
 *    Reduction" / "Fuel Excise Reduction Program", "PBS Medicines Program" /
 *    "Life-Saving Medicines Cost Reduction") — "Apartment…" vs "Housing…"
 *    fails, because each has a word the other lacks;
 *  - a quote that states the amount and names the other row's distinguishing
 *    words: "$2.9 billion to … halve the fuel excise and reduce the heavy
 *    vehicle road user charge…" ties "Heavy Vehicle Road User Charge
 *    Reduction" to the fuel-excise measure. Only figure-stating quotes count;
 *    a general sentence mentioning both is not evidence they are one figure.
 */
function describeSameMeasure(a: AllocationRow, b: AllocationRow): boolean {
  const quotesA = a.quotes ?? [];
  const quotesB = b.quotes ?? [];
  if (quotesA.some((q) => quotesB.includes(q))) return true;

  const wordsA = significantWords(a.name);
  const wordsB = significantWords(b.name);
  if (isSubset(wordsA, wordsB) || isSubset(wordsB, wordsA)) return true;

  const names = (other: Set<string>, own: Set<string>, quotes: string[], amount: number) => {
    const distinguishing = [...other].filter((w) => !own.has(w));
    const stating = quotes.filter((q) => evidenceStatesAmount(q, amount));
    if (distinguishing.length === 0 || stating.length === 0) return false;
    const quoted = significantWords(stating.join(' '));
    const hits = distinguishing.filter((w) => quoted.has(w)).length;
    return hits >= Math.ceil(distinguishing.length / 2);
  };
  return names(wordsB, wordsA, quotesA, a.amount) || names(wordsA, wordsB, quotesB, b.amount);
}

/**
 * Collapse extractions of the same measure into one row.
 *
 * Two rows are the same measure when they share amount and period and
 * either (a) have the same name, or (b) were extracted from a common source
 * document AND `describeSameMeasure` finds them related. (b) is what folds one
 * $5.9bn medicines measure extracted as "PBS Medicines Program", "Life-Saving
 * Medicines Cost Reduction Program" and "…Reduction" into one bar. Two
 * different measures with the same amount in different papers never merge.
 *
 * Merging never drops information: the label comes from the best row, but
 * evidence, funders and documents are drawn from every row in the group.
 */
function mergeExtractions(rows: AllocationRow[]): BudgetAllocation[] {
  const uf = makeUnionFind(rows.length);
  const buckets = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = `${row.amount}|${row.period ?? ''}`;
    buckets.set(key, [...(buckets.get(key) ?? []), i]);
  });
  for (const members of buckets.values()) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const a = rows[members[x]!]!;
        const b = rows[members[y]!]!;
        const sameName = a.name.toLowerCase() === b.name.toLowerCase();
        const docsA = new Set((a.documents ?? []).map((d) => d.id));
        const sharedDoc = (b.documents ?? []).some((d) => docsA.has(d.id));
        if (sameName || (sharedDoc && describeSameMeasure(a, b))) {
          uf.union(members[x]!, members[y]!);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const root = uf.find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  // Groups come out in rank order: a root is always its group's lowest index.
  return [...groups.values()].map((members) => {
    const group = members.map((i) => rows[i]!);
    const states = (row: AllocationRow) =>
      (row.quotes ?? []).some((q) => evidenceStatesAmount(q, row.amount));
    const label = [...group].sort(
      (a, b) =>
        (TYPE_PREFERENCE[a.type] ?? 9) - (TYPE_PREFERENCE[b.type] ?? 9) ||
        Number(states(b)) - Number(states(a)) ||
        Number(Boolean(b.quotes?.length)) - Number(Boolean(a.quotes?.length)),
    )[0]!;

    // The label's own quotes first, then the rest of the group in rank order.
    const quotes = [label, ...group.filter((r) => r !== label)].flatMap((r) => r.quotes ?? []);
    const evidence = quotes.find((q) => evidenceStatesAmount(q, label.amount)) ?? quotes[0] ?? null;

    const aliases: string[] = [];
    for (const row of group) {
      const lower = row.name.toLowerCase();
      if (lower !== label.name.toLowerCase() && !aliases.some((a) => a.toLowerCase() === lower)) {
        aliases.push(row.name);
      }
    }

    const documents = new Map<string, BudgetDocumentRef>();
    for (const row of group) for (const d of row.documents ?? []) documents.set(d.id, d);

    const source: BudgetSource = group.some((r) => r.source === 'federal')
      ? 'federal'
      : group.some((r) => r.source === 'state')
        ? 'state'
        : 'other';

    return {
      id: label.id,
      name: label.name,
      aliases,
      type: label.type,
      amountAud: label.amount,
      period: label.period,
      source,
      evidence,
      evidenceStatesAmount: evidenceStatesAmount(evidence, label.amount),
      funders: [...new Set(group.flatMap((r) => r.funders ?? []))].sort(),
      documents: [...documents.values()],
    };
  });
}

export const budgetRouter = router({
  /**
   * Periods the corpus actually carries figures for, with how many measures
   * back each. Drives a period selector honestly: a year absent here has no
   * extracted data, and the UI can say so instead of rendering an empty chart.
   *
   * `measures` counts distinct name + amount pairs, so a measure extracted as
   * both a program and a funding entity counts once. Near-duplicates under
   * different names (merged by `allocations`) still count separately, so this
   * is an upper bound on the bars that period will show.
   */
  periods: scopedProcedure('graph:read')
    .input(z.object({ minMeasures: z.number().int().min(1).max(100).default(5) }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.$queryRaw<Array<{ period: string; measures: number }>>`
        SELECT period, COUNT(*)::int AS measures
        FROM (
          SELECT DISTINCT
                 e.metadata->'attributes'->>'period' AS period,
                 lower(e.name) AS name,
                 (e.metadata->'attributes'->>'amount_aud')::float8 AS amount
          FROM entities e
          WHERE e."tenantId" = ${ctx.tenant.id}::uuid
            AND jsonb_typeof(e.metadata->'attributes'->'amount_aud') = 'number'
            AND e.metadata->'attributes'->>'period' IS NOT NULL
            AND e.type = ANY(${[...ALLOCATION_TYPES]}::text[])
            AND ${measureNameFilter('e')}
        ) measures
        GROUP BY period
        HAVING COUNT(*) >= ${input.minMeasures}
        -- Single financial years ("2026-27": consecutive years, not a range
        -- like "2026-30") first, best-covered first — so a client that
        -- defaults to the first entry opens on the year with the most figures,
        -- not a forward estimate with eight. Ranges and prose periods after.
        ORDER BY CASE WHEN period ~ ${FINANCIAL_YEAR}
                      THEN (substr(period, 3, 2)::int + 1) % 100 = substr(period, 6, 2)::int
                      ELSE false END DESC,
                 measures DESC,
                 period DESC
      `;
      return { periods: rows };
    }),

  /**
   * Measures ranked by the amount stated for them, each with its evidence and
   * source documents. This is the only place amounts are exposed, and they are
   * exposed one at a time — see the module header.
   */
  allocations: scopedProcedure('graph:read')
    .input(
      z.object({
        period: z.string().max(40).optional(),
        source: z.enum(['federal', 'state', 'other']).optional(),
        types: z
          .array(z.enum(ALLOCATION_TYPES))
          .min(1)
          .max(3)
          .default([...ALLOCATION_TYPES]),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Over-fetch: merging happens after the database has ranked, so the cap
      // has to leave room for the extractions that will be folded together.
      // 4x comfortably covers the observed duplication.
      const fetchLimit = Math.min(input.limit * 4, 400);
      const tenantId = ctx.tenant.id;

      const rows = await ctx.db.$queryRaw<AllocationRow[]>`
        WITH money AS (
          SELECT e.id,
                 e.name,
                 e.type,
                 (e.metadata->'attributes'->>'amount_aud')::float8 AS amount,
                 e.metadata->'attributes'->>'period' AS period,
                 -- Jurisdiction, from the category set at ingestion. Computed
                 -- here rather than in the caller so the value shown and the
                 -- value filtered on cannot drift apart. A measure appearing in
                 -- both (the state papers discuss Commonwealth-funded projects)
                 -- counts as federal — that is who appropriated the money.
                 CASE
                   WHEN EXISTS (
                     SELECT 1 FROM document_entities de
                     JOIN documents d ON d.id = de."documentId"
                     WHERE de."entityId" = e.id
                       AND de."tenantId" = ${tenantId}::uuid
                       AND d."tenantId" = ${tenantId}::uuid
                       AND d.category = 'budget-federal'
                   ) THEN 'federal'
                   WHEN EXISTS (
                     SELECT 1 FROM document_entities de
                     JOIN documents d ON d.id = de."documentId"
                     WHERE de."entityId" = e.id
                       AND de."tenantId" = ${tenantId}::uuid
                       AND d."tenantId" = ${tenantId}::uuid
                       AND d.category = 'budget'
                   ) THEN 'state'
                   ELSE 'other'
                 END AS source
          FROM entities e
          WHERE e."tenantId" = ${tenantId}::uuid
            AND jsonb_typeof(e.metadata->'attributes'->'amount_aud') = 'number'
            AND e.type = ANY(${input.types as string[]}::text[])
            AND ${measureNameFilter('e')}
            AND (${input.period ?? null}::text IS NULL
                 OR e.metadata->'attributes'->>'period' = ${input.period ?? null}::text)
        )
        SELECT m.id,
               m.name,
               m.type,
               m.amount,
               m.period,
               m.source,
               (
                 -- Every quote on every funds edge, strongest edge first. The
                 -- caller picks the first that states the amount; looking only
                 -- at one edge's first quote shows a weaker quote when a
                 -- stronger one exists.
                 SELECT jsonb_agg(ev.quote ORDER BY r.confidence DESC, r.id, ev.ord)
                 FROM relationships r
                 CROSS JOIN LATERAL jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(r.metadata->'evidence') = 'array'
                        THEN r.metadata->'evidence' ELSE '[]'::jsonb END
                 ) WITH ORDINALITY AS ev(quote, ord)
                 WHERE r."toEntityId" = m.id
                   AND r.type = 'funds'
                   AND r."tenantId" = ${tenantId}::uuid
               ) AS quotes,
               (
                 SELECT jsonb_agg(DISTINCT fe.name)
                 FROM relationships r
                 JOIN entities fe ON fe.id = r."fromEntityId"
                 WHERE r."toEntityId" = m.id
                   AND r.type = 'funds'
                   AND r."tenantId" = ${tenantId}::uuid
                   AND fe."tenantId" = ${tenantId}::uuid
               ) AS funders,
               (
                 SELECT jsonb_agg(DISTINCT jsonb_build_object(
                          'id', d.id, 'title', d.title, 'category', d.category))
                 FROM document_entities de
                 JOIN documents d ON d.id = de."documentId"
                 WHERE de."entityId" = m.id
                   AND de."tenantId" = ${tenantId}::uuid
                   AND d."tenantId" = ${tenantId}::uuid
               ) AS documents
        FROM money m
        -- Filtered before LIMIT, not after: filtering the fetched page in the
        -- caller would silently under-return whenever one jurisdiction
        -- dominates the top of the ranking.
        WHERE (${input.source ?? null}::text IS NULL
               OR m.source = ${input.source ?? null}::text)
        ORDER BY m.amount DESC, m.id
        LIMIT ${fetchLimit}
      `;

      return {
        allocations: mergeExtractions(rows).slice(0, input.limit),
        period: input.period ?? null,
        /**
         * Stated so a caller can render provenance rather than implying the
         * list is a complete or additive account of the budget.
         */
        basis:
          'Individual figures extracted from source documents. Not summed. ' +
          'Totals, revenue and accounting lines are excluded.',
      };
    }),

  /**
   * Bodies the graph records as funding something, ranked by how many measures
   * they appear on.
   *
   * Counts, not totals: a funder's measure count is verifiable against the
   * graph, whereas summing the amounts on its edges would double-count
   * roll-ups and re-extractions. `largestMeasure` is a single real figure,
   * shown so the row means something beyond a count.
   */
  funders: scopedProcedure('graph:read')
    .input(
      z.object({
        period: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(50).default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenant.id;
      const rows = await ctx.db.$queryRaw<
        Array<{
          name: string;
          type: string;
          measures: number;
          largest_name: string | null;
          largest_amount: number | null;
        }>
      >`
        WITH funded AS (
          SELECT fe.id AS funder_id,
                 fe.name AS funder_name,
                 fe.type AS funder_type,
                 te.name AS measure_name,
                 (te.metadata->'attributes'->>'amount_aud')::float8 AS amount
          FROM relationships r
          JOIN entities fe ON fe.id = r."fromEntityId" AND fe."tenantId" = ${tenantId}::uuid
          JOIN entities te ON te.id = r."toEntityId" AND te."tenantId" = ${tenantId}::uuid
          WHERE r.type = 'funds'
            AND r."tenantId" = ${tenantId}::uuid
            AND jsonb_typeof(te.metadata->'attributes'->'amount_aud') = 'number'
            AND te.type = ANY(${[...ALLOCATION_TYPES]}::text[])
            AND ${measureNameFilter('te')}
            AND (${input.period ?? null}::text IS NULL
                 OR te.metadata->'attributes'->>'period' = ${input.period ?? null}::text)
        ),
        counted AS (
          -- Distinct measure names, so a measure extracted several times from
          -- the same funder counts once. (Postgres has no DISTINCT inside a
          -- window function, hence the GROUP BY + lateral rather than one pass.)
          SELECT funder_id, funder_name, funder_type,
                 COUNT(DISTINCT lower(measure_name))::int AS measures
          FROM funded
          GROUP BY funder_id, funder_name, funder_type
          ORDER BY measures DESC, funder_name
          LIMIT ${input.limit}
        )
        SELECT c.funder_name AS name,
               c.funder_type AS type,
               c.measures,
               l.measure_name AS largest_name,
               l.amount AS largest_amount
        FROM counted c
        LEFT JOIN LATERAL (
          -- By entity id: two funders sharing a name (an organisation and a
          -- programme called "Department for Education") are different rows
          -- and must not borrow each other's largest measure.
          SELECT f.measure_name, f.amount
          FROM funded f
          WHERE f.funder_id = c.funder_id
          ORDER BY f.amount DESC, f.measure_name
          LIMIT 1
        ) l ON TRUE
        ORDER BY c.measures DESC, c.funder_name
      `;

      return {
        funders: rows.map((r) => ({
          name: r.name,
          type: r.type,
          measureCount: r.measures,
          largestMeasure:
            r.largest_name && r.largest_amount !== null
              ? { name: r.largest_name, amountAud: r.largest_amount }
              : null,
        })),
        basis: 'Measure counts from `funds` edges. Amounts are single figures, never totals.',
      };
    }),
});
