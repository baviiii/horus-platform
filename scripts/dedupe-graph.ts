/**
 * Graph dedupe — re-canonicalise existing entities and merge duplicates.
 *
 * Extraction runs across many documents produce the same real-world thing
 * under several surface forms ("transport sector" / "Transport and
 * Logistics" / "the Transport sector"). This pass applies the current
 * canonicalName rules to every stored entity, then merges rows that collapse
 * to the same (type, name): edges are repointed, document links are merged
 * with summed mentions, aliases are unioned, and the survivor keeps the
 * richest metadata.
 *
 * Safe to re-run. Use --dry to preview.
 *
 * Usage: pnpm exec tsx scripts/dedupe-graph.ts [--tenant careercraft] [--dry]
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

interface EntityRow {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  metadata: unknown;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const slug = arg('--tenant') ?? 'careercraft';

  const { canonicalName, isEdgeTypeValid } = await import(
    pathToFileURL(resolve(ROOT, 'packages/core/src/entities/index.ts')).href
  );
  const { prisma } = await import(pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href);

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`Tenant "${slug}" not found`);

  const entities: EntityRow[] = await prisma.entity.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { documents: true } } },
  });
  console.log(`tenant=${slug} entities=${entities.length}${dry ? ' (dry run)' : ''}`);

  // Group by canonical (type, lowercased name). First row wins as survivor —
  // it is the oldest, so its id is the one edges already point at most.
  const groups = new Map<string, EntityRow[]>();
  const renames: Array<{ id: string; from: string; to: string }> = [];

  for (const entity of entities) {
    const canonical = canonicalName(entity.name, entity.type);
    if (canonical !== entity.name) {
      renames.push({ id: entity.id, from: entity.name, to: canonical });
    }
    const key = `${entity.type}::${canonical.toLowerCase()}`;
    const group = groups.get(key);
    if (group) group.push({ ...entity, name: canonical });
    else groups.set(key, [{ ...entity, name: canonical }]);
  }

  /**
   * Drop edges whose endpoint types are semantically impossible. Extraction
   * now rejects these at write time, but anything built before that rule
   * existed still carries them — e.g. `sector --employs--> location`.
   */
  async function pruneInvalidEdges(): Promise<void> {
    const edges = await prisma.relationship.findMany({
      where: { tenantId: tenant!.id },
      include: {
        fromEntity: { select: { type: true, name: true } },
        toEntity: { select: { type: true, name: true } },
      },
    });
    const samples: string[] = [];
    let pruned = 0;
    for (const edge of edges) {
      if (isEdgeTypeValid(edge.type, edge.fromEntity.type, edge.toEntity.type)) continue;
      if (samples.length < 8) {
        samples.push(
          `${edge.fromEntity.name} [${edge.fromEntity.type}] --${edge.type}--> ${edge.toEntity.name} [${edge.toEntity.type}]`,
        );
      }
      if (!dry) await prisma.relationship.delete({ where: { id: edge.id } });
      pruned++;
    }
    const pct = edges.length ? ((pruned / edges.length) * 100).toFixed(1) : '0';
    console.log(
      `\ninvalid-type edges ${dry ? 'found' : 'pruned'}: ${pruned} of ${edges.length} (${pct}%)`,
    );
    for (const s of samples) console.log(`   ✗ ${s}`);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(
    `  ${renames.length} names re-canonicalised, ${duplicateGroups.length} duplicate groups (${duplicateGroups.reduce((n, g) => n + g.length - 1, 0)} rows to merge)`,
  );

  for (const group of duplicateGroups.slice(0, 15)) {
    console.log(`   · ${group[0]!.type}: ${group.map((g) => `"${g.name}"`).join(' + ')}`);
  }
  // Edge pruning runs in dry mode too — it reports without deleting, and it's
  // the pass most worth previewing before it touches anything.
  await pruneInvalidEdges();

  if (dry) {
    await prisma.$disconnect();
    return;
  }

  let merged = 0;
  let edgesRepointed = 0;
  let edgesDropped = 0;

  for (const group of duplicateGroups) {
    const [survivor, ...losers] = group as [EntityRow, ...EntityRow[]];
    const aliases = new Set(survivor.aliases);
    let metadata = { ...(survivor.metadata as Record<string, unknown>) };

    for (const loser of losers) {
      for (const alias of loser.aliases) aliases.add(alias);
      // Original surface form is useful provenance — keep it as an alias.
      if (loser.name !== survivor.name) aliases.add(loser.name);
      const loserMeta = loser.metadata as Record<string, unknown>;
      if (loserMeta?.attributes && !metadata.attributes) metadata = { ...metadata, ...loserMeta };

      // Repoint edges; a repoint that would collide with an existing edge or
      // create a self-loop is dropped instead.
      for (const [field, other] of [
        ['fromEntityId', 'toEntityId'],
        ['toEntityId', 'fromEntityId'],
      ] as const) {
        const rels = await prisma.relationship.findMany({ where: { [field]: loser.id } });
        for (const rel of rels) {
          const otherId = (rel as unknown as Record<string, string>)[other]!;
          if (otherId === survivor.id) {
            await prisma.relationship.delete({ where: { id: rel.id } });
            edgesDropped++;
            continue;
          }
          const clash = await prisma.relationship.findFirst({
            where: {
              tenantId: tenant.id,
              type: rel.type,
              fromEntityId: field === 'fromEntityId' ? survivor.id : otherId,
              toEntityId: field === 'toEntityId' ? survivor.id : otherId,
            },
          });
          if (clash) {
            await prisma.relationship.delete({ where: { id: rel.id } });
            edgesDropped++;
          } else {
            await prisma.relationship.update({
              where: { id: rel.id },
              data: { [field]: survivor.id },
            });
            edgesRepointed++;
          }
        }
      }

      // Merge document links (sum mentions, union pages).
      const links = await prisma.documentEntity.findMany({ where: { entityId: loser.id } });
      for (const link of links) {
        const existing = await prisma.documentEntity.findUnique({
          where: { documentId_entityId: { documentId: link.documentId, entityId: survivor.id } },
        });
        if (existing) {
          await prisma.documentEntity.update({
            where: { id: existing.id },
            data: {
              mentions: existing.mentions + link.mentions,
              pages: [...new Set([...existing.pages, ...link.pages])].slice(0, 50),
            },
          });
          await prisma.documentEntity.delete({ where: { id: link.id } });
        } else {
          await prisma.documentEntity.update({
            where: { id: link.id },
            data: { entityId: survivor.id },
          });
        }
      }

      await prisma.entity.delete({ where: { id: loser.id } });
      merged++;
    }

    await prisma.entity.update({
      where: { id: survivor.id },
      data: { name: survivor.name, aliases: [...aliases].slice(0, 8), metadata },
    });
  }

  // Rename survivors that were not part of a duplicate group.
  let renamed = 0;
  for (const group of [...groups.values()].filter((g) => g.length === 1)) {
    const entity = group[0]!;
    const original = entities.find((e) => e.id === entity.id)!;
    if (original.name !== entity.name) {
      await prisma.entity.update({ where: { id: entity.id }, data: { name: entity.name } });
      renamed++;
    }
  }

  const [entityCount, relCount] = await Promise.all([
    prisma.entity.count({ where: { tenantId: tenant.id } }),
    prisma.relationship.count({ where: { tenantId: tenant.id } }),
  ]);
  console.log(
    `\ndone: ${merged} entities merged, ${renamed} renamed, ${edgesRepointed} edges repointed, ${edgesDropped} redundant edges dropped`,
  );
  console.log(`graph now ${entityCount} entities / ${relCount} relationships`);
  await prisma.$disconnect();
}

void main();
