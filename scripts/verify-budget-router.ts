/**
 * Verify the budget router against the live graph.
 *
 * Same approach as the CareerCraft retrieval verification (see
 * docs/CAREERCRAFT-INTEGRATION.md §6): exercise the real router through the
 * real tRPC caller against real data, because the things that break here —
 * SQL that only fails on Postgres, JSONB shapes, de-duplication against the
 * actual duplicate pattern in the corpus, tenant isolation — are invisible to
 * the type checker.
 *
 * Read-only. Safe to run against production.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-budget-router.ts [--tenant careercraft] [--period 2026-27]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

function arg(flag: string, fallback: string): string {
  const ix = process.argv.indexOf(flag);
  return ix > -1 ? (process.argv[ix + 1] ?? fallback) : fallback;
}

const TENANT = arg('--tenant', 'careercraft');
const PERIOD = arg('--period', '2026-27');

const money = (n: number) =>
  n >= 1e9
    ? `$${(n / 1e9).toFixed(2)}bn`
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(1)}m`
      : `$${Math.round(n).toLocaleString()}`;

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Quotes lifted verbatim from the live graph, with the amount the extractor
 * recorded alongside them. The AUKUS row is the one that motivated the flag:
 * a real amount beside a real quote that never states it.
 */
const CORROBORATION_CASES: Array<[string, number, boolean, string]> = [
  [
    'A record additional $53 billion investment in Defence capabilities',
    53_000_000_000,
    true,
    'prose billions',
  ],
  [
    '$8.6 billion for nationally significant road and rail projects',
    8_600_000_000,
    true,
    'decimal billions',
  ],
  [
    'Commonwealth Grant Scheme: $8,670,233,000 allocated for 2026-27.',
    8_670_233_000,
    true,
    'comma-grouped',
  ],
  [
    'North-South Corridor — River Torrens to Darlington Dec 2031 15 400 000.',
    15_400_000_000,
    true,
    'space-grouped $000 table',
  ],
  [
    'The 2026-27 Budget reflects that funding is already supporting large scale economic recovery and growth projects across regional areas, including the algal bloom response, Whyalla steelworks, Nyrstar Port Pirie, Northern Water, and AUKUS',
    30_000_000_000,
    false,
    'quote states no figure (AUKUS)',
  ],
  [
    'Funding of $2.5 million over four years',
    53_000_000_000,
    false,
    'figure present but a different one',
  ],
  ['The program will support workers across the state.', 1_000_000, false, 'no digits at all'],
  // False confirmations the first version gave (review, 2026-10-02).
  [
    'The 2026-27 Budget supports regional projects',
    27_000_000,
    false,
    'financial-year suffix is not $27m',
  ],
  ['Funding of $2.5 million over 4 years', 4_000_000, false, '"4 years" is not $4m'],
  [
    'Commonwealth Grant Scheme: $8,670,233,000 allocated',
    670_000_000,
    false,
    'a comma group is not $670m',
  ],
  [
    'DIT Annual Program: 2026-27 Budget $160,805,000',
    158_500_000,
    false,
    'live: quote $160.8m, figure $158.5m',
  ],
  ['A $1.2 billion upgrade', 1_200_000, false, '$1.2bn stored as $1.2m (unit error)'],
  ['Program 1.5: Research support', 1_500_000, false, 'a programme number is not $1.5m'],
  ['Delivered by 2030 with 400 staff', 2_030_000_000, false, 'a year is not $2.03bn'],
  // Live table rows the stricter parser must still read.
  [
    'Marion Road — Anzac Highway to Cross Road Jun 2027 400 000.',
    400_000_000,
    true,
    'live: $000 cell after a date',
  ],
  [
    'New Mount Barker Hospital (d) Dec 2027 365 361 164 400 95 300 98 500',
    365_361_000,
    true,
    'live: welded table columns',
  ],
  [
    'General government revenue offsets - Other: 2026-27 Budget: 232.',
    232_000_000,
    true,
    'live: $m table cell',
  ],
  [
    'Administered payment: $54,803 for Supplementary Funding for the Inclusion Support Program.',
    54_803_000,
    true,
    'live: $ on a $000 cell',
  ],
];

