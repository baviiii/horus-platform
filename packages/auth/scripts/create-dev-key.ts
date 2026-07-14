import { prisma } from '@horus/db';
import { generateApiKey } from '../src/api-keys.js';
import { SCOPES } from '../src/scopes.js';

/** Placeholder Supabase user id for dev-only keys (no FK on api_keys.created_by_id). */
const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';
const KEY_NAME = 'Dev infer (playground + MCP)';

function readTenantSlug(): string {
  const arg = process.argv.find((a) => a.startsWith('--tenant='));
  return arg?.split('=')[1]?.trim() || 'platform';
}

async function main() {
  const force = process.argv.includes('--force');
  const slug = readTenantSlug();

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant "${slug}" not found. Run: pnpm db:seed`);
    process.exit(1);
  }

  const existing = await prisma.apiKey.findFirst({
    where: { tenantId: tenant.id, name: KEY_NAME, revokedAt: null },
  });

  if (existing && !force) {
    console.log(`Dev API key already exists for tenant "${slug}".`);
    console.log(`  Prefix: ${existing.keyPrefix}…`);
    console.log('Plaintext cannot be recovered. Use --force to revoke and mint a new key.');
    process.exit(0);
  }

  if (existing && force) {
    await prisma.apiKey.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  }

  const { plaintext, publicPrefix, keyHash } = await generateApiKey('test');
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      keyHash,
      keyPrefix: publicPrefix,
      name: KEY_NAME,
      scopes: [SCOPES.INTELLIGENCE_INFER],
      createdById: DEV_USER_ID,
    },
  });

  console.log('\n=== Horus dev API key ===');
  console.log(`Tenant: ${slug} (${tenant.id})`);
  console.log(`Scopes: ${SCOPES.INTELLIGENCE_INFER}`);
  console.log('\nSave this key now — it is shown once:\n');
  console.log(`  ${plaintext}\n`);
  console.log('Quick test (Horus web on :3000):');
  console.log(`  curl -s -X POST http://localhost:3000/api/infer \\`);
  console.log(`    -H "Authorization: Bearer ${plaintext}" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(
    `    -d '{"task":"playground.ping","system":"Return JSON with field answer.","messages":[{"role":"user","content":"Say hello in one word."}]}'`,
  );
  console.log('\nMCP env:');
  console.log('  HORUS_MODE=http');
  console.log('  HORUS_BASE_URL=http://localhost:3000/api');
  console.log(`  HORUS_API_KEY=${plaintext}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
