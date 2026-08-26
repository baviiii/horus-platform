import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@horus/db';
import { router, scopedProcedure } from '../trpc.js';

const triggerEnum = z.enum(['DOCUMENT_INDEXED', 'CHAT_SESSION_ENDED', 'SCHEDULE', 'WEBHOOK']);

/**
 * Automations — trigger → action rules inside a tenant. Phase 1 is the
 * registry + on/off control: rows are created and toggled here; execution is
 * the responsibility of a worker that polls ACTIVE automations (not yet
 * scheduled). The shape of `action` is kept open ({ kind, config }) so new
 * action types don't need a migration.
 */
export const automationsRouter = router({
  list: scopedProcedure('documents:read').query(async ({ ctx }) => {
    return ctx.db.automation.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { updatedAt: 'desc' },
    });
  }),

  get: scopedProcedure('documents:read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.automation.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  create: scopedProcedure('documents:write')
    .input(
      z.object({
        name: z.string().min(1).max(160),
        description: z.string().max(2000).optional(),
        trigger: triggerEnum,
        triggerConfig: z.record(z.unknown()).default({}),
        action: z.object({
          kind: z.enum(['webhook', 'alert', 'email', 'infer']),
          config: z.record(z.unknown()).default({}),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.automation.create({
        data: {
          tenantId: ctx.tenant.id,
          name: input.name,
          description: input.description,
          trigger: input.trigger,
          triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
          action: input.action as unknown as Prisma.InputJsonValue,
          status: 'DRAFT',
        },
      });
    }),

  setStatus: scopedProcedure('documents:write')
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.automation.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.automation.update({
        where: { id: input.id },
        data: { status: input.status },
      });
    }),

  update: scopedProcedure('documents:write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(160).optional(),
        description: z.string().max(2000).nullable().optional(),
        triggerConfig: z.record(z.unknown()).optional(),
        action: z
          .object({
            kind: z.enum(['webhook', 'alert', 'email', 'infer']),
            config: z.record(z.unknown()).default({}),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.automation.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.automation.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.triggerConfig !== undefined && {
            triggerConfig: input.triggerConfig as Prisma.InputJsonValue,
          }),
          ...(input.action !== undefined && {
            action: input.action as unknown as Prisma.InputJsonValue,
          }),
        },
      });
    }),

  delete: scopedProcedure('documents:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.automation.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.automation.delete({ where: { id: input.id } });
      return { deleted: true };
    }),
});
