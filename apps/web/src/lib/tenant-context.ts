import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@horus/db';
import type { Tenant } from '@horus/db';
import { getCurrentUser } from '@/lib/supabase/server';
import { acceptPendingInvites } from '@/lib/invites';

/**
 * Server-side access layer for the tenant dashboard.
 *
 * Every /t/[tenant] page calls requireTenantMember: resolves the Supabase
 * session, loads the tenant by slug, and verifies membership. A pending
 * invite for the user's confirmed address is claimed on the spot. Emails
 * listed in HORUS_ADMIN_EMAILS auto-claim OWNER on any tenant (so the
 * platform operator can walk into any workspace).
 */

export interface DashboardUser {
  id: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  displayName: string;
  initials: string;
}

export interface TenantContext {
  tenant: Tenant;
  user: DashboardUser;
}

function adminEmails(): Set<string> {
  return new Set(
    (process.env.HORUS_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** True when this email is on the HORUS_ADMIN_EMAILS platform-operator allowlist. */
export function isPlatformAdmin(email?: string | null): boolean {
  if (!email) return false;
  return adminEmails().has(email.toLowerCase());
}

function toDisplay(
  email: string,
  meta: Record<string, unknown>,
): { name: string; initials: string } {
  const metaName = typeof meta.full_name === 'string' ? meta.full_name : undefined;
  const name = metaName?.trim() || email.split('@')[0]!.replace(/[._-]+/g, ' ');
  const initials = name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
  return { name, initials: initials || email[0]!.toUpperCase() };
}

/** Deduped per request — layout and page both call this with the same slug. */
export const requireTenantMember = cache(async (slug: string): Promise<TenantContext> => {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/t/${slug}`)}`);

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant || !tenant.isActive) notFound();

  let member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
  });

  if (!member) {
    const email = user.email?.toLowerCase();
    if (email && adminEmails().has(email)) {
      member = await prisma.tenantMember.create({
        data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
      });
    } else if ((await acceptPendingInvites(user)).includes(slug)) {
      member = await prisma.tenantMember.findUniqueOrThrow({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      });
    } else {
      redirect('/onboarding');
    }
  }

  const email = user.email ?? 'unknown@user';
  const { name, initials } = toDisplay(
    email,
    (user.user_metadata ?? {}) as Record<string, unknown>,
  );

  return {
    tenant,
    user: { id: user.id, email, role: member.role, displayName: name, initials },
  };
});

/** Gate for /admin — platform operators only (HORUS_ADMIN_EMAILS allowlist). */
export async function requirePlatformAdmin(): Promise<DashboardUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/admin');
  const email = user.email?.toLowerCase();
  if (!email || !adminEmails().has(email)) notFound();
  const { name, initials } = toDisplay(
    email,
    (user.user_metadata ?? {}) as Record<string, unknown>,
  );
  return { id: user.id, email, role: 'OWNER', displayName: name, initials };
}
