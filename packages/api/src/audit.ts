import type { PrismaClient } from '@horus/db';
import type { Context } from './context.js';

/**
 * Audit-log writer for compliance-relevant mutations.
 *
 * Non-fatal by design: an audit outage must not take incident reporting down
 * with it — but it fails loudly so operators see the gap. Callers pass the
 * tenant-scoped client so RLS applies to the write as well.
 */
export async function audit(
  db: PrismaClient,
  ctx: Pick<Context, 'user' | 'apiKey' | 'ip' | 'userAgent'> & {
    tenant: { id: string };
  },
  action: string,
  params: { resource?: string; resourceId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        tenantId: ctx.tenant.id,
        userId: ctx.user?.id,
        apiKeyId: ctx.apiKey?.id,
        action,
        resource: params.resource,
        resourceId: params.resourceId,
        metadata: (params.metadata ?? {}) as object,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
  } catch (err) {
    console.error(`audit write failed for ${action}:`, err);
  }
}
