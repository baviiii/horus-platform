import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, userProcedure, tenantProcedure } from '../trpc.js';

export const tenantRouter = router({
  current: tenantProcedure.query(({ ctx }) => ({
    id: ctx.tenant.id,
    slug: ctx.tenant.slug,
    name: ctx.tenant.name,
    plan: ctx.tenant.plan,
    config: ctx.tenant.config,
  })),

  members: userProcedure.query(async ({ ctx }) => {
    return ctx.db.tenantMember.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { joinedAt: 'asc' },
    });
  }),

  updateBranding: userProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        logoUrl: z.string().url().optional(),
        primaryColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        fontFamily: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'OWNER' && ctx.user.role !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Owner or admin required' });
      }
      const config = (ctx.tenant.config as Record<string, unknown>) ?? {};
      const branding = (config.branding as Record<string, unknown>) ?? {};
      return ctx.prisma.tenant.update({
        where: { id: ctx.tenant.id },
        data: { config: { ...config, branding: { ...branding, ...input } } },
      });
    }),
});
