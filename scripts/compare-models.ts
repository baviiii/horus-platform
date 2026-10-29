/**
 * Compare Bedrock models on real CareerCraft questions, through Horus's own
 * knowledge agent (the same tool loop CareerCraft's chat uses).
 *
 * Each question's answer is stated in one place in the SA corpus, so grading
 * is a deterministic check for the expected facts — no model grades another.
 * Cost uses list prices per million tokens (Bedrock Sydney where AWS
 * publishes them, Anthropic list prices for Claude).
 *
 * Needs the corpus in the horus-knowledge index (scripts/aws-load-corpus.ts)
 * and credentials allowed to invoke every model: run it under an admin
 * profile with the app key blanked, e.g.
 *   HORUS_AWS_ACCESS_KEY_ID= HORUS_AWS_SECRET_ACCESS_KEY= AWS_PROFILE=horus \
 *     pnpm exec tsx scripts/compare-models.ts [--models id,id] [--only 3]
 *
 * Costs a few dollars of Bedrock usage for the full set.
 */
import { writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(ROOT, 'apps/web/.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
  }
}
process.env.HORUS_AI_PROVIDER = 'aws';

const core = (path: string) => import(pathToFileURL(resolve(ROOT, 'packages/core/src', path)).href);

/** CareerCraft's tenant and corpus session, as loaded from the Azure backup. */
const TENANT = '363f194b-3447-43de-8e99-3ac3ad2efacb';
const SESSION = 'workspace';
const INDEX = process.env.AZURE_SEARCH_INDEX_NAME ?? 'horus-knowledge';

/** USD per million tokens [input, output]. */
const PRICES: Record<string, [number, number]> = {
  'au.anthropic.claude-sonnet-4-6': [3, 15],
  'au.anthropic.claude-haiku-4-5-20251001-v1:0': [1, 5],
  'moonshotai.kimi-k2.5': [0.618, 3.09],
  'deepseek.v3.2': [0.6386, 1.9055],
  'mistral.mistral-large-3-675b-instruct': [0.515, 1.545],
  'minimax.minimax-m2.5': [0.31, 1.24],
  'openai.gpt-oss-120b-1:0': [0.1545, 0.618],
};

/**
 * Each answer must contain one alternative from every group. Numbers are
 * compared with separators removed, so "14,000" and "14 000" both match.
 */
interface Case {
  q: string;
  expect: string[][];
  source: string;
}

const CASES: Case[] = [
  {
    q: 'How many workers does the South Australian defence sector employ?',
    expect: [['14000']],
    source: 'SA Jobs and Skills Outlook',
  },
  {
    q: 'By how much did job advertisements in South Australia grow over the year to December 2025?',
    expect: [['3.7']],
    source: 'Australian Jobs 2026',
  },
  {
    q: 'According to Jobs and Skills Australia, what share of employment growth over the 10 years to May 2035 will need post-school training or education?',
    expect: [['90']],
    source: 'Australian Jobs 2026',
  },
  {
    q: 'How many FTE education staff did TAFE SA employ as of March 2023?',
    expect: [['991']],
    source: 'Roadmap for the Future of TAFE SA',
  },
  {
    q: 'How big is the Apartment Fast-Track Fund in the SA 2026-27 Budget?',
    expect: [['500 million', '500m', '$500']],
    source: 'SA Budget 2026-27 Speech',
  },
  {
    q: 'How many extra hospital beds has the SA Government added since 2022, according to the 2026-27 Budget Speech?',
    expect: [['678']],
    source: 'SA Budget 2026-27 Speech',
  },
  {
    q: 'How many additional nurses has the SA Government employed since being elected in 2022?',
    expect: [['2091']],
    source: 'SA Budget 2026-27 Speech',
  },
  {
    q: "How fast did South Australia's State Final Demand grow through the year to the March quarter 2026?",
    expect: [['3.8']],
    source: 'SA Budget 2026-27 Speech',
  },
  {
    q: 'How much does the SA 2026-27 Budget provide for new gyms or halls at schools, and at how many schools?',
    expect: [
      ['50 million', '$50m', '$50 m'],
      ['six', '6 schools'],
    ],
    source: 'SA Budget 2026-27 Overview',
  },
  {
    q: 'How many free period product dispensers have been installed for TAFE SA students?',
    expect: [['243']],
    source: 'SA Budget 2026-27 Overview',
  },
  {
    q: "What is the effective tax-free threshold for Australian workers after the 2026-27 federal Budget's instant deduction?",
    expect: [['19985']],
    source: 'Federal Budget 2026-27 Overview',
  },
  {
    q: 'How large is the instant tax deduction for work expenses in the 2026-27 federal Budget?',
    expect: [['1000']],
    source: 'Federal Budget 2026-27 Overview',
  },
  {
    q: 'Who is the South Australian Skills Commissioner, and when was he appointed?',
    expect: [['cameron baker'], ['2023']],
    source: 'SA Skills Commission Annual Report 2024-25',
  },
  {
    q: 'How large is the National Skills Agreement that the SA Skills Commission strategic plan responds to?',
    expect: [['2.3 billion', '$2.3b', '2.3b']],
    source: 'SA Skills Commission Strategic Plan 2025',
  },
  {
    q: "How big is South Australia's early childhood workforce development fund?",
    expect: [['56 million', '$56m', '$56 m']],
    source: 'SA Jobs and Skills Outlook',
  },
  {
    q: "What NFPS net debt to revenue ratio does SA's 2025-26 Mid-Year Budget Review expect at 30 June 2029?",
    expect: [['136.7']],
    source: 'SA Mid-Year Budget Review 2025-26',
  },
  {
    q: 'How much did SA invest in the Rural Youth Ambassadors program in 2023 and 2024?',
    expect: [['70000', '70k']],
    source: 'SA Country Education Strategy Progress 2023',
  },
  {
    q: 'How much funding does the SA 2026-27 Budget give for a co-located gymnasium at Golden Grove High School and Gleeson College?',
    expect: [['10 million', '10.0 million', '$10m', '$10 m']],
    source: 'SA Budget 2026-27 Measures',
  },
  {
    q: 'Up to how many students do STEM education pathways supported by the SA defence and space sector reach across the state?',
    expect: [['27000']],
    source: 'SA Defence and Space Maritime Edition',
  },
  {
    q: 'Over what years does the SA Jobs and Skills Outlook project demand for new qualifications?',
    expect: [['2024'], ['2028']],
    source: 'SA Jobs and Skills Outlook',
  },
  {
    q: 'When answering selection criteria, what does the STAR method stand for?',
    expect: [['situation'], ['task'], ['action'], ['result']],
    source: 'Selection criteria guides',
  },
];

