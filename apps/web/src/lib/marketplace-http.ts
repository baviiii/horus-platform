import 'server-only';
import { prisma, type Tenant } from '@horus/db';
import { hasScope, validateApiKey } from '@horus/auth';
import { getCurrentUser } from '@/lib/supabase/server';

const MINUTE_MS = 60_000;
const MAX_BUCKETS = 10_000;
const minuteHits = new Map<string, number[]>();

function checkMinuteLimit(
  key: string,
  limitPerMinute: number,
): {
  ok: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const cutoff = now - MINUTE_MS;
  let stamps = minuteHits.get(key)?.filter((t) => t > cutoff) ?? [];

  if (stamps.length >= limitPerMinute) {
    const oldest = stamps[0]!;
    minuteHits.set(key, stamps);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1000)),
    };
  }

  stamps = [...stamps, now];
  minuteHits.set(key, stamps);

  if (minuteHits.size > MAX_BUCKETS) {
    for (const [k, v] of minuteHits) {
      if (v.every((t) => t <= cutoff)) minuteHits.delete(k);
      if (minuteHits.size <= MAX_BUCKETS / 2) break;
    }
  }

  return { ok: true, retryAfterSeconds: 0 };
}

export const PUBLIC_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, X-Api-Key, X-Functions-Key, X-Horus-Tenant, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version, Retry-After',
  'Access-Control-Max-Age': '86400',
};

/**
 * Attach CORS headers ONLY for public or Bearer-key-authenticated responses.
 * Cookie-authenticated responses intentionally omit wildcard CORS so browsers
 * never allow cross-origin sites to ride a user's session cookie.
 */
export function withCors(res: Response, allowCrossOrigin: boolean): Response {
  if (!allowCrossOrigin) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(PUBLIC_CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function readApiToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token) return token;
  }
  const apiKey = req.headers.get('x-api-key')?.trim();
  if (apiKey) return apiKey;
  const fnKey = req.headers.get('x-functions-key')?.trim();
  if (fnKey) return fnKey;
  return null;
}

export function resolveRequestOrigin(req: Request): string {
  const proto =
    req.headers.get('x-forwarded-proto') ??
    (req.headers.get('host')?.startsWith('localhost') ? 'http' : 'https');
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

function isSameOriginMutation(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHost = (
      req.headers.get('x-forwarded-host') ??
      req.headers.get('host') ??
      new URL(req.url).host
    ).toLowerCase();
    return originHost === expectedHost;
  } catch {
    return false;
  }
}

export type MarketplaceAuthResult =
  | {
      ok: true;
      authMode: 'api-key' | 'session';
      tenant: Tenant;
      apiKeyId: string | null;
      scopes: string[];
    }
  | {
      ok: false;
      authMode: 'api-key' | 'session';
      response: Response;
    };

/**
 * Authenticate an incoming Marketplace or MCP request.
 *
 * 1. If a Bearer / X-Api-Key token is present: validates `horus_sk_*`, enforces
 *    scopes and `ApiKey.rateLimit` req/min.
 * 2. Otherwise falls back to a signed-in Horus user's Supabase session cookie
 *    (enforcing same-origin on POST/DELETE to prevent CSRF) and resolves their
 *    requested or primary active workspace.
 */
