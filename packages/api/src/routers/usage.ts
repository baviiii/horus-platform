import { z } from 'zod';
import { router, scopedProcedure } from '../trpc.js';

/**
 * Tenant usage view — aggregates over usage_records so a customer can see
 * what they've consumed (RAG queries, tokens, documents) without touching
 * billing internals. Read-only; billing stays in the admin/billing router.
 */
export const usageRouter = router({
  summary: scopedProcedure('documents:read')
    .input(
      z
        .object({
          days: z.number().int().min(1).max(365).default(30),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000);

      const records = await ctx.db.usageRecord.groupBy({
        by: ['meter'],
        where: { tenantId: ctx.tenant.id, occurredAt: { gte: since } },
        _sum: { quantity: true },
        _count: true,
      });

      const [documents, sessions, members] = await Promise.all([
        ctx.db.document.count({ where: { tenantId: ctx.tenant.id } }),
        ctx.db.chatSession.count({ where: { tenantId: ctx.tenant.id, createdAt: { gte: since } } }),
        ctx.db.tenantMember.count({ where: { tenantId: ctx.tenant.id } }),
      ]);

      return {
        windowDays: days,
        since: since.toISOString(),
        meters: records.map((r) => ({
          meter: r.meter,
          total: r._sum.quantity !== null ? Number(r._sum.quantity) : 0,
          events: r._count,
        })),
        totals: { documents, sessions, members },
      };
    }),

  recent: scopedProcedure('documents:read')
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.usageRecord.findMany({
        where: { tenantId: ctx.tenant.id },
        orderBy: { occurredAt: 'desc' },
        take: input.limit,
      });
      return rows.map((r) => ({
        id: r.id,
        meter: r.meter,
        quantity: Number(r.quantity),
        occurredAt: r.occurredAt.toISOString(),
        metadata: r.metadata,
      }));
    }),
});
