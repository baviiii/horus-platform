import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { EntityTypeSchema } from '@horus/core/graph';
import { router, scopedProcedure } from '../trpc.js';

// Postgres is the canonical graph store (Entity / Relationship /
// DocumentEntity, tenant-scoped by RLS). Rows are written by the graph
// extractor (@horus/core/entities via scripts/build-graph.ts). Cosmos
// Gremlin is deferred until a tenant's graph outgrows relational reach.
export const entitiesRouter = router({
  list: scopedProcedure('entities:read')
    .input(
      z.object({
        type: EntityTypeSchema.optional(),
        search: z.string().max(120).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.entity.findMany({
        where: {
          ...(input.type && { type: input.type }),
          ...(input.search && {
            OR: [
              { name: { contains: input.search, mode: 'insensitive' } },
              { aliases: { has: input.search } },
            ],
          }),
        },
        include: {
          _count: { select: { documents: true, outgoing: true, incoming: true } },
        },
        orderBy: { documents: { _count: 'desc' } },
        take: input.limit,
      });
    }),

  relationships: scopedProcedure('entities:read')
    .input(z.object({ entityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const entity = await ctx.db.entity.findUnique({ where: { id: input.entityId } });
      if (!entity) throw new TRPCError({ code: 'NOT_FOUND' });

      const [outgoing, incoming] = await Promise.all([
        ctx.db.relationship.findMany({
          where: { fromEntityId: entity.id },
          include: { toEntity: { select: { id: true, name: true, type: true } } },
          orderBy: { confidence: 'desc' },
          take: 100,
        }),
        ctx.db.relationship.findMany({
          where: { toEntityId: entity.id },
          include: { fromEntity: { select: { id: true, name: true, type: true } } },
          orderBy: { confidence: 'desc' },
          take: 100,
        }),
      ]);
      return { entity, outgoing, incoming };
    }),

  /** Documents an entity appears in, with mention counts. */
  documents: scopedProcedure('entities:read')
    .input(z.object({ entityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.documentEntity.findMany({
        where: { entityId: input.entityId },
        include: {
          document: { select: { id: true, title: true, category: true, createdAt: true } },
        },
        orderBy: { mentions: 'desc' },
        take: 50,
      });
    }),
});
