import { z } from 'zod';
import {
  MarketplaceInputError,
  executeIndexAsk,
  executeIndexCategories,
  executeIndexGraphLookup,
  executeIndexSearch,
  executeMcpGatewayCall,
  getMarketplaceCatalogItem,
  meetsPlan,
  resolveMarketplaceTarget,
} from '@horus/core/marketplace';
import { listMcpTools } from '@horus/core/mcp';
import { aiErrorStatus, aiOffResponse } from '@/lib/ai-status';
import {
  PUBLIC_CORS_HEADERS,
  authenticateMarketplaceRequest,
  withCors,
} from '@/lib/marketplace-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

const QueryBodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('search'),
    query: z.string().min(1).max(4000),
    topK: z.number().int().min(1).max(20).optional(),
    category: z.string().max(60).optional(),
    year: z.number().int().optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    collection: z.string().max(64).optional(),
    tenant: z.string().max(64).optional(),
  }),
  z.object({
    mode: z.literal('ask'),
    query: z.string().min(1).max(4000),
    maxSources: z.number().int().min(1).max(16).optional(),
    category: z.string().max(60).optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    systemPrompt: z.string().max(2000).optional(),
    collection: z.string().max(64).optional(),
    tenant: z.string().max(64).optional(),
  }),
  z.object({
    mode: z.literal('graph'),
    entity: z.string().min(1).max(120),
    collection: z.string().max(64).optional(),
    tenant: z.string().max(64).optional(),
  }),
  z.object({
    mode: z.literal('categories'),
    collection: z.string().max(64).optional(),
    tenant: z.string().max(64).optional(),
  }),
  z.object({
    mode: z.literal('tools'),
    collection: z.string().max(64).optional(),
    tenant: z.string().max(64).optional(),
  }),
  z.object({
    mode: z.literal('call'),
    tool: z.string().min(1).max(80),
    arguments: z.record(z.unknown()).optional(),
    tenant: z.string().max(64).optional(),
  }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return withCors(
      Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 }),
      true,
    );
  }

  const parsed = QueryBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return withCors(
      Response.json(
        { error: 'Invalid query request.', issues: parsed.error.flatten().fieldErrors },
        { status: 400 },
      ),
      true,
    );
  }

  const body = parsed.data;
  const preview = slug === 'workspace' ? null : await getMarketplaceCatalogItem(slug);
  const targetKind = body.mode === 'call' ? 'MCP' : (preview?.kind ?? 'INDEX');

  const auth = await authenticateMarketplaceRequest(req, {
    targetKind,
    targetSlug: slug,
    explicitTenantSlug: body.tenant ?? null,
  });
  if (!auth.ok) return auth.response;

  const allowCors = auth.authMode === 'api-key';
  const collectionSlug = 'collection' in body ? body.collection : undefined;

  const target = await resolveMarketplaceTarget({
    slug,
    callerTenantId: auth.tenant.id,
    collectionSlug,
  });
  if (!target) {
    return withCors(
      Response.json(
        {
          error:
            slug === 'workspace' && collectionSlug
              ? `Knowledge collection "${collectionSlug}" not found in workspace "${auth.tenant.slug}".`
              : `Marketplace listing "${slug}" not found.`,
        },
        { status: 404 },
      ),
      allowCors,
    );
  }

  if (!meetsPlan(auth.tenant.plan, target.listing.minPlan)) {
    return withCors(
      Response.json(
        {
          error: `"${target.listing.name}" requires the ${target.listing.minPlan} plan (your workspace is on ${auth.tenant.plan}).`,
        },
        { status: 403 },
      ),
      allowCors,
    );
  }

  const caller = {
    tenantId: auth.tenant.id,
    tenantSlug: auth.tenant.slug,
    apiKeyId: auth.apiKeyId,
    surface: 'rest' as const,
  };

  try {
    if (body.mode === 'tools') {
      if (target.kind === 'MCP' && target.serverRef) {
        const liveTools = await listMcpTools(target.serverRef);
        return withCors(
          Response.json({ slug: target.listing.slug, kind: 'MCP', tools: liveTools }),
          allowCors,
        );
      }
      return withCors(
        Response.json({
          slug: target.listing.slug,
          kind: target.kind,
          tools: target.listing.tools,
        }),
        allowCors,
      );
    }

    if (body.mode === 'call') {
      if (target.kind !== 'MCP') {
        return withCors(
          Response.json(
            {
              error: `"${target.listing.slug}" is a knowledge index — use mode="search", "ask", or "graph".`,
            },
            { status: 400 },
          ),
          allowCors,
        );
      }
      const res = await executeMcpGatewayCall(
        target,
        { tool: body.tool, arguments: body.arguments },
        caller,
      );
      return withCors(
        Response.json({ slug: target.listing.slug, mode: 'call', ...res }),
        allowCors,
      );
    }

    if (target.kind !== 'INDEX') {
      return withCors(
        Response.json(
          {
            error: `"${target.listing.slug}" is an MCP tool server — use mode="tools" or mode="call".`,
          },
          { status: 400 },
        ),
        allowCors,
      );
    }

    if (body.mode === 'search' || body.mode === 'ask') {
      const aiOff = aiOffResponse();
      if (aiOff) return withCors(aiOff, allowCors);
    }

    if (body.mode === 'search') {
      const res = await executeIndexSearch(
        target,
        {
          query: body.query,
          topK: body.topK,
          category: body.category,
          year: body.year,
          tags: body.tags,
        },
        caller,
      );
      return withCors(
        Response.json({ slug: target.listing.slug, mode: 'search', ...res }),
        allowCors,
      );
    }

    if (body.mode === 'ask') {
      const res = await executeIndexAsk(
        target,
        {
          query: body.query,
          maxSources: body.maxSources,
          category: body.category,
          tags: body.tags,
          systemPrompt: body.systemPrompt,
        },
        caller,
      );
      return withCors(Response.json({ slug: target.listing.slug, mode: 'ask', ...res }), allowCors);
    }

    if (body.mode === 'graph') {
      const res = await executeIndexGraphLookup(target, { entity: body.entity }, caller);
      return withCors(
        Response.json({ slug: target.listing.slug, mode: 'graph', ...res }),
        allowCors,
      );
    }

    const categories = await executeIndexCategories(target);
    return withCors(
      Response.json({ slug: target.listing.slug, mode: 'categories', categories }),
      allowCors,
    );
  } catch (err) {
    if (err instanceof MarketplaceInputError) {
      return withCors(Response.json({ error: err.message }, { status: err.status }), allowCors);
    }
    const aiStatus = aiErrorStatus(err);
    if (aiStatus) {
      return withCors(
        Response.json(
          { error: err instanceof Error ? err.message : 'AI service unavailable' },
          { status: aiStatus },
        ),
        allowCors,
      );
    }
    return withCors(
      Response.json(
        { error: err instanceof Error ? err.message : 'Marketplace query failed.' },
        { status: 500 },
      ),
      allowCors,
    );
  }
}
