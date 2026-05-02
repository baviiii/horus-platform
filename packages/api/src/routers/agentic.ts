import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';
import { QueryPlanSchema } from '@horus/core/agentic';

export const agenticRouter = router({
  plan: scopedProcedure('agentic:read')
    .input(z.object({ query: z.string().min(1).max(4000) }))
    .mutation(async () => {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'agentic.plan — Phase 2' });
    }),

  execute: scopedProcedure('agentic:read')
    .input(QueryPlanSchema)
    .mutation(async () => {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'agentic.execute — Phase 2' });
    }),
});
