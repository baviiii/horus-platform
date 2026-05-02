import { prisma } from '@horus/db';
import { validateApiKey, isApiKeyShape } from '@horus/auth';
import type { ResolvedTenant } from './context.js';

const APEX_DOMAINS = new Set(
  (process.env.HORUS_APEX_DOMAINS ?? 'horus.ai,horus.local,localhost')
    .split(',')
    .map((d) => d.trim().toLowerCase()),
);

const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'docs',
  'status',
  'auth',
  'mail',
  'cdn',
  'static',
]);

export type ResolveInput = {
  host?: string | null;
  pathname?: string | null;
  authHeader?: string | null;
  tenantHeader?: string | null;
};

/**
 * Resolves the active tenant for a request.
 * Order of precedence: API key > custom domain > subdomain > path prefix > header.
 */
export async function resolveTenant(input: ResolveInput): Promise<ResolvedTenant | null> {
  // 1. Bearer API key
  if (input.authHeader) {
    const token = input.authHeader.replace(/^Bearer\s+/i, '').trim();
    if (isApiKeyShape(token)) {
      const ctx = await validateApiKey(token);
      if (ctx) {
        const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
        if (tenant?.isActive) return { tenant, source: 'api-key' };
      }
    }
  }

  // 2. Host-based: custom domain or subdomain on apex
  if (input.host) {
    const host = input.host.toLowerCase().split(':')[0] ?? '';

    // Custom domain
    const custom = await prisma.tenant.findUnique({ where: { customDomain: host } });
    if (custom?.isActive && custom.domainVerifiedAt) {
      return { tenant: custom, source: 'custom-domain' };
    }

    // Subdomain on a known apex
    for (const apex of APEX_DOMAINS) {
      if (host.endsWith(`.${apex}`)) {
        const sub = host.slice(0, host.length - apex.length - 1);
        if (sub && !RESERVED_SUBDOMAINS.has(sub)) {
          const tenant = await prisma.tenant.findUnique({ where: { slug: sub } });
          if (tenant?.isActive) return { tenant, source: 'subdomain' };
        }
      }
    }
  }

  // 3. Path prefix `/t/<slug>` (admin/dev)
  if (input.pathname) {
    const match = input.pathname.match(/^\/t\/([a-z0-9-]+)/i);
    if (match?.[1]) {
      const tenant = await prisma.tenant.findUnique({ where: { slug: match[1] } });
      if (tenant?.isActive) return { tenant, source: 'path' };
    }
  }

  // 4. Explicit header (server-to-server)
  if (input.tenantHeader) {
    const slug = input.tenantHeader.trim();
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (tenant?.isActive) return { tenant, source: 'header' };
  }

  return null;
}
