import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@horus/db';
import { router, scopedProcedure } from '../trpc.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

const agentShape = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['CHAT', 'VOICE', 'HYBRID']).default('CHAT'),
  persona: z.string().max(8000).optional(),
  collectionIds: z.array(z.string().uuid()).max(20).default([]),
  toolSlugs: z.array(z.string().max(60)).max(20).default([]),
});

/**
 * Agents — chat and voice surfaces a tenant exposes to their staff or their
 * customers. An agent is grounded in one or more knowledge collections and
 * may carry MCP tool connections. Voice is configuration-only until a voice
 * provider connection is wired in (see `voiceConfig`).
 */
export const agentsRouter = router({
  list: scopedProcedure('documents:read').query(async ({ ctx }) => {
    return ctx.db.agent.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { updatedAt: 'desc' },
    });
  }),

  get: scopedProcedure('documents:read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.agent.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  create: scopedProcedure('documents:write')
    .input(agentShape)
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.name);
      const existing = await ctx.db.agent.findUnique({
        where: { tenantId_slug: { tenantId: ctx.tenant.id, slug } },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `An agent named "${input.name}" already exists.`,
        });
      }
      if (input.collectionIds.length > 0) {
        const count = await ctx.db.knowledgeCollection.count({
          where: { tenantId: ctx.tenant.id, id: { in: input.collectionIds } },
        });
        if (count !== input.collectionIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more collections do not belong to this tenant.',
          });
        }
      }
      return ctx.db.agent.create({
        data: {
          tenantId: ctx.tenant.id,
          name: input.name,
          slug,
          kind: input.kind,
          persona: input.persona,
          collectionIds: input.collectionIds,
          toolSlugs: input.toolSlugs,
          status: 'DRAFT',
          createdById: ctx.user?.id ?? '00000000-0000-0000-0000-000000000000',
        },
      });
    }),

  update: scopedProcedure('documents:write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
        persona: z.string().max(8000).nullable().optional(),
        collectionIds: z.array(z.string().uuid()).max(20).optional(),
        toolSlugs: z.array(z.string().max(60)).max(20).optional(),
        voiceConfig: z.record(z.unknown()).optional(),
        embedConfig: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.agent.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.agent.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.persona !== undefined && { persona: input.persona }),
          ...(input.collectionIds !== undefined && { collectionIds: input.collectionIds }),
          ...(input.toolSlugs !== undefined && { toolSlugs: input.toolSlugs }),
          ...(input.voiceConfig !== undefined && {
            voiceConfig: input.voiceConfig as Prisma.InputJsonValue,
          }),
          ...(input.embedConfig !== undefined && {
            embedConfig: input.embedConfig as Prisma.InputJsonValue,
          }),
        },
      });
    }),

  delete: scopedProcedure('documents:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.agent.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.db.agent.delete({ where: { id: input.id } });
      return { deleted: true };
    }),
});
