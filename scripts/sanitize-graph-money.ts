/**
 * Retro-apply the money guard to entities already in the graph.
 *
 * `sanitizeAttributes` runs on every new extraction, but rows written before it
 * existed still carry whatever the model produced from flattened tables —
 * amounts derived from concatenated page furniture, periods like "Volume 4".
 * Those look identical to good data in the UI, and the evidence quote backing
 * them is genuinely verbatim, so nothing downstream can flag them.
 *
 * Dry by default: prints what it would change and writes nothing. Pass --apply
 * to commit, as a small number of bulk UPDATEs rather than one per row.
 *
 * Usage:
 *   pnpm exec tsx scripts/sanitize-graph-money.ts [--apply] [--chunk 500] [--show 15]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

function arg(flag: string): string | null {
  const ix = process.argv.indexOf(flag);
  return ix > -1 ? (process.argv[ix + 1] ?? null) : null;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  const apply = process.argv.includes('--apply');
  const chunk = Number(arg('--chunk') ?? 500);
  const show = Number(arg('--show') ?? 15);

  const { sanitizeAttributes } = (await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/entities/index.ts')).href
  )) as {
    sanitizeAttributes: (
      a: Record<string, unknown> | undefined,
    ) => Record<string, unknown> | undefined;
  };
  const { prisma } = (await import(
    pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href
  )) as any;

  // Only rows that actually carry money-ish attributes.
  const rows: Array<{ id: string; name: string; type: string; metadata: Record<string, unknown> }> =
    await prisma.$queryRawUnsafe(
      `SELECT id, name, type, metadata FROM entities
       WHERE metadata->'attributes' ? 'amount_aud'
          OR metadata->'attributes' ? 'period'`,
    );
  console.log(`entities carrying amount_aud or period: ${rows.length}`);

  const changes: Array<{
    id: string;
    name: string;
    before: unknown;
    after: unknown;
    metadata: Record<string, unknown>;
  }> = [];
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const attrs = meta.attributes as Record<string, unknown> | undefined;
    if (!attrs) continue;
    const cleaned = sanitizeAttributes(attrs);
    if (JSON.stringify(cleaned ?? null) === JSON.stringify(attrs)) continue;

    const nextMeta: Record<string, unknown> = { ...meta };
    if (cleaned && Object.keys(cleaned).length > 0) nextMeta.attributes = cleaned;
    else delete nextMeta.attributes;

    changes.push({
      id: r.id,
      name: r.name,
      before: { amount_aud: attrs.amount_aud, period: attrs.period },
      after: { amount_aud: cleaned?.amount_aud, period: cleaned?.period },
      metadata: nextMeta,
    });
  }

  console.log(`rows the guard would change: ${changes.length}\n`);
  for (const c of changes.slice(0, show)) {
    const b = c.before as Record<string, unknown>;
    const a = c.after as Record<string, unknown>;
    console.log(`  ${c.name.slice(0, 44)}`);
    console.log(`      before amount=${String(b.amount_aud)} period=${JSON.stringify(b.period)}`);
    console.log(`      after  amount=${String(a.amount_aud)} period=${JSON.stringify(a.period)}`);
  }
  if (changes.length > show) console.log(`  … and ${changes.length - show} more`);

  if (!apply) {
    console.log('\ndry run — nothing written. re-run with --apply to commit.');
    await prisma.$disconnect();
    return;
  }
  if (changes.length === 0) {
    console.log('nothing to do.');
    await prisma.$disconnect();
    return;
  }

  // One UPDATE per chunk, joined against a VALUES list.
  let done = 0;
  for (let i = 0; i < changes.length; i += chunk) {
    const slice = changes.slice(i, i + chunk);
    const values = slice
      .map((c) => `(${q(c.id)}::uuid, ${q(JSON.stringify(c.metadata))}::jsonb)`)
      .join(', ');
    await prisma.$executeRawUnsafe(
      `UPDATE entities AS e SET metadata = v.metadata, "updatedAt" = now()
       FROM (VALUES ${values}) AS v(id, metadata)
       WHERE e.id = v.id`,
    );
    done += slice.length;
    console.log(`  updated ${done}/${changes.length}`);
  }
  console.log('\ndone.');
  await prisma.$disconnect();
}

void main();
