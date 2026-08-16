/**
 * Mint a scoped API key for a consumer application (e.g. CareerCraft).
 *
 * Read-only by default: a consumer that renders career guidance has no reason
 * to be able to write documents, edit the graph, or touch incidents. Scopes
 * are the boundary, so keep them minimal — widening later is one command,
 * narrowing after a leak is not.
 *
 * The plaintext is printed ONCE and is unrecoverable: only a bcrypt hash is
 * stored. Copy it immediately.
 *
 * Usage:
 *   pnpm exec tsx scripts/mint-consumer-key.ts --tenant=careercraft --name="CareerCraft web"
 *     [--scopes=rag:read,graph:read,entities:read] [--force]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of readFileSync(resolve(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}

/** No FK on api_keys.created_by_id, so a synthetic operator id is fine. */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Everything a read-only intelligence consumer needs, and nothing else. */
const DEFAULT_SCOPES = ['rag:read', 'graph:read', 'entities:read', 'documents:read'];

function arg(name: string, fallback?: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found?.split('=').slice(1).join('=').trim() || fallback;
}

async function main() {
  const slug = arg('tenant', 'careercraft')!;
  const name = arg('name', 'CareerCraft web')!;
  const scopes = (arg('scopes') ?? DEFAULT_SCOPES.join(',')).split(',').map((s) => s.trim());
  const force = process.argv.includes('--force');

  const { prisma } = await import(pathToFileURL(resolve(ROOT, 'packages/db/src/index.ts')).href);
  const { generateApiKey } = await import(
    pathToFileURL(resolve(ROOT, 'packages/auth/src/api-keys.ts')).href
  );

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant "${slug}" not found.`);
    process.exit(1);
  }

  const existing = await prisma.apiKey.findFirst({
    where: { tenantId: tenant.id, name, revokedAt: null },
  });
  if (existing && !force) {
    console.log(`A key named "${name}" already exists for "${slug}".`);
    console.log(`  prefix: ${existing.keyPrefix}…`);
    console.log(`  scopes: ${existing.scopes.join(', ')}`);
    console.log('\nPlaintext is unrecoverable. Use --force to revoke it and mint a new one.');
    await prisma.$disconnect();
    return;
  }
  if (existing && force) {
    await prisma.apiKey.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    console.log(`Revoked previous key ${existing.keyPrefix}…`);
  }

  const generated = await generateApiKey('live');
  const created = await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      keyHash: generated.keyHash,
      keyPrefix: generated.publicPrefix,
      name,
      scopes,
      createdById: SYSTEM_USER_ID,
    },
  });

  await prisma.auditLog
    .create({
      data: {
        tenantId: tenant.id,
        action: 'apikey.create',
        resource: 'api_key',
        resourceId: created.id,
        metadata: { name, scopes, via: 'mint-consumer-key script' },
      },
    })
    .catch(() => undefined);

  console.log(`\ntenant : ${slug} (${tenant.id})`);
  console.log(`name   : ${name}`);
  console.log(`scopes : ${scopes.join(', ')}`);
  console.log('\n  ' + generated.plaintext + '\n');
  console.log('Shown once — store it now. Only a bcrypt hash is kept.');

  await prisma.$disconnect();
}

void main();
