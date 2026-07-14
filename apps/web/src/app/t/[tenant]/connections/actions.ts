'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@horus/db';
import { checkMcpHealth, listMcpTools, type McpServerRef } from '@horus/core/mcp';
import { requireTenantMember } from '@/lib/tenant-context';

const SLUG_RE = /^[a-z][a-z0-9_]{1,31}$/;

function toRef(conn: {
  slug: string;
  endpoint: string;
  authType: string;
  secretRef: string | null;
}): McpServerRef {
  const secret =
    conn.authType === 'bearer' && conn.secretRef ? process.env[conn.secretRef] : undefined;
  return {
    label: conn.slug,
    url: conn.endpoint,
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  };
}

async function probe(ref: McpServerRef) {
  const health = await checkMcpHealth(ref);
  const tools = health.ok
    ? (await listMcpTools(ref)).map((t) => ({ name: t.name, description: t.description }))
    : [];
  return {
    status: health.ok ? ('CONNECTED' as const) : ('ERROR' as const),
    toolCount: health.toolCount,
    tools,
    lastError: health.error ?? null,
    lastCheckedAt: new Date(),
  };
}

export async function addConnectionAction(slug: string, formData: FormData): Promise<void> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') return;

  const name = String(formData.get('name') ?? '').trim();
  const connSlug = String(formData.get('slug') ?? '')
    .trim()
    .toLowerCase();
  const endpoint = String(formData.get('endpoint') ?? '').trim();
  const secretRef = String(formData.get('secretRef') ?? '').trim() || null;

  if (!name || name.length > 80 || !SLUG_RE.test(connSlug) || !/^https?:\/\/.+/.test(endpoint)) {
    return;
  }

  const authType = secretRef ? 'bearer' : 'none';
  const probed = await probe(toRef({ slug: connSlug, endpoint, authType, secretRef }));

  await prisma.connection
    .create({
      data: {
        tenantId: tenant.id,
        kind: 'MCP',
        slug: connSlug,
        name,
        endpoint,
        authType,
        secretRef,
        ...probed,
      },
    })
    .catch(() => undefined); // duplicate slug → unique violation; page just re-renders

  revalidatePath(`/t/${slug}/connections`);
}

export async function testConnectionsAction(slug: string): Promise<void> {
  const { tenant } = await requireTenantMember(slug);
  const rows = await prisma.connection.findMany({
    where: { tenantId: tenant.id, kind: 'MCP' },
  });
  await Promise.all(
    rows.map(async (row) => {
      const probed = await probe(toRef(row));
      await prisma.connection.update({ where: { id: row.id }, data: probed });
    }),
  );
  revalidatePath(`/t/${slug}/connections`);
}

export async function removeConnectionAction(slug: string, formData: FormData): Promise<void> {
  const { tenant, user } = await requireTenantMember(slug);
  if (user.role !== 'OWNER' && user.role !== 'ADMIN') return;
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await prisma.connection.deleteMany({ where: { id, tenantId: tenant.id } });
  revalidatePath(`/t/${slug}/connections`);
}
