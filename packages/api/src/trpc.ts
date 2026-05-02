import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { hasAllScopes } from '@horus/auth';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

const requireTenant = middleware(({ ctx, next }) => {
  if (!ctx.tenant || !ctx.db) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tenant context required' });
  }
  return next({ ctx: { ...ctx, tenant: ctx.tenant, db: ctx.db } });
});

export const tenantProcedure = t.procedure.use(requireTenant);

const requireUser = requireTenant.unstable_pipe(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const userProcedure = t.procedure.use(requireUser);

export function scopedProcedure(...required: string[]) {
  const scopeCheck = requireTenant.unstable_pipe(({ ctx, next }) => {
    if (!hasAllScopes(ctx.scopes, required)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing required scopes: ${required.join(', ')}`,
      });
    }
    return next();
  });
  return t.procedure.use(scopeCheck);
}

const requireSuperadmin = middleware(({ ctx, next }) => {
  if (!ctx.user || ctx.user.role !== 'OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin only' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const superadminProcedure = t.procedure.use(requireSuperadmin);

export const createCaller = t.createCallerFactory;
