import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // Get the most recent Supabase auth user (this is the logged-in user)
  const users = await p.$queryRawUnsafe<Array<{ id: string; email: string }>>(
    `SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1`,
  );
  const user = users[0];
  if (!user) {
    console.log('No auth user found');
    return;
  }
  console.log('User:', user.id, user.email);

  const tenants = await p.tenant.findMany({ orderBy: { slug: 'asc' } });
  console.log(
    'Tenants:',
    tenants.map((t) => t.slug),
  );

  const careercraft = tenants.find((t) => t.slug === 'careercraft');
  if (careercraft) {
    const existing = await p.tenantMember.findFirst({
      where: { tenantId: careercraft.id, userId: user.id },
    });
    if (!existing) {
      await p.tenantMember.create({
        data: { tenantId: careercraft.id, userId: user.id, role: 'OWNER' },
      });
      console.log('Added to careercraft as OWNER');
    } else {
      console.log('Already member of careercraft');
    }
  } else {
    console.log('No careercraft tenant found');
  }

  const demo = tenants.find((t) => t.slug === 'demo');
  if (demo) {
    const existing = await p.tenantMember.findFirst({
      where: { tenantId: demo.id, userId: user.id },
    });
    if (!existing) {
      await p.tenantMember.create({
        data: { tenantId: demo.id, userId: user.id, role: 'OWNER' },
      });
      console.log('Added to demo as OWNER');
    }
  }

  await p.$disconnect();
}

main().catch(console.error);
