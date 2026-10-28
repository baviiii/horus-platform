import 'server-only';
import { prisma } from '@horus/db';
import type { TenantMember } from '@horus/db';
import { SYSTEM_KEY_CREATOR_ID } from '@horus/auth';
import { isPlatformAdmin } from '@/lib/tenant-context';

/**
 * Member identities for the tenant dashboard.
 *
 * tenant_members stores only the Supabase user id; the address lives in
 * auth.users, which the app's Postgres role can read directly.
 */

export interface MemberWithIdentity extends TenantMember {
  email: string | null;
  /** On HORUS_ADMIN_EMAILS — the Horus operator, not the customer's staff. */
  isHorusTeam: boolean;
}

async function emailsById(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; email: string | null }>>`
      SELECT id::text AS id, email FROM auth.users WHERE id = ANY(${ids}::uuid[])
    `;
    return new Map(rows.filter((r) => r.email).map((r) => [r.id, r.email!]));
  } catch {
    // Without access to auth.users the list still renders, just without addresses.
    return new Map();
  }
}

export async function membersWithIdentity(tenantId: string): Promise<MemberWithIdentity[]> {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    orderBy: { joinedAt: 'asc' },
  });
  const emails = await emailsById(members.map((m) => m.userId));
  return members.map((m) => {
    const email = emails.get(m.userId) ?? null;
    return { ...m, email, isHorusTeam: isPlatformAdmin(email) };
  });
}

/** The Supabase user id for an address, if that person has an account. */
export async function userIdByEmail(email: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM auth.users WHERE lower(email) = ${email.toLowerCase()} LIMIT 1
    `;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Ids among `userIds` that belong to Horus operators. */
export async function horusTeamIds(userIds: string[]): Promise<Set<string>> {
  const emails = await emailsById(userIds);
  return new Set([...emails].filter(([, email]) => isPlatformAdmin(email)).map(([id]) => id));
}

/**
 * Which of these API-key creator ids mark the key as managed by Horus:
 * minted by an operator script, or created in the dashboard by an operator.
 * Those keys run integrations (e.g. CareerCraft's app), so only operators
 * may revoke them.
 */
export async function managedKeyCreators(createdByIds: string[]): Promise<Set<string>> {
  const managed = await horusTeamIds(createdByIds.filter((id) => id !== SYSTEM_KEY_CREATOR_ID));
  if (createdByIds.includes(SYSTEM_KEY_CREATOR_ID)) managed.add(SYSTEM_KEY_CREATOR_ID);
  return managed;
}
