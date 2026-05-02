import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';
import { RagQueryInputSchema } from '@horus/core/rag';

export const ragRouter = router({
  query: scopedProcedure('rag:read')
    .input(RagQueryInputSchema)
    .mutation(async () => {
      // Implementation port from azure-functions/rag-metadata + supabase/functions/rag-query
      // lands in Phase 1.
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'rag.query — Phase 1' });
    }),

  chat: scopedProcedure('rag:read')
    .input(
      z.object({
        sessionId: z.string().uuid().optional(),
        message: z.string().min(1).max(8000),
        context: z.string().max(100).optional(),
      }),
    )
    .mutation(async () => {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'rag.chat — Phase 1' });
    }),

  metadata: scopedProcedure('rag:read')
    .input(
      z.object({
        operation: z.enum(['stats', 'documents', 'categories', 'search']),
      }),
    )
    .query(async () => {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'rag.metadata — Phase 1' });
    }),
});
