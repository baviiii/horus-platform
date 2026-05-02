import { TRPCError } from '@trpc/server';
import { router, userProcedure } from '../trpc.js';

export const billingRouter = router({
  portalLink: userProcedure.mutation(async () => {
    throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: 'billing.portalLink — Phase 4' });
  }),

  currentPlan: userProcedure.query(({ ctx }) => ({
    plan: ctx.tenant.plan,
    config: (ctx.tenant.config as { limits?: Record<string, number> }).limits ?? {},
  })),
});
