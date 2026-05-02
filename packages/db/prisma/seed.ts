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

  // Platform-default prompts (extracted from existing intelligencePrompts)
  await prisma.prompt.upsert({
    where: {
      tenantId_key_version: { tenantId: null as unknown as string, key: 'rag-default', version: 1 },
    },
    update: {},
    create: {
      tenantId: null,
      key: 'rag-default',
      version: 1,
      template:
        'You are a careful research assistant. Answer using only the provided sources. Cite each claim with [n].',
      isActive: true,
    },
  });

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
