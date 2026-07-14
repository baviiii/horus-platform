/**
 * Executes every query shape the real dashboard pages use, against the live
 * DB — catches enum/relation/aggregate mistakes that typecheck and build
 * can't (force-dynamic pages never render at build time).
 * Run: pnpm exec tsx scripts/smoke-dashboard-queries.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'careercraft' } });
  if (!tenant) throw new Error('careercraft tenant missing — run seed');
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const results = {
    overview: await Promise.all([
      prisma.document.count({ where: { tenantId: tenant.id } }),
      prisma.chunk.count({ where: { tenantId: tenant.id } }),
      prisma.chatSession.count({ where: { tenantId: tenant.id, createdAt: { gte: since30d } } }),
      prisma.alert.findMany({ where: { tenantId: tenant.id, status: 'OPEN' }, take: 3 }),
      prisma.tenantMember.findMany({ where: { tenantId: tenant.id } }),
      prisma.connection.count({ where: { tenantId: tenant.id } }),
      prisma.chatSession.findMany({
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: { _count: { select: { messages: true } } },
      }),
    ]).then((r) => `docs=${r[0]} chunks=${r[1]} sessions=${r[2]} members=${r[4].length}`),

    graphTop: await prisma.entity
      .findMany({
        where: { tenantId: tenant.id },
        include: { _count: { select: { documents: true, outgoing: true, incoming: true } } },
        orderBy: { documents: { _count: 'desc' } },
        take: 10,
      })
      .then((r) => `${r.length} entities`),

    usageByMeter: await prisma.usageRecord
      .groupBy({
        by: ['meter'],
        where: { occurredAt: { gte: since30d } },
        _sum: { quantity: true },
      })
      .then((r) => `${r.length} meters`),

    chatTokens: await prisma.chatMessage
      .aggregate({
        where: { createdAt: { gte: since30d } },
        _sum: { tokensIn: true, tokensOut: true },
        _count: true,
      })
      .then((r) => `${r._count} msgs`),

    adminTenants: await prisma.tenant
      .findMany({
        include: {
          _count: {
            select: { members: true, documents: true, chatSessions: true, connections: true },
          },
        },
      })
      .then((r) => `${r.length} tenants`),

    audit: await prisma.auditLog
      .findMany({
        orderBy: { occurredAt: 'desc' },
        take: 5,
        include: { tenant: { select: { slug: true } } },
      })
      .then((r) => `${r.length} entries`),

    apiKeys: await prisma.apiKey
      .findMany({ where: { tenantId: tenant.id, revokedAt: null } })
      .then((r) => `${r.length} keys`),
  };

  console.log('ALL DASHBOARD QUERIES OK');
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((e) => {
    console.error('QUERY SMOKE FAILED:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
