/**
 * Occupation and sector profiles.
 *
 * These compose what CareerCraft actually renders: for a job — the skills it
 * needs, the qualifications that lead to it, who employs it, and the documents
 * that say so. Everything is read from the graph and attributed to a source
 * document, because a career recommendation with no provenance is an opinion.
 */
import type { PrismaClient } from '@horus/db';
import { resolveEntity, findVariants, type ResolvedEntity } from './resolve.js';

export interface LinkedEntity {
  name: string;
  type: string;
  /** Verbatim sentence the extractor took this edge from, when recorded. */
  evidence?: string;
  confidence: number;
}

export interface SourceDocument {
  id: string;
  title: string;
  category: string | null;
  mentions: number;
}

export interface OccupationProfile {
  occupation: { name: string; aliases: string[]; matchedBy: string };
  /** Other graph nodes merged into this profile (unresolved name variants). */
  mergedVariants: string[];
  skills: LinkedEntity[];
  qualifications: LinkedEntity[];
  employedBy: LinkedEntity[];
  relatedPrograms: LinkedEntity[];
  documents: SourceDocument[];
  /** Honest signal of how much the corpus actually supports this profile. */
  coverage: 'strong' | 'partial' | 'thin';
}

export interface SectorProfile {
  sector: { name: string; aliases: string[]; matchedBy: string };
  occupations: LinkedEntity[];
  funding: Array<LinkedEntity & { amountAud?: number; period?: string }>;
  programs: LinkedEntity[];
  documents: SourceDocument[];
  coverage: 'strong' | 'partial' | 'thin';
}

const evidenceOf = (metadata: unknown): string | undefined =>
  (metadata as { evidence?: string[] } | null)?.evidence?.[0];

function coverageOf(edges: number, docs: number): 'strong' | 'partial' | 'thin' {
  if (edges >= 8 && docs >= 3) return 'strong';
  if (edges >= 3) return 'partial';
  return 'thin';
}

/** Edges out of a set of entity ids, grouped by relationship type. */
async function outgoing(
  db: PrismaClient,
  entityIds: string[],
  types: string[],
  targetTypes?: string[],
): Promise<LinkedEntity[]> {
  const rows = await db.relationship.findMany({
    where: {
      fromEntityId: { in: entityIds },
      type: { in: types },
      ...(targetTypes && { toEntity: { type: { in: targetTypes } } }),
    },
    include: { toEntity: { select: { name: true, type: true } } },
    orderBy: { confidence: 'desc' },
    take: 40,
  });
  return dedupeByName(
    rows.map((r) => ({
      name: r.toEntity.name,
      type: r.toEntity.type,
      evidence: evidenceOf(r.metadata),
      confidence: r.confidence,
    })),
  );
}

async function incoming(
  db: PrismaClient,
  entityIds: string[],
  types: string[],
  sourceTypes?: string[],
): Promise<LinkedEntity[]> {
  const rows = await db.relationship.findMany({
    where: {
      toEntityId: { in: entityIds },
      type: { in: types },
      ...(sourceTypes && { fromEntity: { type: { in: sourceTypes } } }),
    },
    include: { fromEntity: { select: { name: true, type: true } } },
    orderBy: { confidence: 'desc' },
    take: 40,
  });
  return dedupeByName(
    rows.map((r) => ({
      name: r.fromEntity.name,
      type: r.fromEntity.type,
      evidence: evidenceOf(r.metadata),
      confidence: r.confidence,
    })),
  );
}

/** Same name via several edges is one fact, not several. */
function dedupeByName(items: LinkedEntity[]): LinkedEntity[] {
  const seen = new Map<string, LinkedEntity>();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const existing = seen.get(key);
    if (!existing || item.confidence > existing.confidence) seen.set(key, item);
  }
  return [...seen.values()];
}

async function documentsFor(db: PrismaClient, entityIds: string[]): Promise<SourceDocument[]> {
  const links = await db.documentEntity.findMany({
    where: { entityId: { in: entityIds } },
    include: { document: { select: { id: true, title: true, category: true } } },
    orderBy: { mentions: 'desc' },
    take: 20,
  });
  const byDoc = new Map<string, SourceDocument>();
  for (const link of links) {
    const existing = byDoc.get(link.document.id);
    if (existing) existing.mentions += link.mentions;
    else
      byDoc.set(link.document.id, {
        id: link.document.id,
        title: link.document.title,
        category: link.document.category,
        mentions: link.mentions,
      });
  }
  return [...byDoc.values()].sort((a, b) => b.mentions - a.mentions);
}

export async function occupationProfile(
  db: PrismaClient,
  name: string,
): Promise<OccupationProfile | null> {
  const resolved = await resolveEntity(db, name, ['occupation']);
  if (!resolved) return null;

  // Merge unresolved name variants so a profile isn't split across
  // "AI Specialist" and "Artificial Intelligence Specialist".
  const variants = await findVariants(db, resolved);
  const ids = [resolved.id, ...variants.map((v) => v.id)];

  const [skills, qualifications, employedBy, relatedPrograms, documents] = await Promise.all([
    outgoing(db, ids, ['requires'], ['skill']),
    outgoing(db, ids, ['requires', 'leads_to'], ['qualification']).then(async (direct) => {
      // Qualifications usually point AT an occupation, not away from it.
      const reverse = await incoming(db, ids, ['leads_to'], ['qualification']);
      return dedupeByName([...direct, ...reverse]);
    }),
    incoming(db, ids, ['employs'], ['sector', 'organization', 'program']),
    incoming(db, ids, ['supports', 'targets'], ['program', 'policy']),
    documentsFor(db, ids),
  ]);

  const edgeTotal =
    skills.length + qualifications.length + employedBy.length + relatedPrograms.length;

  return {
    occupation: { name: resolved.name, aliases: resolved.aliases, matchedBy: resolved.matchedBy },
    mergedVariants: variants.map((v) => v.name),
    skills,
    qualifications,
    employedBy,
    relatedPrograms,
    documents,
    coverage: coverageOf(edgeTotal, documents.length),
  };
}

export async function sectorProfile(db: PrismaClient, name: string): Promise<SectorProfile | null> {
  const resolved = await resolveEntity(db, name, ['sector']);
  if (!resolved) return null;
  const variants = await findVariants(db, resolved);
  const ids = [resolved.id, ...variants.map((v) => v.id)];

  const [occupations, programs, documents, fundingRows] = await Promise.all([
    outgoing(db, ids, ['employs'], ['occupation']),
    outgoing(db, ids, ['supports', 'part_of'], ['program', 'policy']),
    documentsFor(db, ids),
    db.relationship.findMany({
      where: { toEntityId: { in: ids }, type: 'funds' },
      include: { fromEntity: { select: { name: true, type: true, metadata: true } } },
      orderBy: { confidence: 'desc' },
      take: 20,
    }),
  ]);

  const funding = fundingRows.map((r) => {
    const attrs = (r.fromEntity.metadata as { attributes?: Record<string, unknown> } | null)
      ?.attributes;
    return {
      name: r.fromEntity.name,
      type: r.fromEntity.type,
      evidence: evidenceOf(r.metadata),
      confidence: r.confidence,
      ...(typeof attrs?.amount_aud === 'number' && { amountAud: attrs.amount_aud }),
      ...(typeof attrs?.period === 'string' && { period: attrs.period }),
    };
  });

  return {
    sector: { name: resolved.name, aliases: resolved.aliases, matchedBy: resolved.matchedBy },
    occupations,
    funding,
    programs,
    documents,
    coverage: coverageOf(occupations.length + programs.length + funding.length, documents.length),
  };
}
