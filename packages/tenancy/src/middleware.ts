import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware for Next.js. Resolves the tenant from request host/path,
 * sets `x-horus-tenant` header for downstream RSC/route handlers, and rewrites
 * subdomain requests into the `(tenant)/[tenant]/...` route group.
 *
 * Heavy work (DB lookups) lives in resolver.ts and is called by route handlers,
 * not in middleware (Edge runtime can't talk to Prisma directly).
 */
export function buildTenancyMiddleware(opts: {
  apexDomains: string[];
  reservedSubdomains?: string[];
  publicPaths?: RegExp[];
}) {
  const apex = new Set(opts.apexDomains.map((d) => d.toLowerCase()));
  const reserved = new Set(
    (opts.reservedSubdomains ?? ['www', 'api', 'app', 'admin', 'docs', 'auth']).map((s) =>
      s.toLowerCase(),
    ),
  );
  const publicPaths = opts.publicPaths ?? [/^\/_next\//, /^\/favicon/, /^\/api\/health/];

  return function middleware(req: NextRequest) {
    const url = new URL(req.url);
    if (publicPaths.some((re) => re.test(url.pathname))) return NextResponse.next();

    const host = req.headers.get('host')?.toLowerCase().split(':')[0] ?? '';
    let tenantSlug: string | null = null;

    for (const a of apex) {
      if (host.endsWith(`.${a}`)) {
        const sub = host.slice(0, host.length - a.length - 1);
        if (sub && !reserved.has(sub)) tenantSlug = sub;
      }
    }

    if (tenantSlug) {
      const headers = new Headers(req.headers);
      headers.set('x-horus-tenant-slug', tenantSlug);

      // Rewrite to tenant-scoped route group if not already targeting it
      if (!url.pathname.startsWith('/_t/')) {
        url.pathname = `/_t/${tenantSlug}${url.pathname}`;
        return NextResponse.rewrite(url, { request: { headers } });
      }

      return NextResponse.next({ request: { headers } });
    }

    return NextResponse.next();
  };
}
