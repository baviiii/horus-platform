import Link from 'next/link';
import { headers } from 'next/headers';
import { ArrowUpRight } from 'lucide-react';
import { prisma } from '@horus/db';
import { hasScope } from '@horus/auth';
import {
  isMissingMarketplaceTable,
  listInstalledMarketplaceSlugs,
  listMarketplaceCatalog,
} from '@horus/core/marketplace';
import { PageHeader, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { MarketplaceWorkspaceClient } from './marketplace-workspace-client';

export const metadata = { title: 'Marketplace & MCP · Horus' };
export const dynamic = 'force-dynamic';

export default async function TenantMarketplacePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const [{ tenant: slug }, sp] = await Promise.all([params, searchParams]);
  const { tenant, user } = await requireTenantMember(slug);

  const [
    listings,
    installedSlugs,
    collections,
    mcpConnections,
    indexedDocsCount,
    apiKeys,
    myPublished,
  ] = await Promise.all([
    listMarketplaceCatalog({ includeTenantDraftsFor: tenant.id }),
    listInstalledMarketplaceSlugs(tenant.id),
    prisma.knowledgeCollection.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { documents: true } } },
    }),
    prisma.connection.findMany({
      where: { tenantId: tenant.id, kind: 'MCP' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, slug: true, endpoint: true },
    }),
    prisma.document.count({ where: { tenantId: tenant.id, status: 'INDEXED' } }),
    prisma.apiKey.findMany({
      where: { tenantId: tenant.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true },
    }),
    prisma.marketplaceListing
      .findMany({
        where: { publisherTenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          tagline: true,
          kind: true,
          status: true,
          visibility: true,
          category: true,
          minPlan: true,
        },
      })
      .catch((err: unknown) => {
        if (isMissingMarketplaceTable(err)) return [];
        throw err;
      }),
  ]);

  const mcpCapableKeys = apiKeys
    .filter(
      (k) =>
        hasScope(k.scopes, 'mcp:call') ||
        hasScope(k.scopes, 'marketplace:read') ||
        hasScope(k.scopes, 'rag:read'),
    )
    .map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    }));

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${proto}://${host}`;

  const canManage = user.role === 'OWNER' || user.role === 'ADMIN';
  const canInstall = user.role !== 'VIEWER';

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        eyebrow="Marketplace & MCP Hub"
        title="Indexes & MCPs, inside and out."
        description="Attach curated knowledge indexes and MCP servers to your workspace agents, connect external platforms like Cursor and Claude Desktop to your own index, or publish to the Horus directory."
        actions={
          <Link
            href="/marketplace"
            target="_blank"
            className="border-hairline-strong bg-paper text-ink hover:border-accent/50 hover:text-accent inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors"
          >
            Public directory
            <ArrowUpRight size={14} />
          </Link>
        }
      />

      <div className="reveal-stagger mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Catalog listings" value={String(listings.length)} />
        <StatCard label="Enabled in chat" value={String(installedSlugs.length)} />
        <StatCard label="Your indexed docs" value={indexedDocsCount.toLocaleString()} />
        <StatCard label="External MCP keys" value={String(mcpCapableKeys.length)} />
      </div>

      <Reveal as="div">
        <MarketplaceWorkspaceClient
          tenantSlug={slug}
          tenantPlan={tenant.plan}
          canManage={canManage}
          canInstall={canInstall}
          origin={origin}
          initialFocusSlug={sp.focus}
          listings={listings}
          installedSlugs={installedSlugs}
          collections={collections.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            documentCount: c._count.documents,
          }))}
          mcpConnections={mcpConnections}
          myPublished={myPublished}
          existingKeys={mcpCapableKeys}
        />
      </Reveal>
    </div>
  );
}
