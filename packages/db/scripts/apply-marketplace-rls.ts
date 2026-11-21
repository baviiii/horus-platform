/**
 * One-shot: apply RLS policies for the marketplace tables
 * (marketplace_listings, marketplace_installs) against the configured DB.
 *
 * Runs the same SQL as prisma/migrations/20261118000000_marketplace_rls.
 */
import { prisma } from '../src/index.js';

const SQL = `
ALTER TABLE marketplace_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_installs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON marketplace_installs;
CREATE POLICY tenant_isolation ON marketplace_installs
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_listings_read ON marketplace_listings;
DROP POLICY IF EXISTS marketplace_listings_write ON marketplace_listings;
CREATE POLICY marketplace_listings_read ON marketplace_listings
  FOR SELECT
  USING (status = 'PUBLISHED' OR "publisherTenantId" = current_tenant_id());
CREATE POLICY marketplace_listings_write ON marketplace_listings
  FOR ALL
  USING ("publisherTenantId" = current_tenant_id())
  WITH CHECK ("publisherTenantId" = current_tenant_id());
`;

async function main() {
  await prisma.$executeRawUnsafe(SQL);
  console.log('marketplace RLS applied');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
