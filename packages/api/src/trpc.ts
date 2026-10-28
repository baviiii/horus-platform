import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { hasAllScopes } from '@horus/auth';
import { isAiUnavailable } from '@horus/core/provider';
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

/**
 * AI switched off (HORUS_AI_PROVIDER=off) surfaces as 503, not a generic 500,
 * so SDK callers can tell "temporarily unavailable" from "broken".
 */
const mapAiUnavailable = middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && isAiUnavailable(result.error.cause)) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: result.error.cause.message,
      cause: result.error.cause,
    });
  }
  return result;
});

const baseProcedure = t.procedure.use(mapAiUnavailable);

export const publicProcedure = baseProcedure;

const requireTenant = middleware(({ ctx, next }) => {
  if (!ctx.tenant || !ctx.db) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Tenant context required' });
  }
  return next({ ctx: { ...ctx, tenant: ctx.tenant, db: ctx.db } });
});

export const tenantProcedure = baseProcedure.use(requireTenant);

const requireUser = requireTenant.unstable_pipe(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const userProcedure = baseProcedure.use(requireUser);

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
  return baseProcedure.use(scopeCheck);
}

const requireSuperadmin = middleware(({ ctx, next }) => {
  if (!ctx.user || ctx.user.role !== 'OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin only' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const superadminProcedure = baseProcedure.use(requireSuperadmin);

export const createCaller = t.createCallerFactory;
