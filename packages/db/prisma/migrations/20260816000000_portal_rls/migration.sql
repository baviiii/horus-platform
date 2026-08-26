-- Row-level security for the customer-portal models.
-- Same posture as init_rls + incidents_rls: every table is tenant-scoped and
-- isolated by the current_tenant_id() session variable.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'knowledge_collections',
    'agents',
    'automations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_tenant_id())
        WITH CHECK ("tenantId" = current_tenant_id());
    $p$, tbl);
  END LOOP;
END;
$$;
