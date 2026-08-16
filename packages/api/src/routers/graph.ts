import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';
import {
  EntityTypeSchema,
  RelationshipTypeSchema,
  type GraphEdge,
  type GraphNode,
} from '@horus/core/graph';
import type { Context } from '../context.js';

type Db = NonNullable<Context['db']>;

const MAX_NODES = 150;
const MAX_EDGES = 400;

/**
 * Persistence stores up to three sampled quotes per edge; the first is the
 * highest-confidence one. Same accessor the careers module uses.
 */
const evidenceOf = (metadata: unknown): string | undefined =>
  (metadata as { evidence?: string[] } | null)?.evidence?.[0];

/**
 * Iterative BFS over the Postgres graph. Depth ≤ 3 and hard node/edge caps
 * keep worst-case fan-out (hub entities like "TAFE SA") bounded.
 */
async function traverse(
  db: Db,
  startId: string,
  depth: number,
  relationshipType?: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const nodeIds = new Set<string>([startId]);
  const edges = new Map<string, GraphEdge>();
  let frontier = [startId];

  for (let d = 0; d < depth && frontier.length > 0 && nodeIds.size < MAX_NODES; d++) {
    const rels = await db.relationship.findMany({
      where: {
        OR: [{ fromEntityId: { in: frontier } }, { toEntityId: { in: frontier } }],
        ...(relationshipType && { type: relationshipType }),
      },
      orderBy: { confidence: 'desc' },
      take: MAX_EDGES,
    });

    const next: string[] = [];
    for (const rel of rels) {
      if (edges.size >= MAX_EDGES) break;
      edges.set(rel.id, {
        id: rel.id,
        fromEntityId: rel.fromEntityId,
        toEntityId: rel.toEntityId,
        type: rel.type,
        confidence: rel.confidence,
        ...(evidenceOf(rel.metadata) && { evidence: evidenceOf(rel.metadata) }),
      });
      for (const id of [rel.fromEntityId, rel.toEntityId]) {
        if (!nodeIds.has(id) && nodeIds.size < MAX_NODES) {
          nodeIds.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }

  const entities = await db.entity.findMany({
    where: { id: { in: [...nodeIds] } },
    include: { _count: { select: { documents: true } } },
  });
  const nodes = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    docCount: e._count.documents,
  }));

  // Once the node cap is reached mid-level, the loop above keeps recording
  // edges whose far endpoint never got admitted to `nodeIds`. Returning those
  // yields a subgraph that is not self-consistent: a caller resolving an
  // endpoint id against `nodes` finds nothing, and renders a dangling edge to
  // a name it cannot show. Keep only edges both of whose endpoints survived.
  const present = new Set(nodes.map((n) => n.id));
  const connected = [...edges.values()].filter(
    (e) => present.has(e.fromEntityId) && present.has(e.toEntityId),
  );

  return { nodes, edges: connected };
}

/** Name → entity resolution: exact (insensitive) → alias → contains. */
async function resolveEntity(db: Db, name: string) {
  return (
    (await db.entity.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      orderBy: { documents: { _count: 'desc' } },
    })) ??
    (await db.entity.findFirst({
      where: { aliases: { has: name } },
      orderBy: { documents: { _count: 'desc' } },
    })) ??
    (await db.entity.findFirst({
      where: { name: { contains: name, mode: 'insensitive' } },
      orderBy: { documents: { _count: 'desc' } },
    }))
  );
}

export const graphRouter = router({
  /** Name-anchored neighborhood: resolve an entity, walk its connections. */
  query: scopedProcedure('graph:read')
    .input(
      z.object({
        entity: z.string().min(1).max(120),
        relationshipType: RelationshipTypeSchema.optional(),
        depth: z.number().int().min(1).max(3).default(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const entity = await resolveEntity(ctx.db, input.entity);
      if (!entity) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `No entity matches "${input.entity}"` });
      }
      const graph = await traverse(ctx.db, entity.id, input.depth, input.relationshipType);
      return { entity: { id: entity.id, name: entity.name, type: entity.type }, ...graph };
    }),

  entities: scopedProcedure('graph:read')
    .input(
      z.object({
        type: EntityTypeSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.entity.findMany({
        where: { ...(input.type && { type: input.type }) },
        include: { _count: { select: { documents: true, outgoing: true, incoming: true } } },
        orderBy: { documents: { _count: 'desc' } },
        take: input.limit,
      });
    }),

  traverse: scopedProcedure('graph:read')
    .input(
      z.object({ entityId: z.string().uuid(), depth: z.number().int().min(1).max(3).default(2) }),
    )
    .query(async ({ ctx, input }) => {
      const entity = await ctx.db.entity.findUnique({ where: { id: input.entityId } });
      if (!entity) throw new TRPCError({ code: 'NOT_FOUND' });
      return traverse(ctx.db, input.entityId, input.depth);
    }),

  /** Graph totals + type mix — powers the dashboard graph page. */
  stats: scopedProcedure('graph:read').query(async ({ ctx }) => {
    const [entityCount, relationshipCount, byType] = await Promise.all([
      ctx.db.entity.count(),
      ctx.db.relationship.count(),
      ctx.db.entity.groupBy({ by: ['type'], _count: true }),
    ]);
    return { entityCount, relationshipCount, byType };
  }),
});
