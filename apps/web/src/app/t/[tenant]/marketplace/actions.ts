'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@horus/db';
import { generateApiKey } from '@horus/auth';
import { requireTenantMember } from '@/lib/tenant-context';

const MARKETPLACE_KEY_SCOPES = ['marketplace:read', 'mcp:call', 'rag:read', 'graph:read'];

export interface MintMarketplaceKeyResult {
  ok: boolean;
  error?: string;
  plaintext?: string;
  prefix?: string;
  name?: string;
}

export async function mintMarketplaceKeyAction(
  slug: string,
  _prev: MintMarketplaceKeyResult | null,
  formData: FormData,
): Promise<MintMarketplaceKeyResult> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
    return { ok: false, error: 'Workspace owner or admin role is required to mint API keys.' };
  }

  const rawName = String(formData.get('name') ?? '').trim();
  const name = rawName || 'Marketplace & MCP · External client';
  if (name.length > 80) {
    return { ok: false, error: 'Key name must be 80 characters or fewer.' };
  }

  const generated = await generateApiKey('live');
  const created = await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      keyHash: generated.keyHash,
      keyPrefix: generated.publicPrefix,
      name,
      scopes: MARKETPLACE_KEY_SCOPES,
      createdById: user.id,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'api_key.marketplace.mint',
        resource: 'api_key',
        resourceId: created.id,
        metadata: { name, scopes: MARKETPLACE_KEY_SCOPES },
      },
    })
    .catch(() => undefined);

  revalidatePath(`/t/${slug}/marketplace`);
  revalidatePath(`/t/${slug}/settings`);

  return {
    ok: true,
    plaintext: generated.plaintext,
    prefix: generated.publicPrefix,
    name,
  };
}
