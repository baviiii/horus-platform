import { z } from 'zod';
import { router, scopedProcedure } from '../trpc.js';

export const alertsRouter = router({
  list: scopedProcedure('alerts:read')
    .input(
      z.object({
        status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']).optional(),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.alert.findMany({
        where: {
          ...(input.status && { status: input.status }),
          ...(input.severity && { severity: input.severity }),
        },
        take: input.limit,
        orderBy: { createdAt: 'desc' },
      });
    }),

  acknowledge: scopedProcedure('alerts:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.alert.update({
        where: { id: input.id },
        data: { status: 'ACKNOWLEDGED' },
      });
    }),
});
