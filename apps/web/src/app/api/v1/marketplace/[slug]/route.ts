import { getMarketplaceCatalogItem } from '@horus/core/marketplace';
import { PUBLIC_CORS_HEADERS, resolveRequestOrigin, withCors } from '@/lib/marketplace-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const item = await getMarketplaceCatalogItem(slug);
  if (!item) {
    return withCors(
      Response.json({ error: `Marketplace listing "${slug}" not found.` }, { status: 404 }),
      true,
    );
  }

  const origin = resolveRequestOrigin(req);
  return withCors(
    Response.json({
      ...item,
      endpoints: {
        mcp: `${origin}${item.mcpPath}`,
        restQuery: `${origin}${item.restPath}`,
        detail: `${origin}/marketplace/${item.slug}`,
      },
    }),
    true,
  );
}
