import { listMarketplaceCatalog } from '@horus/core/marketplace';
import { PUBLIC_CORS_HEADERS, resolveRequestOrigin, withCors } from '@/lib/marketplace-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/v1/marketplace — public machine-readable catalog of published
 * Horus Knowledge Indexes and MCP servers.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get('kind')?.toUpperCase();
  const kind = kindParam === 'INDEX' || kindParam === 'MCP' ? kindParam : undefined;
  const category = url.searchParams.get('category') ?? undefined;
  const search = url.searchParams.get('q') ?? undefined;

  const origin = resolveRequestOrigin(req);
  const items = await listMarketplaceCatalog({ kind, category, search });

  return withCors(
    Response.json({
      count: items.length,
      listings: items.map((item) => ({
        slug: item.slug,
        name: item.name,
        tagline: item.tagline,
        description: item.description,
        kind: item.kind,
        category: item.category,
        tags: item.tags,
        minPlan: item.minPlan,
        verified: item.verified,
        featured: item.featured,
        firstParty: item.firstParty,
        publisher: item.publisherName,
        live: item.live,
        installCount: item.installCount,
        ...(item.stats && { stats: item.stats }),
        tools: item.tools.map((t) => ({ name: t.name, description: t.description })),
        endpoints: {
          mcp: `${origin}${item.mcpPath}`,
          restQuery: `${origin}${item.restPath}`,
          detail: `${origin}/marketplace/${item.slug}`,
        },
      })),
    }),
    true,
  );
}
