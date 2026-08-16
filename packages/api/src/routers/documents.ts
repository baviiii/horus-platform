import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';
import { UploadMetadataSchema } from '@horus/core/documents';

export const documentsRouter = router({
  list: scopedProcedure('documents:read')
    .input(
      z.object({
        status: z.enum(['PENDING', 'PROCESSING', 'INDEXED', 'FAILED', 'ARCHIVED']).optional(),
        category: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.document.findMany({
        where: {
          ...(input.status && { status: input.status }),
          ...(input.category && { category: input.category }),
        },
        take: input.limit,
        ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
      });
    }),

  get: scopedProcedure('documents:read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUnique({ where: { id: input.id } });
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });
      return doc;
    }),

  requestUpload: scopedProcedure('documents:write')
    .input(UploadMetadataSchema)
    .mutation(async () => {
      // Returns a signed Azure Blob upload URL + creates a PENDING document row.
      // Implementation lands in Phase 1.
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'documents.requestUpload — Phase 1',
      });
    }),

  delete: scopedProcedure('documents:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.document.update({
        where: { id: input.id },
        data: { status: 'ARCHIVED' },
      });
      return { archived: true };
    }),
});