export async function authenticateMarketplaceRequest(
  req: Request,
  opts: {
    targetKind: 'INDEX' | 'MCP';
    targetSlug: string;
    explicitTenantSlug?: string | null;
  },
): Promise<MarketplaceAuthResult> {
  const token = readApiToken(req);

  if (token) {
    const validated = await validateApiKey(token);
    if (!validated) {
      return {
        ok: false,
        authMode: 'api-key',
        response: withCors(
          Response.json(
            {
              error:
                'Invalid, expired, or revoked Horus API key. Mint one in your workspace Marketplace or Settings tab.',
            },
            { status: 401 },
          ),
          true,
        ),
      };
    }

    const ownWorkspaceIndex = opts.targetKind === 'INDEX' && opts.targetSlug === 'workspace';
    const allowed =
      opts.targetKind === 'MCP'
        ? hasScope(validated.scopes, 'mcp:call')
        : ownWorkspaceIndex
          ? hasScope(validated.scopes, 'rag:read') || hasScope(validated.scopes, 'marketplace:read')
          : hasScope(validated.scopes, 'marketplace:read');

    if (!allowed) {
      return {
        ok: false,
        authMode: 'api-key',
        response: withCors(
          Response.json(
            {
              error:
                opts.targetKind === 'MCP'
                  ? 'API key requires the mcp:call scope.'
                  : ownWorkspaceIndex
                    ? 'Workspace index access requires rag:read or marketplace:read.'
                    : 'Published Marketplace index access requires marketplace:read.',
            },
            { status: 403 },
          ),
          true,
        ),
      };
    }

    const limit = Math.max(10, validated.apiKey.rateLimit || 100);
    const rate = checkMinuteLimit(`key:${validated.apiKey.id}`, limit);
    if (!rate.ok) {
      return {
        ok: false,
        authMode: 'api-key',
        response: withCors(
          Response.json(
            { error: `Rate limit exceeded (${limit}/min). Retry in ${rate.retryAfterSeconds}s.` },
            {
              status: 429,
              headers: { 'Retry-After': String(rate.retryAfterSeconds) },
            },
          ),
          true,
        ),
      };
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: validated.tenantId } });
    if (!tenant?.isActive) {
      return {
        ok: false,
        authMode: 'api-key',
        response: withCors(
          Response.json({ error: 'Workspace not found or inactive.' }, { status: 404 }),
          true,
        ),
      };
    }

    return {
      ok: true,
      authMode: 'api-key',
      tenant,
      apiKeyId: validated.apiKey.id,
      scopes: validated.scopes,
    };
  }

  // Session-cookie fallback for signed-in users inside Horus UI
  if (req.method !== 'GET' && !isSameOriginMutation(req)) {
    return {
      ok: false,
      authMode: 'session',
      response: Response.json(
        { error: 'Cross-origin requests require an Authorization: Bearer horus_sk_... API key.' },
        { status: 403 },
      ),
    };
  }

  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return {
      ok: false,
      authMode: 'api-key',
      response: withCors(
        Response.json(
          {
            error:
              'Authentication required. Pass Authorization: Bearer horus_sk_live_... or sign in on Horus.',
          },
          { status: 401 },
        ),
        true,
      ),
    };
  }

  const rate = checkMinuteLimit(`user:${user.id}`, 30);
  if (!rate.ok) {
    return {
      ok: false,
      authMode: 'session',
      response: Response.json(
        { error: `Rate limit reached — retry in ${rate.retryAfterSeconds}s.` },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
      ),
    };
  }

  const requestedSlug =
    opts.explicitTenantSlug?.trim() || req.headers.get('x-horus-tenant')?.trim() || null;

  const membership = requestedSlug
    ? await prisma.tenantMember.findFirst({
        where: {
          userId: user.id,
          tenant: { slug: requestedSlug, isActive: true },
        },
        include: { tenant: true },
      })
    : await prisma.tenantMember.findFirst({
        where: {
          userId: user.id,
          tenant: { isActive: true },
        },
        include: { tenant: true },
        orderBy: { joinedAt: 'asc' },
      });

  if (!membership) {
    return {
      ok: false,
      authMode: 'session',
      response: Response.json(
        {
          error: requestedSlug
            ? `You are not a member of workspace "${requestedSlug}".`
            : 'Create or join a Horus workspace first at /onboarding.',
        },
        { status: 403 },
      ),
    };
  }

  if (opts.targetKind === 'MCP' && membership.role === 'VIEWER') {
    return {
      ok: false,
      authMode: 'session',
      response: Response.json(
        {
          error:
            'VIEWER members may browse listings and query indexes, but cannot execute MCP tools.',
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    authMode: 'session',
    tenant: membership.tenant,
    apiKeyId: null,
    scopes:
      membership.role === 'VIEWER'
        ? ['marketplace:read', 'rag:read', 'graph:read']
        : ['marketplace:read', 'mcp:call', 'rag:read', 'graph:read'],
  };
}
