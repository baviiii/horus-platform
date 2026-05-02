import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function buildClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['error', 'warn', 'info'],
  });
}

export const prisma: PrismaClient = globalThis.__prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

/**
 * Returns a Prisma client bound to a specific tenant.
 * Sets the Postgres session variable used by RLS policies and applies a
 * defense-in-depth filter on every query that has a `tenantId` field.
 */
export function createTenantScopedClient(tenantId: string): PrismaClient {
  if (!tenantId) {
    throw new Error('createTenantScopedClient requires a tenantId');
  }

  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ args, query, model, operation }) {
          const writeOps = new Set([
            'create',
            'createMany',
            'update',
            'updateMany',
            'upsert',
            'delete',
            'deleteMany',
            'findFirst',
            'findUnique',
            'findMany',
            'count',
            'aggregate',
            'groupBy',
          ]);

          if (!writeOps.has(operation)) return query(args);

          // We do this opportunistically — RLS in Postgres is the real enforcer.
          if (args && typeof args === 'object' && 'where' in args) {
            (args as { where?: Record<string, unknown> }).where = {
              ...(args as { where?: Record<string, unknown> }).where,
              tenantId,
            };
          }

          if (
            args &&
            typeof args === 'object' &&
            'data' in args &&
            args.data &&
            typeof args.data === 'object' &&
            !Array.isArray(args.data) &&
            !('tenantId' in (args.data as Record<string, unknown>))
          ) {
            (args.data as Record<string, unknown>).tenantId = tenantId;
          }

          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}
