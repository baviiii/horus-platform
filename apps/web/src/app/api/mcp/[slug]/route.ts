import {
  getMarketplaceCatalogItem,
  meetsPlan,
  resolveMarketplaceTarget,
} from '@horus/core/marketplace';
import { handleMarketplaceMcpRequest } from '@horus/core/mcp';
import { aiOffResponse } from '@/lib/ai-status';
import {
  PUBLIC_CORS_HEADERS,
  authenticateMarketplaceRequest,
  readApiToken,
  resolveRequestOrigin,
  withCors,
} from '@/lib/marketplace-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

async function handle(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const collectionSlug = url.searchParams.get('collection');
  const explicitTenantSlug = url.searchParams.get('tenant');
  const accept = req.headers.get('accept') ?? '';

  // Browser / discovery GET (not an SSE stream handshake): return a clean JSON
  // descriptor so developers inspecting `/api/mcp/<slug>` see tools & setup instructions.
  if (req.method === 'GET' && !accept.includes('text/event-stream') && !readApiToken(req)) {
    const publicListing = await getMarketplaceCatalogItem(slug);
    if (!publicListing) {
      return withCors(
        Response.json({ error: `Unknown MCP endpoint "${slug}".` }, { status: 404 }),
        true,
      );
    }
    const origin = resolveRequestOrigin(req);
    const endpoint = `${origin}${publicListing.mcpPath}`;
    return withCors(
      Response.json({
        protocol: 'model-context-protocol',
        transport: 'streamable-http',
        stateless: true,
        slug: publicListing.slug,
        name: publicListing.name,
        kind: publicListing.kind,
        tagline: publicListing.tagline,
        publisher: publicListing.publisherName,
        minPlan: publicListing.minPlan,
        endpoint,
        restEndpoint: `${origin}${publicListing.restPath}`,
        catalogUrl: `${origin}/marketplace/${publicListing.slug}`,
        authentication: {
          header: 'Authorization: Bearer horus_sk_live_...',
          requiredScopes:
            publicListing.kind === 'MCP' ? ['mcp:call'] : ['marketplace:read', 'mcp:call'],
        },
        tools: publicListing.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        mcpClientConfig: {
          mcpServers: {
            [`horus-${publicListing.slug}`]: {
              type: 'http',
              url: endpoint,
              headers: {
                Authorization: 'Bearer horus_sk_live_YOUR_KEY',
              },
            },
          },
        },
      }),
      true,
    );
  }

  // Peek listing kind so we check the right API-key scope
  const preview = slug === 'workspace' ? null : await getMarketplaceCatalogItem(slug);
  const targetKind = preview?.kind ?? 'INDEX';

  const auth = await authenticateMarketplaceRequest(req, {
    targetKind,
    targetSlug: slug,
    explicitTenantSlug,
  });
  if (!auth.ok) return auth.response;

  const allowCors = auth.authMode === 'api-key';

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
              : `Marketplace MCP server "${slug}" not found.`,
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

  if (target.kind === 'INDEX') {
    const aiOff = aiOffResponse();
    if (aiOff && req.method === 'POST') {
      const body = await req
        .clone()
        .json()
        .catch(() => null);
      const toolName =
        body &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        (body as { method?: unknown }).method === 'tools/call'
          ? (body as { params?: { name?: unknown } }).params?.name
          : null;
      if (toolName === 'search_index' || toolName === 'ask_index') {
        return withCors(aiOff, allowCors);
      }
    }
  }

  const mcpResponse = await handleMarketplaceMcpRequest(req, target, {
    tenantId: auth.tenant.id,
    tenantSlug: auth.tenant.slug,
    apiKeyId: auth.apiKeyId,
    surface: 'mcp',
  });

  return withCors(mcpResponse, allowCors);
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx);
}
