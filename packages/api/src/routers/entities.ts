import { z } from 'zod';
import { router, scopedProcedure } from '../trpc.js';
import { EntityTypeSchema } from '@horus/core/graph';

export const entitiesRouter = router({
  list: scopedProcedure('entities:read')
    .input(
      z.object({
        type: EntityTypeSchema.optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.entity.findMany({
        where: {
          ...(input.type && { type: input.type }),
          ...(input.search && { name: { contains: input.search, mode: 'insensitive' } }),
        },
        take: input.limit,
        orderBy: { name: 'asc' },
      });
    }),

  relationships: scopedProcedure('entities:read')
    .input(z.object({ entityId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [outgoing, incoming] = await Promise.all([
        ctx.db.relationship.findMany({
          where: { fromEntityId: input.entityId },
          include: { toEntity: true },
        }),
        ctx.db.relationship.findMany({
          where: { toEntityId: input.entityId },
          include: { fromEntity: true },
        }),
      ]);
      return { outgoing, incoming };
    }),
});
