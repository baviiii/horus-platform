import 'server-only';
import { prisma } from '@horus/db';
import type { User } from '@supabase/supabase-js';

/** How long an invite stays claimable. */
export const INVITE_TTL_DAYS = 14;

const ROLE_RANK = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 } as const;

/**
 * Turn every pending invite for this user's address into a membership.
 *
 * Claiming is by email, so the address must be confirmed — otherwise anyone
 * could sign up as an invitee's address and walk into their workspace.
 * Returns the slugs joined, oldest invite first.
 */
export async function acceptPendingInvites(user: User): Promise<string[]> {
  const email = user.email?.toLowerCase();
  if (!email || !user.email_confirmed_at) return [];

  const invites = await prisma.tenantInvite.findMany({
    where: {
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      tenant: { isActive: true },
    },
    include: { tenant: { select: { slug: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (invites.length === 0) return [];

  const joined: string[] = [];
  for (const invite of invites) {
    const claimed = await prisma.$transaction(async (tx) => {
      // Claim first: a concurrent request blocks on this row, then sees it taken.
      const { count } = await tx.tenantInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date(), acceptedBy: user.id },
      });
      if (count === 0) return false;

      const existing = await tx.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
      });
      if (!existing) {
        await tx.tenantMember.create({
          data: {
            tenantId: invite.tenantId,
            userId: user.id,
            role: invite.role,
            invitedBy: invite.invitedBy,
          },
        });
      } else if (ROLE_RANK[invite.role] > ROLE_RANK[existing.role]) {
        // An invite never demotes; it can raise someone already inside.
        await tx.tenantMember.update({ where: { id: existing.id }, data: { role: invite.role } });
      }
      await tx.auditLog.create({
        data: {
          tenantId: invite.tenantId,
          userId: user.id,
          action: 'members.invite.accept',
          resource: 'tenant_invite',
          resourceId: invite.id,
          metadata: { email, role: invite.role },
        },
      });
      return true;
    });
    if (claimed) joined.push(invite.tenant.slug);
  }

  return joined;
}
