import { buildTenancyMiddleware } from '@horus/tenancy/middleware';

export const middleware = buildTenancyMiddleware({
  apexDomains: (process.env.HORUS_APEX_DOMAINS ?? 'horus.ai,localhost').split(','),
  reservedSubdomains: ['www', 'api', 'app', 'admin', 'docs', 'auth', 'status'],
});

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (Next internals)
     * - favicon.ico, robots.txt, sitemap.xml
     * - api/health (always returns regardless of tenancy)
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health).*)',
  ],
};
