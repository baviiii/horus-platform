/**
 * One-shot: apply RLS policies for the customer-portal tables
 * (knowledge_collections, agents, automations) against the configured DB.
 *
 * Runs the same SQL as prisma/migrations/20260816000000_portal_rls. Kept as a
 * script because the platform applies base tables via `db push` (migrations
 * history is RLS-only) — so the RLS step needs its own runner.
 */
import { prisma } from '../src/index.js';

const SQL = `
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
`;

async function main() {
  await prisma.$executeRawUnsafe(SQL);
  console.log('portal RLS applied');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