const normalise = (s: string) => s.toLowerCase().replace(/(\d)[,\s](?=\d{3}\b)/g, '$1');

function passes(answer: string, expect: string[][]): boolean {
  const a = normalise(answer);
  return expect.every((group) => group.some((alt) => a.includes(normalise(alt))));
}

interface Run {
  model: string;
  q: string;
  ok: boolean;
  answer: string;
  tools: string[];
  inputTokens: number;
  outputTokens: number;
  ms: number;
  error?: string;
}

async function ask(model: string, c: Case): Promise<Run> {
  const { runKnowledgeAgent } = await core('agent/run.ts');
  process.env.HORUS_MODEL_FAST = model;
  let answer = '';
  const tools: string[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  try {
    await runKnowledgeAgent({
      indexName: INDEX,
      tenantId: TENANT,
      sessionId: SESSION,
      messages: [{ role: 'user', content: c.q }],
      model: 'fast',
      emit: (e: {
        kind: string;
        text?: string;
        name?: string;
        status?: string;
        usage?: typeof usage;
      }) => {
        if (e.kind === 'token' && e.text) answer += e.text;
        if (e.kind === 'tool' && e.status === 'start' && e.name) tools.push(e.name);
        if (e.kind === 'done' && e.usage) usage = e.usage;
      },
    });
    return {
      model,
      q: c.q,
      ok: passes(answer, c.expect),
      answer,
      tools,
      ...usage,
      ms: Date.now() - started,
    };
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { model, q: c.q, ok: false, answer, tools, ...usage, ms: Date.now() - started, error };
  }
}

async function main(): Promise<void> {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const models = (arg('--models') ?? Object.keys(PRICES).join(',')).split(',');
  const only = Number(arg('--only') ?? CASES.length);
  const cases = CASES.slice(0, only);

  // Models run one after another: HORUS_MODEL_FAST is process-wide.
  const runs: Run[] = [];
  for (const model of models) {
    process.stdout.write(`\n${model}\n`);
    for (const c of cases) {
      const r = await ask(model, c);
      runs.push(r);
      process.stdout.write(r.error ? 'E' : r.ok ? '.' : 'x');
      if (
        r.error &&
        /not available|AccessDenied|ValidationException|ResourceNotFound/i.test(r.error)
      ) {
        process.stdout.write(`  stopped: ${r.error.slice(0, 160)}`);
        break;
      }
    }
  }

  console.log('\n\nmodel | passed | avg s | tokens in/out | cost (this run) | cost per question');
  for (const model of models) {
    const rs = runs.filter((r) => r.model === model);
    if (rs.length === 0) continue;
    const [pin, pout] = PRICES[model] ?? [0, 0];
    const tin = rs.reduce((s, r) => s + r.inputTokens, 0);
    const tout = rs.reduce((s, r) => s + r.outputTokens, 0);
    const cost = (tin * pin + tout * pout) / 1e6;
    const avg = rs.reduce((s, r) => s + r.ms, 0) / rs.length / 1000;
    console.log(
      `${model} | ${rs.filter((r) => r.ok).length}/${rs.length} | ${avg.toFixed(1)} | ${tin}/${tout} | $${cost.toFixed(3)} | $${(cost / rs.length).toFixed(4)}`,
    );
  }

  const out = join(tmpdir(), `horus-model-comparison-${Date.now()}.json`);
  writeFileSync(out, JSON.stringify({ cases, runs }, null, 2));
  console.log(`\nfull answers: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
