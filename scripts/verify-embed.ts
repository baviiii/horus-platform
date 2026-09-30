/**
 * Verify the embedding path behind /api/embed against the live deployment.
 *
 * Calls core `embed()` directly (the route adds only auth, validation and
 * metering on top), and doubles as the go/no-go check for similarity ranking
 * in CareerCraft: if a nurse's profile does not sit closer to nursing jobs
 * than to unrelated ones, the ranking idea is wrong and nothing should be
 * built on it.
 *
 * `--compare` runs the ranking cases on small AND large side by side — the
 * way to settle whether small is good enough rather than arguing it. The
 * cases lean on where small is most likely to fall short: Australian advert
 * shorthand (AIN, PCA, sparky, FIFO) and roles adjacent to a profile rather
 * than in it.
 *
 * Costs a fraction of a cent. Writes nothing.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-embed.ts [--model small|large] [--compare]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

type Model = 'small' | 'large';
const ix = process.argv.indexOf('--model');
const MODEL = (ix > -1 ? process.argv[ix + 1] : 'small') as Model;
const COMPARE = process.argv.includes('--compare');
const RANKED_MODELS: Model[] = COMPARE ? ['small', 'large'] : [MODEL];
const NATIVE = { small: 1536, large: 3072 }[MODEL];

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(na * nb);
}

/** Shaped like CareerCraft's profileText: target + current title, industry, skills. */
const NURSE =
  'Registered Nurse. Currently Enrolled Nurse. Healthcare. ' +
  'Skills: wound care, patient assessment, medication administration.';

type Tier = 'related' | 'adjacent' | 'unrelated';
interface RankingCase {
  name: string;
  profile: string;
  items: Array<{ tier: Tier; text: string }>;
}

/**
 * Pass rule for every case: each related item and each adjacent item must
 * outscore each unrelated one. Related vs adjacent is deliberately not
 * checked — whether a Clinical Nurse Educator beats a Pharmacy Assistant is a
 * judgement call, not a defect.
 */
const CASES: RankingCase[] = [
  {
    name: 'Nurse profile vs nursing jobs',
    profile: NURSE,
    items: [
      {
        tier: 'related',
        text: 'Enrolled Nurse — Aged Care. Provide nursing care to residents, administer medications and manage wounds.',
      },
      {
        tier: 'related',
        text: 'Patient Care Assistant. Assist nursing staff with patient hygiene, mobility and observations on a public hospital ward.',
      },
      {
        tier: 'related',
        text: 'Registered Nurse — Emergency Department. Triage, patient assessment and acute care in a busy metropolitan ED.',
      },
      {
        tier: 'unrelated',
        text: 'Senior Software Engineer. Build TypeScript services on AWS and mentor junior developers.',
      },
      {
        tier: 'unrelated',
        text: 'Forklift Operator. Load and unload trucks at a Sydney distribution centre. LF licence required.',
      },
      {
        tier: 'unrelated',
        text: 'Accounts Payable Officer. Process supplier invoices and reconcile statements in Xero.',
      },
    ],
  },
  {
    // The profile spells the role out; the adverts abbreviate it.
    name: 'AU shorthand: aged-care profile vs abbreviated adverts',
    profile:
      'Assistant in Nursing. Aged care. Skills: personal care, manual handling, dementia support.',
    items: [
      {
        tier: 'related',
        text: 'AIN — Residential Aged Care. Night shifts providing personal care to residents.',
      },
      {
        tier: 'related',
        text: 'PCA wanted. Cert III Individual Support. Aged care facility in Parramatta.',
      },
      {
        tier: 'related',
        text: 'Support Worker (NDIS). Assist participants with personal care and community access.',
      },
      {
        tier: 'unrelated',
        text: 'Sparky wanted — commercial fit-outs, A-grade licence essential.',
      },
      { tier: 'unrelated', text: 'Chippy / Carpenter — residential framing, own tools and ute.' },
      { tier: 'unrelated', text: 'FIFO Dump Truck Operator — Pilbara iron ore, 2:1 roster.' },
    ],
  },
  {
    // Trade slang on the matching side this time.
    name: 'AU shorthand: electrician profile vs trade slang',
    profile:
      'Electrician. A-grade licence. Construction. Skills: switchboard upgrades, commercial wiring, fault finding.',
    items: [
      { tier: 'related', text: 'Sparky wanted — commercial fit-outs, A-grade licence essential.' },
      {
        tier: 'related',
        text: 'Maintenance Electrician — FIFO, Pilbara iron ore site, 2:1 roster.',
      },
      {
        tier: 'related',
        text: '4th Year Electrical Apprentice — industrial maintenance, Brisbane.',
      },
      { tier: 'unrelated', text: 'PCA — aged care, personal care for residents.' },
      { tier: 'unrelated', text: 'Barista — specialty coffee, weekend shifts.' },
      { tier: 'unrelated', text: 'Payroll Officer — end-to-end payroll in MYOB.' },
    ],
  },
  {
    // Near the profile without being it — the band where a stronger model
    // would be expected to earn its price.
    name: 'Adjacent roles: nurse profile vs health-sector jobs',
    profile: NURSE,
    items: [
      {
        tier: 'related',
        text: 'Clinical Nurse Educator — deliver training to ward nursing staff.',
      },
      {
        tier: 'adjacent',
        text: 'Pharmacy Assistant — dispense medications and advise customers in a community pharmacy.',
      },
      {
        tier: 'adjacent',
        text: 'Medical Receptionist — patient bookings and Medicare billing at a busy GP clinic.',
      },
      {
        tier: 'adjacent',
        text: 'Health Administration Officer — manage patient records in a public hospital.',
      },
      {
        tier: 'unrelated',
        text: 'Senior Software Engineer. Build TypeScript services on AWS and mentor junior developers.',
      },
      {
        tier: 'unrelated',
        text: 'Forklift Operator. Load and unload trucks at a Sydney distribution centre.',
      },
      { tier: 'unrelated', text: 'Barista — specialty coffee, weekend shifts.' },
    ],
  },
  {
    // Job Market News / Market Trends: topical relevance, not a job match.
    name: 'News: nurse profile vs headlines',
    profile: NURSE,
    items: [
      { tier: 'related', text: 'Aged care workers win 15% pay rise in Fair Work decision.' },
      { tier: 'related', text: 'NSW nurses walk off the job over hospital staffing ratios.' },
      { tier: 'unrelated', text: 'Mining boom pushes FIFO wages to record highs in WA.' },
      { tier: 'unrelated', text: 'Sydney tech startups cut jobs as venture funding dries up.' },
      { tier: 'unrelated', text: 'Construction approvals fall for a third straight month.' },
    ],
  },
];

