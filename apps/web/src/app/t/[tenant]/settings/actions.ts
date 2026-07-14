'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@horus/db';
import { generateApiKey } from '@horus/auth';
import { requireTenantMember } from '@/lib/tenant-context';

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
  await prisma.apiKey.updateMany({
    where: { id, tenantId: tenant.id },
    data: { revokedAt: new Date() },
  });
  revalidatePath(`/t/${slug}/settings`);
}
