-- RLS for the connections table — same tenant_isolation contract as init_rls.
-- Applied with: pnpm exec prisma db execute --file prisma/sql/connections_rls.sql
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON connections;

CREATE POLICY tenant_isolation ON connections
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());
