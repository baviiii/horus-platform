-- Enable required Postgres extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- Row-Level Security policies
-- Run after `prisma migrate dev` creates the tables.
-- The session variable `app.tenant_id` is set by the application on every
-- request via the tenant-scoped Prisma client.
-- =============================================================================

-- Helper: read the current tenant from session
CREATE OR REPLACE FUNCTION current_tenant_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid;
$$;

-- Apply RLS to every tenant-scoped table.
-- Platform-admin role bypasses RLS via Postgres BYPASSRLS attribute.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tenant_members',
    'tenant_modules',
    'api_keys',
    'documents',
    'chunks',
    'entities',
    'relationships',
    'document_entities',
    'chat_sessions',
    'chat_messages',
    'prompts',
    'usage_records',
    'audit_logs',
    'webhooks',
    'alerts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);

    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I;',
      tbl
    );

    -- chat_messages is scoped via its parent session, not its own column
    IF tbl = 'chat_messages' THEN
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I
          USING (
            EXISTS (
              SELECT 1 FROM chat_sessions s
              WHERE s.id = chat_messages.session_id
                AND s.tenant_id = current_tenant_id()
            )
          )
          WITH CHECK (
            EXISTS (
              SELECT 1 FROM chat_sessions s
              WHERE s.id = chat_messages.session_id
                AND s.tenant_id = current_tenant_id()
            )
          );
      $p$, tbl);
    -- prompts allows null tenant_id for platform defaults
    ELSIF tbl = 'prompts' THEN
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I
          USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
          WITH CHECK (tenant_id = current_tenant_id() OR tenant_id IS NULL);
      $p$, tbl);
    ELSE
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I
          USING (tenant_id = current_tenant_id())
          WITH CHECK (tenant_id = current_tenant_id());
      $p$, tbl);
    END IF;
  END LOOP;
END;
$$;

-- The `tenants` table itself is never tenant-scoped — it lists all tenants.
-- Access is gated at the application layer (only platform admins read it).
