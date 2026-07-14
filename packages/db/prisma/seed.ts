import { PrismaClient, Plan, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Horus DB...');

  const platformTenant = await prisma.tenant.upsert({
    where: { slug: 'platform' },
    update: {},
    create: {
      slug: 'platform',
      name: 'Horus Platform',
      plan: Plan.ENTERPRISE,
      config: {
        branding: {
          name: 'Horus',
          primaryColor: '#0F172A',
        },
      },
    },
  });

  const careercraftTenant = await prisma.tenant.upsert({
    where: { slug: 'careercraft' },
    update: {},
    create: {
      slug: 'careercraft',
      name: 'CareerCraft',
      plan: Plan.ENTERPRISE,
      config: {
        branding: { name: 'CareerCraft', primaryColor: '#7C3AED' },
        features: { ragEnabled: true, graphEnabled: true, agenticEnabled: true },
      },
      enabledModules: {
        create: [{ moduleKey: 'careers' }, { moduleKey: 'generic' }],
      },
    },
  });

  // Platform-default prompts. Compound-unique upsert can't match NULL
  // tenantId, so emulate it with findFirst + create.
  const ragDefault = await prisma.prompt.findFirst({
    where: { tenantId: null, key: 'rag-default', version: 1 },
  });
  if (!ragDefault) {
    await prisma.prompt.create({
      data: {
        tenantId: null,
        key: 'rag-default',
        version: 1,
        template:
          'You are a careful research assistant. Answer using only the provided sources. Cite each claim with [n].',
        isActive: true,
      },
    });
  }

  console.log('Seed complete:', {
    platformTenant: platformTenant.id,
    careercraftTenant: careercraftTenant.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
