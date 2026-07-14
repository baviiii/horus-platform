import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { checkMcpHealth, listMcpTools, type McpServerRef } from '@horus/core/mcp';
import { router, scopedProcedure } from '../trpc.js';

/**
 * Tenant integrations registry — what this workspace is connected to.
 *
 * MCP connections are probed live on add/test: Horus connects as an MCP
 * client, lists the server's tools, and caches them so agents (and the
 * dashboard) know what capabilities the connection brings.
 */

const SlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,31}$/, 'slug must be [a-z][a-z0-9_]{1,31} (tool namespace)');

function toServerRef(conn: {
  slug: string;
  endpoint: string;
  authType: string;
  secretRef: string | null;
}): McpServerRef {
  const headers: Record<string, string> = {};
  if (conn.authType === 'bearer' && conn.secretRef) {
    const secret = process.env[conn.secretRef];
    if (secret) headers.Authorization = `Bearer ${secret}`;
  }
  return { label: conn.slug, url: conn.endpoint, headers };
}

async function probeMcp(ref: McpServerRef) {
  const health = await checkMcpHealth(ref);
  const tools = health.ok
    ? (await listMcpTools(ref)).map((t) => ({ name: t.name, description: t.description }))
    : [];
  return {
    status: health.ok ? ('CONNECTED' as const) : ('ERROR' as const),
    toolCount: health.toolCount,
    tools,
    lastError: health.error ?? null,
    lastCheckedAt: new Date(),
  };
}

export const connectionsRouter = router({
  list: scopedProcedure('connections:read')
    .input(z.object({ kind: z.enum(['MCP', 'API']).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      return ctx.db.connection.findMany({
        where: { ...(input.kind && { kind: input.kind }) },
        orderBy: { createdAt: 'asc' },
      });
    }),

  add: scopedProcedure('connections:write')
    .input(
      z.object({
        kind: z.enum(['MCP', 'API']).default('MCP'),
        slug: SlugSchema,
        name: z.string().min(1).max(80),
        endpoint: z.string().url().max(1024),
        authType: z.enum(['none', 'bearer']).default('none'),
        secretRef: z.string().max(128).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const probe =
        input.kind === 'MCP'
          ? await probeMcp(toServerRef({ ...input, secretRef: input.secretRef ?? null }))
          : {
              status: 'CONNECTED' as const,
              toolCount: 0,
              tools: [],
              lastError: null,
              lastCheckedAt: new Date(),
            };

      return ctx.db.connection.create({
        data: {
          tenantId: ctx.tenant.id,
          kind: input.kind,
          slug: input.slug,
          name: input.name,
          endpoint: input.endpoint,
          authType: input.authType,
          secretRef: input.secretRef,
          ...probe,
        },
      });
    }),

  test: scopedProcedure('connections:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conn = await ctx.db.connection.findUnique({ where: { id: input.id } });
      if (!conn) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
      if (conn.kind !== 'MCP') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only MCP connections are testable' });
      }
      const probe = await probeMcp(toServerRef(conn));
      return ctx.db.connection.update({ where: { id: conn.id }, data: probe });
    }),

  remove: scopedProcedure('connections:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.connection.delete({ where: { id: input.id } });
      return { deleted: true };
    }),
});
