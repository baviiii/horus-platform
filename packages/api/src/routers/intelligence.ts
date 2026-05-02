import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';

export const intelligenceRouter = router({
  contradictions: scopedProcedure('rag:read')
    .input(z.object({ documentIds: z.array(z.string().uuid()).min(2).max(10) }))
    .query(async () => {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'intelligence.contradictions — Phase 2',
      });
    }),

  // Module-driven intelligence endpoints get registered here by enabled modules.
  // See packages/modules/<name>/intelligence.ts
});
