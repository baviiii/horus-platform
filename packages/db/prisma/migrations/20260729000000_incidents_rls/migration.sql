-- Row-level security for the incident-reporting vertical.
-- Same posture as 20260502000000_init_rls: every table carries tenantId and
-- is isolated by the current_tenant_id() session variable. Incident data is
-- participant PII — RLS here is a hard requirement, not hygiene.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'incident_templates',
    'incidents',
    'incident_evidence',
    'incident_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_tenant_id())
        WITH CHECK ("tenantId" = current_tenant_id());
    $p$, tbl);
  END LOOP;
END;
$$;
