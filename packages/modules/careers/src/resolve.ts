/**
 * Entity resolution for careers queries.
 *
 * Consumers pass human input — "nurse", "AI specialist", "defence" — not graph
 * ids. Resolution has to be forgiving without being wrong, so it escalates:
 * exact match, then alias, then contains, then a loose token overlap. Ties
 * break on document count, because the entity mentioned across more of the
 * corpus is the one the user almost certainly meant.
 */
import type { PrismaClient } from '@horus/db';
import type { EntityType } from '@horus/core/graph';

export interface ResolvedEntity {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  /** How the match was made — surfaced so callers can warn on a loose hit. */
  matchedBy: 'exact' | 'alias' | 'contains' | 'tokens';
  documentCount: number;
}

type EntityRow = {
  id: string;
  name: string;
  type: string;
  aliases: string[];
  _count: { documents: number };
};

const pick = (rows: EntityRow[], matchedBy: ResolvedEntity['matchedBy']): ResolvedEntity | null => {
  const best = rows[0];
  if (!best) return null;
  return {
    id: best.id,
    name: best.name,
    type: best.type,
    aliases: best.aliases,
    matchedBy,
    documentCount: best._count.documents,
  };
};

const include = { _count: { select: { documents: true } } } as const;
const order = [{ documents: { _count: 'desc' as const } }];

export async function resolveEntity(
  db: PrismaClient,
  name: string,
  types?: EntityType[],
): Promise<ResolvedEntity | null> {
  const term = name.trim();
  if (!term) return null;
  const typeFilter = types?.length ? { type: { in: types } } : {};

  const exact = await db.entity.findMany({
    where: { ...typeFilter, name: { equals: term, mode: 'insensitive' } },
    include,
    orderBy: order,
    take: 1,
  });
  if (exact.length) return pick(exact, 'exact');

  const alias = await db.entity.findMany({
    where: { ...typeFilter, aliases: { has: term } },
    include,
    orderBy: order,
    take: 1,
  });
  if (alias.length) return pick(alias, 'alias');

  const contains = await db.entity.findMany({
    where: { ...typeFilter, name: { contains: term, mode: 'insensitive' } },
    include,
    orderBy: order,
    take: 1,
  });
  if (contains.length) return pick(contains, 'contains');

  // Last resort: every significant word must appear somewhere in the name.
  // Catches "AI specialist" → "Artificial Intelligence Specialist" only when
  // the words genuinely overlap, rather than guessing at synonyms.
  const tokens = term.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return null;
  const tokenMatch = await db.entity.findMany({
    where: {
      ...typeFilter,
      AND: tokens.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })),
    },
    include,
    orderBy: order,
    take: 1,
  });
  return pick(tokenMatch, 'tokens');
}

/**
 * Entities that are probably the same real-world thing under different names.
 * The graph still contains variants like "AI Specialist" and "Artificial
 * Intelligence Specialist"; surfacing them lets a profile merge their edges
 * instead of showing whichever variant happened to win resolution.
 */
export async function findVariants(
  db: PrismaClient,
  entity: ResolvedEntity,
  limit = 4,
): Promise<ResolvedEntity[]> {
  // Trim a trailing plural so "Registered Nurse" still matches "Registered
  // Nurses" — the single most common variant in extracted data.
  const tokens = entity.name
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .map((t) => t.replace(/s$/i, ''));
  if (tokens.length === 0) return [];

  const rows = await db.entity.findMany({
    where: {
      type: entity.type,
      id: { not: entity.id },
      OR: [
        { aliases: { has: entity.name } },
        // EVERY significant token must appear, not any one of them. With OR,
        // "Registered Nurse" pulled in "Veterinary Nurses", "Nurserypersons"
        // and "Garden and Nursery Labourer" — merging a gardener's skills into
        // a nurse's profile. A shared word is not a shared identity.
        { AND: tokens.map((t) => ({ name: { contains: t, mode: 'insensitive' as const } })) },
      ],
    },
    include,
    orderBy: order,
    take: limit,
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    aliases: r.aliases,
    matchedBy: 'tokens' as const,
    documentCount: r._count.documents,
  }));
}
