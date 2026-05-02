import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, userProcedure } from '../trpc.js';
import { generateApiKey } from '@horus/auth';
import { ALL_SCOPES } from '@horus/auth';

const ScopeSchema = z.enum(ALL_SCOPES as readonly [string, ...string[]]);

export const adminRouter = router({
  apiKeys: router({
    list: userProcedure.query(async ({ ctx }) => {
      return ctx.db.apiKey.findMany({
        where: { revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          rateLimit: true,
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    }),

    create: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100),
          scopes: z.array(ScopeSchema).min(1),
          rateLimit: z.number().int().min(1).max(10000).default(100),
          expiresAt: z.date().optional(),
          env: z.enum(['live', 'test']).default('live'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'OWNER' && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
        const generated = await generateApiKey(input.env);
        const record = await ctx.db.apiKey.create({
          data: {
            tenantId: ctx.tenant.id,
            name: input.name,
            keyHash: generated.keyHash,
            keyPrefix: generated.publicPrefix,
            scopes: input.scopes,
            rateLimit: input.rateLimit,
            expiresAt: input.expiresAt,
            createdById: ctx.user.id,
          },
        });
        return {
          ...record,
          /** Show this ONCE on creation, never returned again. */
          plaintextKey: generated.plaintext,
        };
      }),

    revoke: userProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== 'OWNER' && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
        return ctx.db.apiKey.update({
          where: { id: input.id },
          data: { revokedAt: new Date() },
        });
      }),
  }),

  usage: userProcedure
    .input(
      z.object({
        from: z.date().optional(),
        to: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        ...(input.from && { occurredAt: { gte: input.from } }),
        ...(input.to && { occurredAt: { lte: input.to } }),
      };
      const grouped = await ctx.db.usageRecord.groupBy({
        by: ['meter'],
        where,
        _sum: { quantity: true },
      });
      return grouped.map((g) => ({ meter: g.meter, total: Number(g._sum.quantity ?? 0) }));
    }),

  auditLog: userProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
        action: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.auditLog.findMany({
        where: { ...(input.action && { action: input.action }) },
        take: input.limit,
        orderBy: { occurredAt: 'desc' },
      });
    }),
});
