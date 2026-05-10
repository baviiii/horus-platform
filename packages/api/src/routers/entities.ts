import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';
import { EntityTypeSchema } from '@horus/core/graph';

// Entities and relationships live in Cosmos Gremlin. Postgres no longer
// mirrors them. These procedures will be wired to the graph backend in
// `@horus/core/graph` once the Gremlin client is in.
export const entitiesRouter = router({
  list: scopedProcedure('entities:read')
    .input(
      z.object({
        type: EntityTypeSchema.optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'entities.list — Cosmos Gremlin backend (Phase 2)',
      });
    }),

  relationships: scopedProcedure('entities:read')
    .input(z.object({ entityId: z.string().uuid() }))
    .query(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'entities.relationships — Cosmos Gremlin backend (Phase 2)',
      });
    }),
});
