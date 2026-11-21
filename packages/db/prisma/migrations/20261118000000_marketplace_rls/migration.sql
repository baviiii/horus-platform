-- Row-level security for Horus Marketplace tables.
--
-- marketplace_installs is strictly tenant-scoped via current_tenant_id().
-- marketplace_listings allows reading PUBLISHED rows across tenants while
-- restricting drafts and all writes to the owning publisherTenantId.

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
