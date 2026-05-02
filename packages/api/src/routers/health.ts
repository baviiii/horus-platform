import { router, publicProcedure } from '../trpc.js';

export const healthRouter = router({
  ping: publicProcedure.query(({ ctx }) => ({
    ok: true,
    tenant: ctx.tenant?.slug ?? null,
    user: ctx.user?.id ?? null,
    apiKey: ctx.apiKey ? ctx.apiKey.keyPrefix : null,
    timestamp: new Date().toISOString(),
  })),
});
