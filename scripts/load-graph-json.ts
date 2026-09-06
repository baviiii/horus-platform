/**
 * Graph load, phase 2 of 2 — graph-extract.json → Postgres, in bulk.
 *
 * Replaces the per-entity round-trips in `persistGraph`, which issued 50-100
 * queries per batch and exhausted the free-tier connection pool badly enough to
 * take the database offline. Everything that used to be a query — "does this
 * entity exist", "what are its aliases", "is this edge already here" — is a Map
 * lookup here. The database sees a handful of multi-row upserts instead of
 * thousands of statements.
 *
 * Emits SQL to a file by default and does not touch the database unless asked.
 * Read it, run it in the Supabase SQL editor, or pass --apply.
 *
 * Merge semantics deliberately match persistGraph:
 *   - entities converge case-insensitively; an existing row keeps its own
 *     casing so the (tenantId, type, name) unique index still matches
 *   - aliases union, capped
 *   - metadata shallow-merges, new values winning
 *   - edge confidence takes the max
 * Two intentional differences, both because this is a rebuild rather than an
 * incremental pass: DocumentEntity.mentions is replaced rather than
 * accumulated, and edge evidence is replaced by the fresh sample. Both make
 * re-running idempotent instead of inflating counts.
 *
 * Usage:
 *   pnpm exec tsx scripts/load-graph-json.ts [--in graph-extract.json]
 *     [--sql-out graph-load.sql] [--apply] [--chunk 500]
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

const MAX_ALIASES = 8;
const MAX_PAGES = 50;

// --- SQL literal helpers ----------------------------------------------------
// Null bytes are stripped: Postgres rejects them in text, and a single one
// anywhere would fail the whole statement.
const clean = (s: string) => s.split(String.fromCharCode(0)).join('');
const q = (s: string) => `'${clean(s).replace(/'/g, "''")}'`;
const arrText = (a: string[]) =>
  a.length ? `ARRAY[${a.map(q).join(',')}]::text[]` : `'{}'::text[]`;
const arrInt = (a: number[]) =>
  a.length ? `ARRAY[${a.map((n) => Math.trunc(n)).join(',')}]::int[]` : `'{}'::int[]`;
const jsonb = (o: unknown) => `${q(JSON.stringify(o))}::jsonb`;

interface JsonEntity {
  name: string;
  type: string;
  aliases: string[];
  attributes?: Record<string, string | number>;
  chunkIxs: number[];
  mentions: number;
}
interface JsonRelationship {
  from: string;
  fromType: string;
  to: string;
  toType: string;
  type: string;
  evidence: string[];
  confidence: number;
}
interface GraphFile {
  version: 1;
  tenant: string;
  tenantId: string;
  documents: Record<
    string,
    {
      documentId: string;
      title: string;
      entities: JsonEntity[];
      relationships: JsonRelationship[];
    }
  >;
}

function statements(values: string[], head: string, tail: string, chunk: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < values.length; i += chunk) {
    out.push(`${head}\nVALUES\n  ${values.slice(i, i + chunk).join(',\n  ')}\n${tail};`);
  }
  return out;
}

async function main() {
  const inPath = resolve(ROOT, arg('--in') ?? 'graph-extract.json');
  const sqlPath = resolve(ROOT, arg('--sql-out') ?? 'graph-load.sql');
  const chunk = Number(arg('--chunk') ?? 500);
  const apply = process.argv.includes('--apply');

  const file = JSON.parse(readFileSync(inPath, 'utf8')) as GraphFile;
  const tenantId = file.tenantId;
  const docs = Object.values(file.documents);
  console.log(`in=${inPath}\ntenant=${file.tenant} documents=${docs.length}`);

  const { prisma } = await import(pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href);

  // One bulk read replaces a findFirst per entity.
  const existingRows: Array<{
    id: string;
    name: string;
    type: string;
    aliases: string[];
    metadata: unknown;
  }> = await prisma.entity.findMany({
    where: { tenantId },
    select: { id: true, name: true, type: true, aliases: true, metadata: true },
  });
  console.log(`existing entities in db: ${existingRows.length}`);

  const existingByKey = new Map(existingRows.map((r) => [`${r.type}:${r.name.toLowerCase()}`, r]));

  // --- merge every document's entities into one global set ------------------
  interface Merged {
    id: string;
    name: string;
    type: string;
    aliases: string[];
    metadata: Record<string, unknown>;
    isNew: boolean;
  }
  const merged = new Map<string, Merged>();

  for (const doc of docs) {
    for (const e of doc.entities) {
      const key = `${e.type}:${e.name.toLowerCase()}`;
      let m = merged.get(key);
      if (!m) {
        const existing = existingByKey.get(key);
        m = {
          id: existing?.id ?? randomUUID(),
          // Keep the stored casing so ON CONFLICT (tenantId, type, name) hits.
          name: existing?.name ?? e.name,
          type: e.type,
          aliases: [...(existing?.aliases ?? [])],
          metadata: { ...((existing?.metadata as Record<string, unknown>) ?? {}) },
          isNew: !existing,
        };
        merged.set(key, m);
      }
      for (const a of e.aliases) {
        if (!m.aliases.includes(a) && m.aliases.length < MAX_ALIASES) m.aliases.push(a);
      }
      if (e.attributes) {
        m.metadata = {
          ...m.metadata,
          attributes: { ...(m.metadata.attributes as object), ...e.attributes },
        };
      }
    }
  }

  const entityValues = [...merged.values()].map(
    (m) =>
      `(${[q(m.id), q(tenantId), q(m.name), q(m.type), arrText(m.aliases), jsonb(m.metadata), 'now()', 'now()'].join(', ')})`,
  );

  // --- document ↔ entity links ---------------------------------------------
  const linkValues: string[] = [];
  for (const doc of docs) {
    for (const e of doc.entities) {
      const m = merged.get(`${e.type}:${e.name.toLowerCase()}`);
      if (!m) continue;
      linkValues.push(
        `(${[
          q(randomUUID()),
          q(tenantId),
          q(doc.documentId),
          q(m.id),
          String(Math.max(1, Math.trunc(e.mentions))),
          arrInt(e.chunkIxs.slice(0, MAX_PAGES)),
          'now()',
        ].join(', ')})`,
      );
    }
  }

  // --- edges ----------------------------------------------------------------
  // Deduped globally: the same edge found in two documents is one row.
  const edges = new Map<string, string>();
  let unresolved = 0;
  for (const doc of docs) {
    for (const r of doc.relationships) {
      const from = merged.get(`${r.fromType}:${r.from.toLowerCase()}`);
      const to = merged.get(`${r.toType}:${r.to.toLowerCase()}`);
      if (!from || !to || from.id === to.id) {
        unresolved++;
        continue;
      }
      const key = `${from.id}|${r.type}|${to.id}`;
      if (edges.has(key)) continue;
      edges.set(
        key,
        `(${[
          q(randomUUID()),
          q(tenantId),
          q(from.id),
          q(to.id),
          q(r.type),
          String(Number.isFinite(r.confidence) ? r.confidence : 0.7),
          jsonb({ evidence: r.evidence.slice(0, 3) }),
          'now()',
        ].join(', ')})`,
      );
    }
  }

  const sql = [
    '-- Generated by scripts/load-graph-json.ts — bulk graph load.',
    `-- tenant ${file.tenant} (${tenantId}) · ${docs.length} documents`,
    `-- ${merged.size} entities (${[...merged.values()].filter((m) => m.isNew).length} new) · ${edges.size} edges · ${linkValues.length} document links`,
    '',
    'BEGIN;',
    '',
    ...statements(
      entityValues,
      'INSERT INTO entities (id, "tenantId", name, type, aliases, metadata, "createdAt", "updatedAt")',
      'ON CONFLICT ("tenantId", type, name) DO UPDATE SET aliases = EXCLUDED.aliases, metadata = EXCLUDED.metadata, "updatedAt" = now()',
      chunk,
    ),
    '',
    ...statements(
      linkValues,
      'INSERT INTO document_entities (id, "tenantId", "documentId", "entityId", mentions, pages, "createdAt")',
      'ON CONFLICT ("documentId", "entityId") DO UPDATE SET mentions = EXCLUDED.mentions, pages = EXCLUDED.pages',
      chunk,
    ),
    '',
    ...statements(
      [...edges.values()],
      'INSERT INTO relationships (id, "tenantId", "fromEntityId", "toEntityId", type, confidence, metadata, "createdAt")',
      'ON CONFLICT ("tenantId", "fromEntityId", "toEntityId", type) DO UPDATE SET confidence = GREATEST(relationships.confidence, EXCLUDED.confidence), metadata = EXCLUDED.metadata',
      chunk,
    ),
    '',
    'COMMIT;',
    '',
  ].join('\n');

  writeFileSync(sqlPath, sql, 'utf8');
  console.log(
    `\nentities   : ${merged.size} (${[...merged.values()].filter((m) => m.isNew).length} new)`,
  );
  console.log(
    `edges      : ${edges.size}${unresolved ? ` (${unresolved} unresolved, skipped)` : ''}`,
  );
  console.log(`doc links  : ${linkValues.length}`);
  console.log(`sql written: ${sqlPath}`);

  if (!apply) {
    console.log(
      '\nnot applied. review it, then re-run with --apply (or paste into the SQL editor).',
    );
    await prisma.$disconnect();
    return;
  }

  // Apply statement-by-statement rather than as one transaction: a single
  // multi-megabyte statement is what tips a small pooled connection over.
  const chunks = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--') && s !== 'BEGIN' && s !== 'COMMIT');
  console.log(`\napplying ${chunks.length} statements…`);
  let done = 0;
  for (const stmt of chunks) {
    await prisma.$executeRawUnsafe(stmt);
    done++;
    if (done % 5 === 0 || done === chunks.length) console.log(`  ${done}/${chunks.length}`);
  }
  const [e, r] = await Promise.all([prisma.entity.count(), prisma.relationship.count()]);
  console.log(`\ngraph now: ${e} entities / ${r} relationships`);
  await prisma.$disconnect();
}

void main();
