-- Horus (Supabase project xrgomhiwposlbxwkdudg): create tenant_invites and
-- bring Prisma's migration history in line. Safe to run more than once.
-- Run in: https://supabase.com/dashboard/project/xrgomhiwposlbxwkdudg/sql/new
-- Expected result at the bottom: true | true | 1 | 3
BEGIN;

CREATE TABLE IF NOT EXISTS "tenant_invites" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'MEMBER',
  "invitedBy" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedBy" UUID,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_invites_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tenant_invites_tenantId_idx" ON "tenant_invites"("tenantId");
CREATE INDEX IF NOT EXISTS "tenant_invites_email_idx" ON "tenant_invites"("email");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_invites_tenantId_fkey') THEN
    ALTER TABLE "tenant_invites" ADD CONSTRAINT "tenant_invites_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Each tenant sees only its own invites.
ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_invites;
CREATE POLICY tenant_isolation ON tenant_invites
  USING ("tenantId" = current_tenant_id())
  WITH CHECK ("tenantId" = current_tenant_id());

-- Record the three security migrations as applied (the first two were
-- applied by hand earlier; the third just ran above).
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count, started_at)
SELECT gen_random_uuid()::text, v.checksum, now(), v.name, 1, now()
FROM (VALUES
  ('20260729000000_incidents_rls', '9dde8b4b7ad42806efde32db31630297c42f15729b16ac9c1b4389d833baf941'),
  ('20260816000000_portal_rls',    '61fac448b75b7bda007f6362bf680f8248449018f86dc9a0372ba97e9273c724'),
  ('20261014000000_invites_rls',   '86396ea217d47e80f1bce8743f90063c4be1c598dba267f54bab60e9c2f59833')
) AS v(name, checksum)
WHERE NOT EXISTS (
  SELECT 1 FROM _prisma_migrations m WHERE m.migration_name = v.name AND m.rolled_back_at IS NULL
);

COMMIT;

-- Check. Expect: true | true | 1 | 3
SELECT
  (SELECT relrowsecurity      FROM pg_class WHERE relname = 'tenant_invites') AS rls_on,
  (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tenant_invites') AS rls_forced,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'tenant_invites')      AS policies,
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name IN
     ('20260729000000_incidents_rls', '20260816000000_portal_rls', '20261014000000_invites_rls')) AS migrations_recorded;
