import 'server-only';
import { prisma } from '@horus/db';
import type { Tenant } from '@horus/db';
import { getCurrentUser } from '@/lib/supabase/server';

/**
 * Membership gate for tenant-scoped API route handlers (multipart uploads,
 * file exports — things tRPC is the wrong shape for). Returns a Response to
 * short-circuit with on failure, mirroring /api/agent/chat's local helper.
 */

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export interface MemberApiContext {
  tenant: Tenant;
  user: { id: string; email: string | null };
  role: MemberRole;
}

export async function requireMemberApi(
  slug: string,
): Promise<MemberApiContext | { error: Response }> {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: 'Not signed in' }, { status: 401 }) };

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant || !tenant.isActive) {
    return { error: Response.json({ error: 'Unknown workspace' }, { status: 404 }) };
  }

  const member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
  });
  if (!member) return { error: Response.json({ error: 'Not a member' }, { status: 403 }) };

  return {
    tenant,
    user: { id: user.id, email: user.email ?? null },
    role: member.role,
  };
}

/** Uploads and mutations are for contributing roles; viewers read. */
export function forbidViewerApi(ctx: MemberApiContext): Response | null {
  if (ctx.role === 'VIEWER') {
    return Response.json({ error: 'Viewers cannot modify this workspace' }, { status: 403 });
  }
  return null;
}
