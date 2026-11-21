import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hasScope } from '@horus/auth';
import { blockedUrlReason } from '@horus/core/knowledge';
import {
  MarketplaceInputError,
  executeIndexAsk,
  executeIndexCategories,
  executeIndexGraphLookup,
  executeIndexSearch,
  executeMcpGatewayCall,
  getMarketplaceCatalogItem,
  isAllowedTenantSecretRef,
  isMissingMarketplaceTable,
  listInstalledMarketplaceSlugs,
  listMarketplaceCatalog,
  meetsPlan,
  resolveMarketplaceTarget,
} from '@horus/core/marketplace';
import { publicProcedure, router, scopedProcedure } from '../trpc.js';

const RESERVED_SLUGS = new Set([
  'workspace',
  'careercraft-index',
  'interview-coach',
  'admin',
  'api',
  'mcp',
  'new',
  'publish',
]);

const ListingSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$/,
    'Slug must be 4–48 lowercase letters, digits, or hyphens.',
  );

const PlanEnum = z.enum(['FREE', 'STARTER', 'PRO', 'SCALE', 'ENTERPRISE']);

function assertAdminOrOwner(user: { role: string } | null) {
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'A signed-in workspace owner or admin is required. API keys cannot publish or manage listings.',
    });
  }
}

export const marketplaceRouter = router({
  /** Public directory of published Knowledge Indexes and MCP servers. */
  catalog: publicProcedure
    .input(
      z
        .object({
          kind: z.enum(['INDEX', 'MCP']).optional(),
          category: z.string().max(60).optional(),
          search: z.string().max(120).optional(),
        })
        .default({}),
    )
    .query(async ({ input }) => {
      return listMarketplaceCatalog(input);
    }),

  /** Fetch one listing by slug (supports UNLISTED published items too). */
  get: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const item = await getMarketplaceCatalogItem(input.slug, {
        viewerTenantId: ctx.tenant?.id,
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Marketplace listing not found.' });
      }
      return item;
    }),

  /** Slugs installed & enabled in the caller's workspace. */
  installed: scopedProcedure('marketplace:read').query(async ({ ctx }) => {
    return listInstalledMarketplaceSlugs(ctx.tenant.id);
  }),

  /** Listings published by the caller's workspace. */
  myPublished: scopedProcedure('marketplace:read').query(async ({ ctx }) => {
    try {
      return await ctx.prisma.marketplaceListing.findMany({
        where: { publisherTenantId: ctx.tenant.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          tagline: true,
          kind: true,
          status: true,
          visibility: true,
          category: true,
          minPlan: true,
          collectionId: true,
          connectionId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (err) {
      if (isMissingMarketplaceTable(err)) return [];
      throw err;
    }
  }),

  /** Install or uninstall a Marketplace listing on the caller's workspace. */
  setInstalled: scopedProcedure('marketplace:write')
    .input(
      z.object({
        slug: z.string().min(1).max(64),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cleanSlug = input.slug.trim().toLowerCase();
      if (cleanSlug === 'workspace') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Your own workspace index is already active inside your workspace.',
        });
      }

      const listing = await getMarketplaceCatalogItem(cleanSlug, {
        viewerTenantId: ctx.tenant.id,
      });
      if (!listing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Marketplace listing not found.' });
      }
      if (input.enabled && !meetsPlan(ctx.tenant.plan, listing.minPlan)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `This listing requires the ${listing.minPlan} plan (your workspace is on ${ctx.tenant.plan}).`,
        });
      }

      const actorId = ctx.user?.id ?? ctx.apiKey?.createdById ?? ctx.tenant.id;
      try {
        await ctx.prisma.marketplaceInstall.upsert({
          where: {
            tenantId_listingSlug: {
              tenantId: ctx.tenant.id,
              listingSlug: listing.slug,
            },
          },
          create: {
            tenantId: ctx.tenant.id,
            listingSlug: listing.slug,
            enabled: input.enabled,
            installedBy: actorId,
          },
          update: {
            enabled: input.enabled,
          },
        });
      } catch (err) {
        if (isMissingMarketplaceTable(err)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Marketplace database tables have not been migrated yet (run `pnpm db:push`).',
          });
        }
        throw err;
      }

      await ctx.prisma.auditLog
        .create({
          data: {
            tenantId: ctx.tenant.id,
            userId: ctx.user?.id,
            apiKeyId: ctx.apiKey?.id,
            action: input.enabled ? 'marketplace.install' : 'marketplace.uninstall',
            resource: 'marketplace_install',
            resourceId: listing.slug,
            metadata: { slug: listing.slug, kind: listing.kind },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
        })
        .catch(() => undefined);

      return { slug: listing.slug, enabled: input.enabled };
    }),

  /** Publish a workspace Knowledge Collection/Index or MCP Server to the Marketplace. */
  publish: scopedProcedure('marketplace:write')
    .input(
      z.object({
        slug: ListingSlugSchema,
        name: z.string().trim().min(3).max(80),
        tagline: z.string().trim().min(8).max(160),
        description: z.string().trim().min(16).max(2400),
        kind: z.enum(['INDEX', 'MCP']),
        visibility: z.enum(['PUBLIC', 'UNLISTED']).default('PUBLIC'),
        category: z.string().trim().min(2).max(40).default('general'),
        tags: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
        samplePrompts: z.array(z.string().trim().min(4).max(200)).max(4).default([]),
        minPlan: PlanEnum.default('FREE'),
        collectionId: z.string().uuid().nullable().optional(),
        connectionId: z.string().uuid().nullable().optional(),
        upstreamEndpoint: z.string().url().max(1024).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdminOrOwner(ctx.user);

      if (RESERVED_SLUGS.has(input.slug)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `The slug "${input.slug}" is reserved by Horus.`,
        });
      }

      let collectionId: string | null = null;
      let connectionId: string | null = null;
      let upstreamEndpoint: string | null = null;

      if (input.kind === 'INDEX') {
        if (input.collectionId) {
          const coll = await ctx.prisma.knowledgeCollection.findFirst({
            where: { id: input.collectionId, tenantId: ctx.tenant.id },
          });
          if (!coll) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Selected knowledge collection does not belong to this workspace.',
            });
          }
          collectionId = coll.id;
        }
      } else {
        if (input.connectionId) {
          const conn = await ctx.prisma.connection.findFirst({
            where: { id: input.connectionId, tenantId: ctx.tenant.id, kind: 'MCP' },
          });
          if (!conn) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Selected MCP connection does not belong to this workspace.',
            });
          }
          const ssrf = blockedUrlReason(conn.endpoint);
          if (ssrf) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Cannot publish private or local MCP endpoint (${ssrf}).`,
            });
          }
          if (
            process.env.NODE_ENV === 'production' &&
            !conn.endpoint.toLowerCase().startsWith('https://')
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Published MCP endpoints must use HTTPS in production.',
            });
          }
          if (conn.secretRef && !isAllowedTenantSecretRef(conn.secretRef)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'MCP secret references must begin with MCP_SECRET_.',
            });
          }
          connectionId = conn.id;
        } else if (input.upstreamEndpoint) {
          const ssrf = blockedUrlReason(input.upstreamEndpoint);
          if (ssrf) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Invalid MCP endpoint (${ssrf}).`,
            });
          }
          if (
            process.env.NODE_ENV === 'production' &&
            !input.upstreamEndpoint.toLowerCase().startsWith('https://')
          ) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Published MCP endpoints must use HTTPS in production.',
            });
          }
          upstreamEndpoint = input.upstreamEndpoint;
        } else {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'MCP listings require either an existing workspace MCP connection or an HTTPS endpoint.',
          });
        }
      }

      try {
        const existing = await ctx.prisma.marketplaceListing.findUnique({
          where: { slug: input.slug },
        });
        if (existing) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A listing with slug "${input.slug}" already exists.`,
          });
        }

        const created = await ctx.prisma.marketplaceListing.create({
          data: {
            slug: input.slug,
            name: input.name,
            tagline: input.tagline,
            description: input.description,
            kind: input.kind,
            status: 'PUBLISHED',
            visibility: input.visibility,
            category: input.category.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
            tags: input.tags.map((t) => t.toLowerCase()),
            samplePrompts: input.samplePrompts,
            minPlan: input.minPlan,
            verified: false,
            featured: false,
            publisherTenantId: ctx.tenant.id,
            publisherName: ctx.tenant.name,
            collectionId,
            connectionId,
            upstreamEndpoint,
            createdById: ctx.user?.id ?? ctx.apiKey?.createdById ?? null,
          },
          select: {
            id: true,
            slug: true,
            name: true,
            kind: true,
            status: true,
            visibility: true,
          },
        });

        await ctx.prisma.auditLog
          .create({
            data: {
              tenantId: ctx.tenant.id,
              userId: ctx.user?.id,
              apiKeyId: ctx.apiKey?.id,
              action: 'marketplace.listing.publish',
              resource: 'marketplace_listing',
              resourceId: created.id,
              metadata: { slug: created.slug, kind: created.kind, visibility: created.visibility },
              ip: ctx.ip,
              userAgent: ctx.userAgent,
            },
          })
          .catch(() => undefined);

        return created;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (isMissingMarketplaceTable(err)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Marketplace database tables have not been migrated yet (run `pnpm db:push`).',
          });
        }
        throw err;
      }
    }),

  /** Change status or visibility of a listing owned by this workspace. */
  updateStatus: scopedProcedure('marketplace:write')
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(['PUBLISHED', 'DRAFT', 'ARCHIVED']).optional(),
        visibility: z.enum(['PUBLIC', 'UNLISTED']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAdminOrOwner(ctx.user);

      const row = await ctx.prisma.marketplaceListing.findFirst({
        where: { id: input.id, publisherTenantId: ctx.tenant.id },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found.' });
      }

      return ctx.prisma.marketplaceListing.update({
        where: { id: row.id },
        data: {
          ...(input.status && { status: input.status }),
          ...(input.visibility && { visibility: input.visibility }),
        },
        select: { id: true, slug: true, status: true, visibility: true },
      });
    }),

  /** Unpublish and delete a listing owned by this workspace. */
  deleteListing: scopedProcedure('marketplace:write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAdminOrOwner(ctx.user);

      const row = await ctx.prisma.marketplaceListing.findFirst({
        where: { id: input.id, publisherTenantId: ctx.tenant.id },
      });
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Listing not found.' });
      }

      await ctx.prisma.$transaction([
        ctx.prisma.marketplaceInstall.deleteMany({ where: { listingSlug: row.slug } }),
        ctx.prisma.marketplaceListing.delete({ where: { id: row.id } }),
      ]);

      return { deleted: true, slug: row.slug };
    }),

  /** Typed SDK/client query endpoint across any published Index or MCP listing. */
  query: scopedProcedure('marketplace:read')
    .input(
      z.discriminatedUnion('mode', [
        z.object({
          slug: z.string().min(1).max(64),
          collection: z.string().max(64).optional(),
          mode: z.literal('search'),
          query: z.string().min(1).max(4000),
          topK: z.number().int().min(1).max(20).optional(),
          category: z.string().max(60).optional(),
          year: z.number().int().optional(),
        }),
        z.object({
          slug: z.string().min(1).max(64),
          collection: z.string().max(64).optional(),
          mode: z.literal('ask'),
          query: z.string().min(1).max(4000),
          maxSources: z.number().int().min(1).max(16).optional(),
          category: z.string().max(60).optional(),
          systemPrompt: z.string().max(2000).optional(),
        }),
        z.object({
          slug: z.string().min(1).max(64),
          collection: z.string().max(64).optional(),
          mode: z.literal('graph'),
          entity: z.string().min(1).max(120),
        }),
        z.object({
          slug: z.string().min(1).max(64),
          collection: z.string().max(64).optional(),
          mode: z.literal('categories'),
        }),
        z.object({
          slug: z.string().min(1).max(64),
          mode: z.literal('mcp_call'),
          tool: z.string().min(1).max(80),
          arguments: z.record(z.unknown()).optional(),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await resolveMarketplaceTarget({
        slug: input.slug,
        callerTenantId: ctx.tenant.id,
        collectionSlug: 'collection' in input ? input.collection : undefined,
      });
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Marketplace listing not found.' });
      }
      if (!meetsPlan(ctx.tenant.plan, target.listing.minPlan)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Requires ${target.listing.minPlan} plan.`,
        });
      }

      const caller = {
        tenantId: ctx.tenant.id,
        tenantSlug: ctx.tenant.slug,
        apiKeyId: ctx.apiKey?.id ?? null,
        surface: 'rest' as const,
      };

      try {
        if (input.mode === 'mcp_call') {
          if (!hasScope(ctx.scopes, 'mcp:call')) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'MCP tool execution requires the mcp:call scope.',
            });
          }
          if (target.kind !== 'MCP') {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `"${target.listing.slug}" is a knowledge index, not an MCP tool listing.`,
            });
          }
          const res = await executeMcpGatewayCall(
            target,
            { tool: input.tool, arguments: input.arguments },
            caller,
          );
          return { mode: 'mcp_call' as const, ...res };
        }

        if (target.kind !== 'INDEX') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `"${target.listing.slug}" is an MCP server — use mode="mcp_call".`,
          });
        }

        if (input.mode === 'search') {
          const res = await executeIndexSearch(
            target,
            {
              query: input.query,
              topK: input.topK,
              category: input.category,
              year: input.year,
            },
            caller,
          );
          return { mode: 'search' as const, ...res };
        }
        if (input.mode === 'ask') {
          const res = await executeIndexAsk(
            target,
            {
              query: input.query,
              maxSources: input.maxSources,
              category: input.category,
              systemPrompt: input.systemPrompt,
            },
            caller,
          );
          return { mode: 'ask' as const, ...res };
        }
        if (input.mode === 'graph') {
          const res = await executeIndexGraphLookup(target, { entity: input.entity }, caller);
          return { mode: 'graph' as const, ...res };
        }

        const categories = await executeIndexCategories(target);
        return { mode: 'categories' as const, categories };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (err instanceof MarketplaceInputError) {
          throw new TRPCError({
            code:
              err.status === 404
                ? 'NOT_FOUND'
                : err.status === 503
                  ? 'SERVICE_UNAVAILABLE'
                  : 'BAD_REQUEST',
            message: err.message,
          });
        }
        throw err;
      }
    }),
});
