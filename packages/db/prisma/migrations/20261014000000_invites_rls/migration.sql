-- Row-level security for tenant invites.
-- Same posture as the other *_rls migrations: tenant-scoped and isolated by
-- the current_tenant_id() session variable.

ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_invites;
CREATE POLICY tenant_isolation ON tenant_invites
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
