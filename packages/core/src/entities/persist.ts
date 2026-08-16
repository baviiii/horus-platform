/**
 * Graph persistence — validated extractions → Postgres rows.
 *
 * Postgres is the canonical graph store (Entity / Relationship /
 * DocumentEntity, tenant-scoped with RLS). Upserts converge: the same entity
 * seen across documents becomes one node with merged aliases and summed
 * mentions; the same edge seen twice keeps its best confidence and a few
 * evidence samples. Cosmos Gremlin stays out of the stack until a tenant's
 * graph outgrows relational reach.
 */
import type { PrismaClient } from '@horus/db';
import type { ExtractedEntity, ExtractedRelationship } from './extract.js';

export interface PersistParams {
  db: PrismaClient;
  tenantId: string;
  documentId: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  /** Chunk indexes this batch came from — recorded on DocumentEntity.pages. */
  chunkIxs: number[];
}

export interface PersistResult {
  entitiesUpserted: number;
  relationshipsUpserted: number;
}

const MAX_ALIASES = 8;
const MAX_EVIDENCE = 3;
const MAX_PAGES = 50;

export async function persistGraph(params: PersistParams): Promise<PersistResult> {
  const { db, tenantId, documentId } = params;
  const idByKey = new Map<string, string>();

  let entitiesUpserted = 0;
  for (const entity of params.entities) {
    const key = `${entity.type}:${entity.name.toLowerCase()}`;
    if (idByKey.has(key)) continue;

    // Case-insensitive convergence: reuse an existing row whose name matches
    // ignoring case, instead of creating a duplicate cased variant.
    const existing = await db.entity.findFirst({
      where: { tenantId, type: entity.type, name: { equals: entity.name, mode: 'insensitive' } },
    });

    if (existing) {
      const aliases = new Set(existing.aliases);
      for (const alias of entity.aliases ?? []) aliases.add(alias);
      const metadata = {
        ...(existing.metadata as Record<string, unknown>),
        ...(entity.attributes && { attributes: entity.attributes }),
      };
      await db.entity.update({
        where: { id: existing.id },
        data: { aliases: [...aliases].slice(0, MAX_ALIASES), metadata },
      });
      idByKey.set(key, existing.id);
    } else {
      const created = await db.entity.create({
        data: {
          tenantId,
          name: entity.name,
          type: entity.type,
          aliases: (entity.aliases ?? []).slice(0, MAX_ALIASES),
          metadata: entity.attributes ? { attributes: entity.attributes } : {},
        },
      });
      idByKey.set(key, created.id);
    }
    entitiesUpserted++;

    // Link entity ↔ document with mention counting.
    const entityId = idByKey.get(key)!;
    const link = await db.documentEntity.findUnique({
      where: { documentId_entityId: { documentId, entityId } },
    });
    if (link) {
      const pages = new Set(link.pages);
      for (const ix of params.chunkIxs) pages.add(ix);
      await db.documentEntity.update({
        where: { id: link.id },
        data: { mentions: link.mentions + 1, pages: [...pages].slice(0, MAX_PAGES) },
      });
    } else {
      await db.documentEntity.create({
        data: {
          tenantId,
          documentId,
          entityId,
          mentions: 1,
          pages: params.chunkIxs.slice(0, MAX_PAGES),
        },
      });
    }
  }

  let relationshipsUpserted = 0;
  for (const rel of params.relationships) {
    const fromId = idByKey.get(`${rel.from_type}:${rel.from.toLowerCase()}`);
    const toId = idByKey.get(`${rel.to_type}:${rel.to.toLowerCase()}`);
    if (!fromId || !toId || fromId === toId) continue;

    const existing = await db.relationship.findUnique({
      where: {
        tenantId_fromEntityId_toEntityId_type: {
          tenantId,
          fromEntityId: fromId,
          toEntityId: toId,
          type: rel.type,
        },
      },
    });
    if (existing) {
      const meta = existing.metadata as { evidence?: string[] };
      const evidence = [...(meta.evidence ?? [])];
      if (evidence.length < MAX_EVIDENCE && rel.evidence) evidence.push(rel.evidence);
      await db.relationship.update({
        where: { id: existing.id },
        data: {
          confidence: Math.max(existing.confidence, rel.confidence),
          metadata: { ...meta, evidence },
        },
      });
    } else {
      await db.relationship.create({
        data: {
          tenantId,
          fromEntityId: fromId,
          toEntityId: toId,
          type: rel.type,
          confidence: rel.confidence,
          metadata: { evidence: rel.evidence ? [rel.evidence] : [] },
        },
      });
    }
    relationshipsUpserted++;
  }

  return { entitiesUpserted, relationshipsUpserted };
}
