'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@horus/db';
import { generateApiKey } from '@horus/auth';
import { INVITE_TTL_DAYS } from '@/lib/invites';
import { horusTeamIds, managedKeyCreators, userIdByEmail } from '@/lib/members';
import { isPlatformAdmin, requireTenantMember } from '@/lib/tenant-context';

const DEFAULT_SCOPES = [
  'rag:*',
  'agentic:*',
  'graph:*',
  'documents:*',
  'entities:*',
  'alerts:*',
  'connections:*',
  'intelligence:infer',
];

export interface CreateKeyResult {
  ok: boolean;
  error?: string;
  /** Shown exactly once — never stored in plaintext. */
  plaintext?: string;
  prefix?: string;
}

export async function createApiKeyAction(
  slug: string,
  _prev: CreateKeyResult | null,
  formData: FormData,
): Promise<CreateKeyResult> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    return { ok: false, error: 'Owner or admin required.' };
  }
  const name = String(formData.get('name') ?? '').trim();
  if (!name || name.length > 80) {
    return { ok: false, error: 'Give the key a name (max 80 chars).' };
  }

  const generated = await generateApiKey('live');
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      keyHash: generated.keyHash,
      keyPrefix: generated.publicPrefix,
      name,
      scopes: DEFAULT_SCOPES,
      createdById: user.id,
    },
  });

  revalidatePath(`/t/${slug}/settings`);
  return { ok: true, plaintext: generated.plaintext, prefix: generated.publicPrefix };
}

export async function revokeApiKeyAction(slug: string, formData: FormData): Promise<void> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') return;
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const key = await prisma.apiKey.findFirst({ where: { id, tenantId: tenant.id } });
  if (!key) return;
  // Integration keys Horus manages (e.g. the one CareerCraft's app runs on)
  // are rotated by the operator; a customer click would take their product down.
  if (!isPlatformAdmin(user.email) && (await managedKeyCreators([key.createdById])).size > 0) {
    return;
  }
  await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  revalidatePath(`/t/${slug}/settings`);
}

// ─── Members & invites ──────────────────────────────────────────────

const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
type Role = (typeof ROLES)[number];

export interface InviteResult {
  ok: boolean;
  error?: string;
  email?: string;
}

export async function inviteMemberAction(
  slug: string,
  _prev: InviteResult | null,
  formData: FormData,
): Promise<InviteResult> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    return { ok: false, error: 'Owner or admin required.' };
  }

  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const role = String(formData.get('role') ?? 'MEMBER') as Role;
  if (!ROLES.includes(role)) return { ok: false, error: 'Pick a role.' };
  if (role === 'OWNER' && user.role !== 'OWNER') {
    return { ok: false, error: 'Only an owner can invite another owner.' };
  }

  const existingUserId = await userIdByEmail(email);
  if (existingUserId) {
    const member = await prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: existingUserId } },
    });
    if (member) return { ok: false, error: `${email} is already a member.` };
  }

  // One live invite per address: re-inviting replaces the old one.
  const invite = await prisma.$transaction(async (tx) => {
    await tx.tenantInvite.updateMany({
      where: { tenantId: tenant.id, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.tenantInvite.create({
      data: {
        tenantId: tenant.id,
        email,
        role,
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'members.invite.create',
        resource: 'tenant_invite',
        resourceId: created.id,
        metadata: { email, role },
      },
    });
    return created;
  });

  revalidatePath(`/t/${slug}/settings`);
  return { ok: true, email: invite.email };
}

export async function cancelInviteAction(slug: string, formData: FormData): Promise<void> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') return;
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const { count } = await prisma.tenantInvite.updateMany({
    where: { id, tenantId: tenant.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count > 0) {
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'members.invite.cancel',
        resource: 'tenant_invite',
        resourceId: id,
      },
    });
  }
  revalidatePath(`/t/${slug}/settings`);
}

export async function removeMemberAction(slug: string, formData: FormData): Promise<void> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') return;
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const target = await prisma.tenantMember.findFirst({ where: { id, tenantId: tenant.id } });
  if (!target || target.userId === user.id) return;
  if (target.role === 'OWNER' && user.role !== 'OWNER') return;
  // Operators re-claim OWNER on their next visit, so removing them is a no-op that confuses.
  if ((await horusTeamIds([target.userId])).has(target.userId)) return;
  if (target.role === 'OWNER') {
    const owners = await prisma.tenantMember.count({
      where: { tenantId: tenant.id, role: 'OWNER' },
    });
    if (owners <= 1) return;
  }

  await prisma.tenantMember.delete({ where: { id: target.id } });
  await prisma.auditLog.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      action: 'members.remove',
      resource: 'tenant_member',
      resourceId: target.id,
      metadata: { removedUserId: target.userId, role: target.role },
    },
  });
  revalidatePath(`/t/${slug}/settings`);
}
