'use client';

import * as React from 'react';
import { useActionState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Database,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Plug,
  Plus,
  Trash2,
} from 'lucide-react';
import type { MarketplaceCatalogItem, MarketplacePlan } from '@horus/core/marketplace';
import { Panel, Pill } from '@/components/app/shell';
import { SnippetTabs } from '@/components/marketplace/snippet-tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { trpc } from '@/lib/trpc/client';
import { mintMarketplaceKeyAction, type MintMarketplaceKeyResult } from './actions';

interface CollectionSummary {
  id: string;
  name: string;
  slug: string;
  documentCount: number;
}

interface McpConnectionSummary {
  id: string;
  name: string;
  slug: string;
  endpoint: string;
}

interface PublishedSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  kind: 'INDEX' | 'MCP';
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  visibility: 'PUBLIC' | 'UNLISTED';
  category: string;
  minPlan: MarketplacePlan;
}

interface ExistingKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
}

const inputCls =
  'border-hairline-strong bg-paper text-ink placeholder:text-ink-mute w-full rounded-xl border px-3.5 py-2 text-[13px] focus:border-accent outline-none';

export function MarketplaceWorkspaceClient({
  tenantSlug,
  tenantPlan,
  canManage,
  canInstall,
  origin,
  initialFocusSlug,
  listings,
  installedSlugs,
  collections,
  mcpConnections,
  myPublished,
  existingKeys,
}: {
  tenantSlug: string;
  tenantPlan: MarketplacePlan;
  canManage: boolean;
  canInstall: boolean;
  origin: string;
  initialFocusSlug?: string;
  listings: MarketplaceCatalogItem[];
  installedSlugs: string[];
  collections: CollectionSummary[];
  mcpConnections: McpConnectionSummary[];
  myPublished: PublishedSummary[];
  existingKeys: ExistingKeySummary[];
}) {
  const router = useRouter();
  const [view, setView] = React.useState<'catalog' | 'connect' | 'publish'>(
    initialFocusSlug === 'workspace' ? 'connect' : 'catalog',
  );
  const [selectedSlug, setSelectedSlug] = React.useState<string>(
    initialFocusSlug && listings.some((l) => l.slug === initialFocusSlug)
      ? initialFocusSlug
      : 'workspace',
  );
  const [selectedCollectionSlug, setSelectedCollectionSlug] = React.useState<string>('');
  const [actionError, setActionError] = React.useState<string | null>(null);

  const mintAction = mintMarketplaceKeyAction.bind(null, tenantSlug);
  const [mintResult, mintFormAction, mintPending] = useActionState<
    MintMarketplaceKeyResult | null,
    FormData
  >(mintAction, null);

  // Publish form state
  const [pubKind, setPubKind] = React.useState<'INDEX' | 'MCP'>('INDEX');
  const [pubName, setPubName] = React.useState('');
  const [pubSlug, setPubSlug] = React.useState('');
  const [pubTagline, setPubTagline] = React.useState('');
  const [pubDescription, setPubDescription] = React.useState('');
  const [pubCategory, setPubCategory] = React.useState('general');
  const [pubVisibility, setPubVisibility] = React.useState<'PUBLIC' | 'UNLISTED'>('PUBLIC');
  const [pubMinPlan, setPubMinPlan] = React.useState<MarketplacePlan>('FREE');
  const [pubCollectionId, setPubCollectionId] = React.useState<string>('');
  const [pubConnectionId, setPubConnectionId] = React.useState<string>(mcpConnections[0]?.id ?? '');
  const [pubEndpoint, setPubEndpoint] = React.useState('');
  const [pubTags, setPubTags] = React.useState('');
  const [pubSamplePrompt, setPubSamplePrompt] = React.useState('');

  const installMut = trpc.marketplace.setInstalled.useMutation({
    onSuccess: () => {
      setActionError(null);
      router.refresh();
    },
    onError: (e) => setActionError(e.message),
  });

  const publishMut = trpc.marketplace.publish.useMutation({
    onSuccess: (created) => {
      setActionError(null);
      setPubName('');
      setPubSlug('');
      setPubTagline('');
      setPubDescription('');
      setPubTags('');
      setPubSamplePrompt('');
      setSelectedSlug(created.slug);
      router.refresh();
    },
    onError: (e) => setActionError(e.message),
  });

  const updateStatusMut = trpc.marketplace.updateStatus.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setActionError(e.message),
  });

  const deleteMut = trpc.marketplace.deleteListing.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setActionError(e.message),
  });

  const installedSet = React.useMemo(() => new Set(installedSlugs), [installedSlugs]);
  const selectedListing =
    listings.find((l) => l.slug === selectedSlug) ??
    listings.find((l) => l.slug === 'workspace') ??
    listings[0]!;

  const installableListings = listings.filter((l) => l.slug !== 'workspace');

  function handleSelectForExternalConnect(slug: string) {
    setSelectedSlug(slug);
    setView('connect');
  }

  async function onPublishSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    await publishMut.mutateAsync({
      slug: pubSlug.trim().toLowerCase(),
      name: pubName.trim(),
      tagline: pubTagline.trim(),
      description: pubDescription.trim(),
      kind: pubKind,
      visibility: pubVisibility,
      category: pubCategory.trim() || 'general',
      minPlan: pubMinPlan,
      tags: pubTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8),
      samplePrompts: pubSamplePrompt.trim() ? [pubSamplePrompt.trim()] : [],
      collectionId: pubKind === 'INDEX' ? pubCollectionId || null : null,
      connectionId: pubKind === 'MCP' && pubConnectionId ? pubConnectionId : null,
      upstreamEndpoint:
        pubKind === 'MCP' && !pubConnectionId && pubEndpoint.trim() ? pubEndpoint.trim() : null,
    });
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs */}
      <div className="border-hairline bg-paper-soft inline-flex flex-wrap items-center gap-1 rounded-2xl border p-1.5">
        {(
          [
            ['catalog', `Browse & Attach (${installableListings.length})`],
            ['connect', 'External MCP & API Access'],
            ...(canManage ? [['publish', `Publish (${myPublished.length})`] as const] : []),
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              'rounded-xl px-4 py-2 text-[13px] font-medium transition-all',
              view === id
                ? 'bg-paper text-ink ring-accent/25 shadow-sm ring-1'
                : 'text-ink-faded hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-500">
          {actionError}
        </div>
      )}

      {/* ─── TAB 1: BROWSE & ATTACH TO WORKSPACE ─── */}
      {view === 'catalog' && (
        <div className="space-y-6">
          {/* Own Workspace Bridge highlight card */}
          <div className="border-accent/30 bg-accent/5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <Pill tone="accent">Your Workspace Bridge</Pill>
                <span className="font-technical text-ink-mute text-[11.5px]">
                  /api/mcp/workspace
                </span>
              </div>
              <h3 className="text-ink mt-2 text-[15.5px] font-semibold">
                Access this workspace’s own documents &amp; knowledge graph from external platforms
              </h3>
              <p className="text-ink-faded mt-1 text-[13px] leading-relaxed">
                Every PDF, URL, collection, and entity in <strong>{tenantSlug}</strong> is already
                reachable over Streamable-HTTP MCP and REST v1 with a scoped workspace key.
              </p>
            </div>
            <Button size="sm" onClick={() => handleSelectForExternalConnect('workspace')}>
              <KeyRound size={14} />
              Connect external app
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {installableListings.map((item) => {
              const installed = installedSet.has(item.slug);
              const busy = installMut.isPending && installMut.variables?.slug === item.slug;

              return (
                <div
                  key={item.slug}
                  className={cn(
                    'border-hairline bg-paper flex flex-col justify-between rounded-2xl border p-5 transition-colors',
                    initialFocusSlug === item.slug && 'border-accent ring-accent/20 ring-2',
                  )}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Pill tone={item.kind === 'INDEX' ? 'accent' : 'success'}>
                          {item.kind === 'INDEX' ? <Database size={11} /> : <Plug size={11} />}
                          {item.kind === 'INDEX' ? 'Index + Graph' : 'MCP Server'}
                        </Pill>
                        <Pill>{item.minPlan}</Pill>
                        {installed && <Pill tone="success">Active in chat</Pill>}
                      </div>

                      <Link
                        href={`/marketplace/${item.slug}`}
                        target="_blank"
                        className="text-ink-mute hover:text-accent inline-flex items-center gap-1 text-[12px] transition-colors"
                      >
                        Public page <ArrowUpRight size={13} />
                      </Link>
                    </div>

                    <h3 className="text-ink mt-3 text-[16px] font-semibold tracking-tight">
                      {item.name}
                    </h3>
                    <div className="text-ink-mute mt-0.5 flex items-center gap-1 text-[12px]">
                      <span>by {item.publisherName}</span>
                      {item.verified && <CheckCircle2 size={12} className="text-accent" />}
                    </div>

                    <p className="text-ink-faded mt-2.5 text-[13.5px] leading-relaxed">
                      {item.tagline}
                    </p>

                    <div className="mt-3.5 flex flex-wrap gap-1.5">
                      {item.tools.slice(0, 4).map((t) => (
                        <span
                          key={t.name}
                          className="border-hairline bg-paper-soft font-technical text-ink-faded rounded-full border px-2.5 py-0.5 text-[10.5px]"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="border-hairline mt-5 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <button
                      type="button"
                      onClick={() => handleSelectForExternalConnect(item.slug)}
                      className="text-accent text-[12.5px] font-medium hover:underline"
                    >
                      MCP / REST snippets →
                    </button>

                    {canInstall ? (
                      <Button
                        size="sm"
                        variant={installed ? 'outline' : 'default'}
                        disabled={busy}
                        onClick={() => installMut.mutate({ slug: item.slug, enabled: !installed })}
                      >
                        {busy ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : installed ? (
                          <Check size={13} className="text-emerald-500" />
                        ) : (
                          <Plus size={13} />
                        )}
                        {installed ? 'Enabled in workspace' : 'Enable in workspace'}
                      </Button>
                    ) : (
                      <span className="text-ink-mute text-[12px]">Viewer (read-only)</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── TAB 2: EXTERNAL MCP & API ACCESS ─── */}
      {view === 'connect' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-5">
            <Panel
              title="1 · Choose target endpoint"
              description="Pick your own workspace corpus or any published Marketplace Index / MCP."
            >
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-ink-faded text-[12px] font-medium">
                    Target Index or MCP Server
                  </span>
                  <select
                    value={selectedSlug}
                    onChange={(e) => setSelectedSlug(e.target.value)}
                    className={inputCls}
                  >
                    {listings.map((l) => (
                      <option key={l.slug} value={l.slug}>
                        {l.slug === 'workspace'
                          ? `Your Workspace Index (${tenantSlug})`
                          : `${l.name} (${l.kind})`}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedSlug === 'workspace' && collections.length > 0 && (
                  <label className="block space-y-1.5">
                    <span className="text-ink-faded text-[12px] font-medium">
                      Collection scope (optional)
                    </span>
                    <select
                      value={selectedCollectionSlug}
                      onChange={(e) => setSelectedCollectionSlug(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Entire workspace knowledge base</option>
                      {collections.map((c) => (
                        <option key={c.id} value={c.slug}>
                          {c.name} ({c.documentCount} docs)
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="border-hairline bg-paper-soft rounded-xl border p-3 text-[12px]">
                  <div className="text-ink-mute font-medium">Streamable-HTTP MCP URL</div>
                  <code className="font-technical text-accent mt-1 block break-all">
                    {origin}/api/mcp/{selectedSlug}
                    {selectedSlug === 'workspace' && selectedCollectionSlug
                      ? `?collection=${selectedCollectionSlug}`
                      : ''}
                  </code>
                </div>
              </div>
            </Panel>

            <Panel
              title="2 · Mint scoped API key"
              description="Grants read-only MCP & Index access (marketplace:read, mcp:call, rag:read, graph:read)."
            >
              {canManage ? (
                <div className="space-y-3">
                  <form action={mintFormAction} className="flex flex-col gap-2 sm:flex-row">
                    <input
                      name="name"
                      placeholder="Key label (e.g. Cursor IDE · MacBook)"
                      maxLength={80}
                      className={cn(inputCls, 'flex-1')}
                    />
                    <Button type="submit" size="sm" disabled={mintPending}>
                      {mintPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <KeyRound size={13} />
                      )}
                      Mint key
                    </Button>
                  </form>

                  {mintResult?.error && (
                    <p className="text-destructive text-[12.5px]">{mintResult.error}</p>
                  )}

                  {mintResult?.ok && mintResult.plaintext && (
                    <div className="border-accent/40 bg-accent-soft rounded-xl border p-3.5">
                      <p className="text-ink text-[12.5px] font-semibold">
                        Key minted &amp; injected into the snippets on the right — copy it now!
                      </p>
                      <code className="font-technical text-ink mt-2 block select-all break-all rounded-lg bg-black/10 p-2.5 text-[11.5px] dark:bg-white/10">
                        {mintResult.plaintext}
                      </code>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-ink-faded text-[13px]">
                  Ask a workspace <strong>Owner</strong> or <strong>Admin</strong> to mint an
                  external API key. Your current plan is <strong>{tenantPlan}</strong>.
                </p>
              )}

              {existingKeys.length > 0 && (
                <div className="border-hairline mt-4 border-t pt-3">
                  <div className="flex items-center justify-between text-[11.5px]">
                    <span className="text-ink-mute font-medium uppercase tracking-wider">
                      Active MCP-capable keys ({existingKeys.length})
                    </span>
                    <Link
                      href={`/t/${tenantSlug}/settings`}
                      className="text-accent hover:underline"
                    >
                      Manage in Settings
                    </Link>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {existingKeys.slice(0, 4).map((k) => (
                      <li
                        key={k.id}
                        className="text-ink-faded flex items-center justify-between text-[12px]"
                      >
                        <span className="text-ink truncate font-medium">{k.name}</span>
                        <span className="font-technical text-ink-mute">{k.keyPrefix}…</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-7">
            <Panel
              title="3 · Paste into Cursor, Claude Desktop, or your platform"
              description={`Ready-to-run configuration for ${selectedListing.name}.`}
            >
              <SnippetTabs
                origin={origin}
                slug={selectedListing.slug}
                kind={selectedListing.kind}
                firstToolName={selectedListing.tools[0]?.name}
                sampleQuery={selectedListing.samplePrompts[0]}
                apiKey={mintResult?.plaintext ?? null}
                collectionSlug={
                  selectedListing.slug === 'workspace' && selectedCollectionSlug
                    ? selectedCollectionSlug
                    : null
                }
              />
            </Panel>
          </div>
        </div>
      )}

      {/* ─── TAB 3: PUBLISH TO MARKETPLACE ─── */}
      {view === 'publish' && canManage && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Panel
              title="Publish an Index or MCP Server"
              description="Share a curated Knowledge Collection or MCP tool server publicly on Horus Marketplace or as an unlisted slug."
            >
              <form onSubmit={onPublishSubmit} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">Listing type</span>
                    <select
                      value={pubKind}
                      onChange={(e) => setPubKind(e.target.value as 'INDEX' | 'MCP')}
                      className={inputCls}
                    >
                      <option value="INDEX">Knowledge Index + Graph</option>
                      <option value="MCP">MCP Tool Server</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">Visibility</span>
                    <select
                      value={pubVisibility}
                      onChange={(e) => setPubVisibility(e.target.value as 'PUBLIC' | 'UNLISTED')}
                      className={inputCls}
                    >
                      <option value="PUBLIC">Public (listed on /marketplace)</option>
                      <option value="UNLISTED">Unlisted (direct slug &amp; API key only)</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">Display name</span>
                    <input
                      value={pubName}
                      onChange={(e) => {
                        setPubName(e.target.value);
                        if (!pubSlug) {
                          setPubSlug(
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, '-')
                              .replace(/(^-|-$)/g, '')
                              .slice(0, 44),
                          );
                        }
                      }}
                      placeholder="e.g. SA Clean Energy Policy Index"
                      required
                      minLength={3}
                      maxLength={80}
                      className={inputCls}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">
                      URL &amp; MCP slug
                    </span>
                    <input
                      value={pubSlug}
                      onChange={(e) => setPubSlug(e.target.value.toLowerCase())}
                      placeholder="sa-clean-energy-index"
                      required
                      pattern="[a-z0-9][a-z0-9-]{2,46}[a-z0-9]"
                      className={cn(inputCls, 'font-technical')}
                    />
                  </label>
                </div>

                {pubKind === 'INDEX' ? (
                  <label className="block space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">
                      Backing knowledge source
                    </span>
                    <select
                      value={pubCollectionId}
                      onChange={(e) => setPubCollectionId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Entire workspace indexed corpus</option>
                      {collections.map((c) => (
                        <option key={c.id} value={c.id}>
                          Collection: {c.name} ({c.documentCount} documents)
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="space-y-3">
                    {mcpConnections.length > 0 && (
                      <label className="block space-y-1">
                        <span className="text-ink-faded text-[12px] font-medium">
                          Workspace MCP Connection
                        </span>
                        <select
                          value={pubConnectionId}
                          onChange={(e) => setPubConnectionId(e.target.value)}
                          className={inputCls}
                        >
                          <option value="">Use custom HTTPS MCP URL below…</option>
                          {mcpConnections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.endpoint})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {!pubConnectionId && (
                      <label className="block space-y-1">
                        <span className="text-ink-faded text-[12px] font-medium">
                          Upstream Streamable-HTTP MCP URL
                        </span>
                        <input
                          type="url"
                          value={pubEndpoint}
                          onChange={(e) => setPubEndpoint(e.target.value)}
                          placeholder="https://mcp.example.com/mcp"
                          required={!pubConnectionId}
                          className={cn(inputCls, 'font-technical')}
                        />
                      </label>
                    )}
                  </div>
                )}

                <label className="block space-y-1">
                  <span className="text-ink-faded text-[12px] font-medium">One-line tagline</span>
                  <input
                    value={pubTagline}
                    onChange={(e) => setPubTagline(e.target.value)}
                    placeholder="Concise summary shown on Marketplace cards (8–160 chars)"
                    required
                    minLength={8}
                    maxLength={160}
                    className={inputCls}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-ink-faded text-[12px] font-medium">Description</span>
                  <textarea
                    value={pubDescription}
                    onChange={(e) => setPubDescription(e.target.value)}
                    rows={3}
                    placeholder="What sources or tools are included, update cadence, and ideal use cases."
                    required
                    minLength={16}
                    maxLength={2400}
                    className={inputCls}
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">Category</span>
                    <input
                      value={pubCategory}
                      onChange={(e) => setPubCategory(e.target.value)}
                      placeholder="government-policy"
                      className={inputCls}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">Minimum plan</span>
                    <select
                      value={pubMinPlan}
                      onChange={(e) => setPubMinPlan(e.target.value as MarketplacePlan)}
                      className={inputCls}
                    >
                      <option value="FREE">FREE</option>
                      <option value="STARTER">STARTER</option>
                      <option value="PRO">PRO</option>
                      <option value="SCALE">SCALE</option>
                      <option value="ENTERPRISE">ENTERPRISE</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-ink-faded text-[12px] font-medium">Tags (comma)</span>
                    <input
                      value={pubTags}
                      onChange={(e) => setPubTags(e.target.value)}
                      placeholder="policy, energy, sa"
                      className={inputCls}
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-ink-faded text-[12px] font-medium">
                    Example starter prompt (optional)
                  </span>
                  <input
                    value={pubSamplePrompt}
                    onChange={(e) => setPubSamplePrompt(e.target.value)}
                    placeholder="What hydrogen targets are funded in the 2026 strategy?"
                    className={inputCls}
                  />
                </label>

                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={publishMut.isPending}>
                    {publishMut.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Globe size={14} />
                    )}
                    Publish listing
                  </Button>
                </div>
              </form>
            </Panel>
          </div>

          <div className="lg:col-span-5">
            <Panel
              title="Published by this workspace"
              description="Toggle public visibility, pause access, or remove listings."
            >
              {myPublished.length === 0 ? (
                <p className="text-ink-faded py-2 text-[13.5px]">
                  Nothing published yet. Any Knowledge Collection or MCP connection you publish
                  immediately gets its own `/api/mcp/&lt;slug&gt;` and `/marketplace/&lt;slug&gt;`
                  endpoints.
                </p>
              ) : (
                <ul className="divide-hairline -my-2 divide-y">
                  {myPublished.map((p) => (
                    <li key={p.id} className="space-y-2.5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/marketplace/${p.slug}`}
                              target="_blank"
                              className="text-ink hover:text-accent text-[14px] font-semibold transition-colors"
                            >
                              {p.name}
                            </Link>
                            <Pill tone={p.status === 'PUBLISHED' ? 'success' : 'warn'}>
                              {p.status.toLowerCase()}
                            </Pill>
                            <Pill>
                              {p.visibility === 'PUBLIC' ? <Globe size={10} /> : <Lock size={10} />}
                              {p.visibility.toLowerCase()}
                            </Pill>
                          </div>
                          <div className="font-technical text-ink-mute mt-0.5 text-[11.5px]">
                            /api/mcp/{p.slug}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateStatusMut.mutate({
                                id: p.id,
                                status: p.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED',
                              })
                            }
                          >
                            {p.status === 'PUBLISHED' ? 'Pause' : 'Publish'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteMut.mutate({ id: p.id })}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