/** Mirrors the router's total/revenue name rule, for checking its output. */
const LOOKS_LIKE_A_TOTAL = /^total\b|\b(revenues?|receipts|appropriations?|borrowings?)\b/i;

async function main() {
  const api = (await import(pathToFileURL(resolve(ROOT, 'packages/api/src/index.ts')).href)) as any;
  const { evidenceStatesAmount } = (await import(
    pathToFileURL(resolve(ROOT, 'packages/api/src/routers/budget.ts')).href
  )) as { evidenceStatesAmount: (e: string | null, a: number) => boolean };
  const { prisma, createTenantScopedClient } = (await import(
    pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href
  )) as any;

  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT } });
  if (!tenant) throw new Error(`tenant "${TENANT}" not found`);

  const callerFor = (t: { id: string }) =>
    api.createCaller(api.appRouter)({
      tenant: t,
      user: null,
      apiKey: null,
      scopes: ['graph:read', 'rag:read', 'entities:read', 'documents:read'],
      ip: null,
      userAgent: 'verify-budget-router',
      prisma,
      db: createTenantScopedClient(t.id),
    });

  const caller = callerFor(tenant);

  console.log(`\n1) evidenceStatesAmount — quotes from the live graph`);
  for (const [quote, amount, expected, label] of CORROBORATION_CASES) {
    const got = evidenceStatesAmount(quote, amount);
    check(label, got === expected, got === expected ? '' : `expected ${expected}, got ${got}`);
  }

  console.log(`\n2) budget.periods`);
  const { periods } = await caller.budget.periods({});
  check('returns periods', periods.length > 0, `${periods.length} periods`);
  check(
    `includes ${PERIOD}`,
    periods.some((p: any) => p.period === PERIOD),
  );
  check(
    'opens on a single financial year',
    /^\d{4}-\d{2}$/.test(periods[0]?.period ?? ''),
    periods[0]?.period,
  );
  console.log(
    `     top: ${periods
      .slice()
      .sort((a: any, b: any) => b.measures - a.measures)
      .slice(0, 4)
      .map((p: any) => `${p.period} (${p.measures})`)
      .join(', ')}`,
  );

  console.log(`\n3) budget.allocations — ${PERIOD}, programs`);
  const alloc = await caller.budget.allocations({ period: PERIOD, types: ['program'], limit: 8 });
  check('returns allocations', alloc.allocations.length > 0, `${alloc.allocations.length} rows`);
  for (const a of alloc.allocations.slice(0, 5)) {
    console.log(
      `     ${money(a.amountAud).padStart(10)}  ${a.name.slice(0, 58).padEnd(58)} ` +
        `[${a.source}] ${a.evidenceStatesAmount ? 'quote states figure' : 'quote = relationship only'}`,
    );
  }

  console.log(`\n4) de-duplication and merging`);
  const wide = await caller.budget.allocations({ period: PERIOD, limit: 60 });
  const keys = wide.allocations.map((a: any) => `${a.name.toLowerCase()}|${a.amountAud}`);
  const dupes = keys.filter((k: string, i: number) => keys.indexOf(k) !== i);
  check('no duplicate measure+amount', dupes.length === 0, dupes.slice(0, 3).join(' / '));
  const merged = wide.allocations.filter((a: any) => a.aliases.length > 0);
  console.log(`     ${merged.length} rows carry "also called" names`);
  // Regression: two different $500m SA funds that share every document, the
  // amount and the words "Fast-Track". A word-overlap rule merged them.
  const top100 = (await caller.budget.allocations({ limit: 100 })).allocations;
  const rowOf = (n: string) => top100.find((a: any) => a.name === n || a.aliases.includes(n))?.id;
  const fastTrack = ['Apartment Fast-Track Fund', 'Housing Fast-Track Fund'];
  if (fastTrack.every((n) => rowOf(n))) {
    check(
      'Apartment and Housing Fast-Track funds stay separate',
      rowOf(fastTrack[0]!) !== rowOf(fastTrack[1]!),
    );
  }

  console.log(`\n4b) totals, revenue and accounting lines are excluded`);
  const totals = top100.filter((a: any) => LOOKS_LIKE_A_TOTAL.test(a.name));
  check(
    'no total/revenue lines in allocations',
    totals.length === 0,
    totals
      .map((a: any) => a.name)
      .slice(0, 3)
      .join(' / '),
  );

  console.log(`\n4c) the chosen quote is stable`);
  const again = await caller.budget.allocations({ period: PERIOD, limit: 60 });
  const drift = wide.allocations.filter(
    (a: any, i: number) =>
      again.allocations[i]?.id !== a.id || again.allocations[i]?.evidence !== a.evidence,
  );
  check('same rows and quotes on a second call', drift.length === 0, `${drift.length} differ`);

  console.log(`\n5) every figure is traceable`);
  const noDocs = wide.allocations.filter((a: any) => a.documents.length === 0);
  check('all allocations cite a document', noDocs.length === 0, `${noDocs.length} without`);
  const corroborated = wide.allocations.filter((a: any) => a.evidenceStatesAmount).length;
  const withQuote = wide.allocations.filter((a: any) => a.evidence).length;
  console.log(
    `     ${wide.allocations.length} allocations: ${withQuote} carry a quote, ` +
      `${corroborated} of those state the figure itself`,
  );

  console.log(`\n6) jurisdiction is labelled`);
  const bySource: Record<string, number> = {};
  for (const a of wide.allocations) bySource[a.source] = (bySource[a.source] ?? 0) + 1;
  check(
    'no unlabelled sources',
    !('other' in bySource) || bySource.other === 0,
    JSON.stringify(bySource),
  );
  console.log(`     ${JSON.stringify(bySource)}`);

  console.log(`\n6b) jurisdiction filter runs in SQL, before LIMIT`);
  for (const source of ['state', 'federal'] as const) {
    const scoped = await caller.budget.allocations({ period: PERIOD, source, limit: 30 });
    const wrong = scoped.allocations.filter((a: any) => a.source !== source);
    check(`source=${source} returns only ${source}`, wrong.length === 0, `${wrong.length} wrong`);
    // Filtering in the caller after a LIMIT would return only the rows of this
    // source that happened to be in the unfiltered top 30. Filtering in SQL
    // returns at least that many. (Comparing against exactly 30 was flaky:
    // merging can legitimately fold a page below its limit.)
    const unfiltered = await caller.budget.allocations({ period: PERIOD, limit: 30 });
    const inTop = unfiltered.allocations.filter((a: any) => a.source === source).length;
    check(
      `source=${source} is filtered before LIMIT`,
      scoped.allocations.length >= inTop && scoped.allocations.length > 0,
      `${scoped.allocations.length} filtered vs ${inTop} in the unfiltered top 30`,
    );
  }

  console.log(`\n7) budget.funders — ${PERIOD}`);
  const { funders } = await caller.budget.funders({ period: PERIOD, limit: 6 });
  check('returns funders', funders.length > 0, `${funders.length}`);
  for (const f of funders) {
    console.log(
      `     ${String(f.measureCount).padStart(4)} measures  ${f.name.slice(0, 48).padEnd(48)}` +
        (f.largestMeasure ? ` largest ${money(f.largestMeasure.amountAud)}` : ''),
    );
  }

  console.log(`\n8) tenant isolation`);
  const others = await prisma.tenant.findMany({ where: { slug: { not: TENANT } } });
  for (const other of others) {
    const res = await callerFor(other).budget.allocations({ limit: 5 });
    check(
      `tenant "${other.slug}" sees no ${TENANT} data`,
      res.allocations.length === 0,
      `${res.allocations.length} rows`,
    );
  }

  console.log(`\n9) empty results degrade gracefully`);
  const empty = await caller.budget.allocations({ period: '1999-00', limit: 5 });
  check('unknown period returns empty, not an error', empty.allocations.length === 0);

  await prisma.$disconnect();

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nVERIFICATION ERROR:', err);
  process.exit(1);
});
