import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';
import { EntityTypeSchema, RelationshipTypeSchema } from '@horus/core/graph';

export const graphRouter = router({
  query: scopedProcedure('graph:read')
    .input(
      z.object({
        entity: z.string().min(1),
        relationshipType: RelationshipTypeSchema.optional(),
        depth: z.number().int().min(1).max(5).default(1),
      }),
    )
    .query(async () => {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'graph.query — Phase 2' });
    }),

  entities: scopedProcedure('graph:read')
    .input(
      z.object({
        type: EntityTypeSchema.optional(),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.entity.findMany({
        where: { ...(input.type && { type: input.type }) },
        take: input.limit,
        ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
      });
    }),

  traverse: scopedProcedure('graph:read')
    .input(z.object({ entityId: z.string().uuid(), depth: z.number().int().min(1).max(5) }))
    .query(async () => {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'graph.traverse — Phase 2' });
    }),
});
