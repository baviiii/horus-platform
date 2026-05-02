import type { Tenant, ApiKey } from '@horus/db';
import { prisma, createTenantScopedClient } from '@horus/db';
import { resolveTenant } from '@horus/tenancy';
import { validateApiKey } from '@horus/auth';
import type { PrismaClient } from '@prisma/client';

export type AuthedUser = {
  id: string;
  email: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
};

export type Context = {
  tenant: Tenant | null;
  user: AuthedUser | null;
  apiKey: ApiKey | null;
  scopes: string[];
  ip: string | null;
  userAgent: string | null;
  prisma: PrismaClient;
  /** Tenant-scoped Prisma client. Null when no tenant resolved. */
  db: PrismaClient | null;
};

export type CreateContextOptions = {
  headers: Headers;
  /** Authed Supabase user — populated by the route handler from cookies. */
  supabaseUser?: { id: string; email: string | null } | null;
};

export async function createTRPCContext(opts: CreateContextOptions): Promise<Context> {
  const { headers } = opts;
  const authHeader = headers.get('authorization');
  const tenantHeader = headers.get('x-horus-tenant');
  const host = headers.get('host');
  const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = headers.get('user-agent');

  let resolvedTenant = null;
  let apiKey: ApiKey | null = null;
  let scopes: string[] = [];

  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const result = await validateApiKey(token);
    if (result) {
      apiKey = result.apiKey;
      scopes = result.scopes;
    }
  }

  resolvedTenant = await resolveTenant({
    host,
    pathname: null,
    authHeader,
    tenantHeader,
  });

  let user: AuthedUser | null = null;
  if (opts.supabaseUser && resolvedTenant?.tenant) {
    const member = await prisma.tenantMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId: resolvedTenant.tenant.id,
          userId: opts.supabaseUser.id,
        },
      },
    });
    if (member) {
      user = { id: opts.supabaseUser.id, email: opts.supabaseUser.email, role: member.role };
      scopes = scopes.length > 0 ? scopes : ['admin:*'];
    }
  }

  const db = resolvedTenant?.tenant ? createTenantScopedClient(resolvedTenant.tenant.id) : null;

  return {
    tenant: resolvedTenant?.tenant ?? null,
    user,
    apiKey,
    scopes,
    ip,
    userAgent,
    prisma,
    db,
  };
}