async function main() {
  const { embed, EMBED_MAX_CHARS } = (await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/inference/index.ts')).href
  )) as typeof import('../packages/core/src/inference/index.js');

  console.log(`\nmodel: ${MODEL}${COMPARE ? ' (ranking compared against both models)' : ''}`);

  console.log(`\n1) shape and order`);
  const texts = [NURSE, ...CASES[0]!.items.map((i) => i.text)];
  const res = await embed(texts, { model: MODEL });
  check(
    'one vector per input',
    res.vectors.length === texts.length,
    `${res.vectors.length}/${texts.length}`,
  );
  check(`native width ${NATIVE}`, res.dimensions === NATIVE, `${res.dimensions}`);
  check('reports tokens', res.tokens > 0, `${res.tokens} tokens`);
  console.log(`     deployment: ${res.model}`);

  // The same text at two positions must come back as the same vector —
  // proves results are re-ordered by index, not trusted in arrival order.
  const other = CASES[0]!.items[3]!.text;
  const echo = await embed([other, NURSE, other], { model: MODEL });
  check(
    'vectors land at their input index',
    cosine(echo.vectors[0]!, echo.vectors[2]!) > 0.999 &&
      cosine(echo.vectors[0]!, echo.vectors[1]!) < 0.9,
  );

  console.log(`\n2) caps`);
  const long = await embed(['nurse '.repeat(5000)], { model: MODEL });
  check(
    `input truncated to ${EMBED_MAX_CHARS} chars`,
    long.tokens <= EMBED_MAX_CHARS / 2,
    `${long.tokens} tokens for a 30,000-char input`,
  );
  const short = await embed([NURSE], { model: MODEL, dimensions: 512 });
  check('dimensions: 512 honoured', short.dimensions === 512, `${short.dimensions}`);

  console.log(`\n3) ranking — ${RANKED_MODELS.join(' vs ')}`);
  const verdicts: Record<Model, number> = { small: 0, large: 0 };
  for (const c of CASES) {
    // One call per case per model, profile first — the shape CareerCraft sends.
    const sims: Partial<Record<Model, number[]>> = {};
    for (const model of RANKED_MODELS) {
      const r = await embed([c.profile, ...c.items.map((i) => i.text)], { model });
      const [p, ...items] = r.vectors;
      sims[model] = items.map((v) => cosine(p!, v));
    }

    console.log(`\n   ${c.name}`);
    console.log(`     ${RANKED_MODELS.map((m) => m.padStart(6)).join('')}`);
    const lead = RANKED_MODELS[0]!;
    const order = c.items.map((_, i) => i).sort((a, b) => sims[lead]![b]! - sims[lead]![a]!);
    for (const i of order) {
      const cols = RANKED_MODELS.map((m) => sims[m]![i]!.toFixed(3).padStart(6)).join('');
      console.log(
        `     ${cols}  ${c.items[i]!.tier.padEnd(9)}  ${c.items[i]!.text.split(/[.—]/)[0]!.trim()}`,
      );
    }

    for (const model of RANKED_MODELS) {
      const s = sims[model]!;
      const of = (tier: Tier) => c.items.flatMap((it, i) => (it.tier === tier ? [s[i]!] : []));
      const floor = Math.min(...of('related'), ...of('adjacent'));
      const ceiling = Math.max(...of('unrelated'));
      const ok = floor > ceiling;
      if (ok) verdicts[model]++;
      check(
        `${model}: every related/adjacent item outscores every unrelated one`,
        ok,
        `gap ${(floor - ceiling).toFixed(3)}`,
      );
    }
  }
  console.log(
    `\n     cases passed: ${RANKED_MODELS.map((m) => `${m} ${verdicts[m]}/${CASES.length}`).join(', ')}`,
  );

  console.log(`\n4) response size at CareerCraft volume (1 profile + 50 jobs)`);
  const pool = CASES.flatMap((c) => c.items.map((i) => i.text));
  const fifty = [NURSE, ...Array.from({ length: 50 }, (_, i) => `${pool[i % pool.length]} #${i}`)];
  for (const dimensions of [undefined, 512] as const) {
    const t0 = Date.now();
    const r = await embed(fifty, { model: MODEL, dimensions });
    const kb = Buffer.byteLength(JSON.stringify(r)) / 1024;
    console.log(
      `     ${String(r.dimensions).padStart(4)} dims: ${kb.toFixed(0).padStart(5)} KB, ${Date.now() - t0} ms, ${r.tokens} tokens`,
    );
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nVERIFICATION ERROR:', err);
  process.exit(1);
});
