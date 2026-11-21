-- Marketplace base tables.
--
-- Idempotent on purpose: Horus historically created application tables with
-- `prisma db push` and used Prisma migrations for RLS. A database that already
-- received db push must still be able to run `prisma migrate deploy`, while a
-- fresh database needs these tables before the following RLS migration.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketplaceKind') THEN
    CREATE TYPE "MarketplaceKind" AS ENUM ('INDEX', 'MCP');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketplaceStatus') THEN
    CREATE TYPE "MarketplaceStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketplaceVisibility') THEN
    CREATE TYPE "MarketplaceVisibility" AS ENUM ('PUBLIC', 'UNLISTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  tagline text NOT NULL,
  description text NOT NULL,
  kind "MarketplaceKind" NOT NULL,
  status "MarketplaceStatus" NOT NULL DEFAULT 'DRAFT',
  visibility "MarketplaceVisibility" NOT NULL DEFAULT 'PUBLIC',
  category text NOT NULL DEFAULT 'general',
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  "samplePrompts" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "minPlan" "Plan" NOT NULL DEFAULT 'FREE',
  verified boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  "publisherTenantId" uuid,
  "publisherName" text NOT NULL DEFAULT 'Horus',
  "collectionId" uuid,
  "connectionId" uuid,
  "upstreamEndpoint" text,
  "createdById" uuid,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT marketplace_listings_publisher_tenant_fkey
    FOREIGN KEY ("publisherTenantId") REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT marketplace_listings_collection_fkey
    FOREIGN KEY ("collectionId") REFERENCES knowledge_collections(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT marketplace_listings_connection_fkey
    FOREIGN KEY ("connectionId") REFERENCES connections(id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS marketplace_listings_status_visibility_idx
  ON marketplace_listings(status, visibility);
CREATE INDEX IF NOT EXISTS marketplace_listings_publisher_tenant_idx
  ON marketplace_listings("publisherTenantId");
CREATE INDEX IF NOT EXISTS marketplace_listings_kind_category_idx
  ON marketplace_listings(kind, category);

CREATE TABLE IF NOT EXISTS marketplace_installs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "listingSlug" text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  "installedBy" uuid NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT marketplace_installs_tenant_fkey
    FOREIGN KEY ("tenantId") REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT marketplace_installs_tenant_listing_key
    UNIQUE ("tenantId", "listingSlug")
);

CREATE INDEX IF NOT EXISTS marketplace_installs_tenant_enabled_idx
  ON marketplace_installs("tenantId", enabled);
CREATE INDEX IF NOT EXISTS marketplace_installs_listing_slug_idx
  ON marketplace_installs("listingSlug");
