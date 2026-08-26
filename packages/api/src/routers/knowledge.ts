import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, scopedProcedure } from '../trpc.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

/**
 * Knowledge collections — named silos inside a tenant's corpus. Staff group
 * documents into collections; agents and voice surfaces bind to one or more
 * collections to stay scoped to "their" knowledge.
 */
export const knowledgeRouter = router({
  list: scopedProcedure('documents:read').query(async ({ ctx }) => {
    return ctx.db.knowledgeCollection.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { documents: true } } },
    });
  }),

  get: scopedProcedure('documents:read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.knowledgeCollection.findUnique({
        where: { id: input.id },
        include: {
          _count: { select: { documents: true } },
          documents: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              title: true,
              status: true,
              chunksCount: true,
              createdAt: true,
            },
          },
        },
      });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  create: scopedProcedure('documents:write')
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        category: z.string().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.name);
      const existing = await ctx.db.knowledgeCollection.findUnique({
        where: { tenantId_slug: { tenantId: ctx.tenant.id, slug } },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A collection named "${input.name}" already exists.`,
        });
      }
      return ctx.db.knowledgeCollection.create({
        data: {
          tenantId: ctx.tenant.id,
          name: input.name,
          slug,
          description: input.description,
          category: input.category,
          partition: slug,
        },
      });
    }),

  update: scopedProcedure('documents:write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).optional(),
        category: z.string().max(60).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.knowledgeCollection.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.db.knowledgeCollection.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.category !== undefined && { category: input.category }),
        },
      });
    }),

  delete: scopedProcedure('documents:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.knowledgeCollection.findUnique({ where: { id: input.id } });
      if (!row || row.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      // Documents keep their collectionId as NULL (SetNull on the relation).
      await ctx.db.knowledgeCollection.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  /** Assign a document to a collection (or clear it with null). */
  assignDocument: scopedProcedure('documents:write')
    .input(
      z.object({
        documentId: z.string().uuid(),
        collectionId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.document.findUnique({ where: { id: input.documentId } });
      if (!doc || doc.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.collectionId) {
        const coll = await ctx.db.knowledgeCollection.findUnique({
          where: { id: input.collectionId },
        });
        if (!coll || coll.tenantId !== ctx.tenant.id) throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return ctx.db.document.update({
        where: { id: input.documentId },
        data: { collectionId: input.collectionId },
      });
    }),
});
