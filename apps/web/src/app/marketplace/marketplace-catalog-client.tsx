'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, Database, Plug, Search, Sparkles } from 'lucide-react';
import type { MarketplaceCatalogItem } from '@horus/core/marketplace';
import { cn } from '@/lib/cn';

export function MarketplaceCatalogClient({
  listings,
  primaryWorkspaceSlug,
  signedIn,
}: {
  listings: MarketplaceCatalogItem[];
  primaryWorkspaceSlug: string | null;
  signedIn: boolean;
}) {
  const [kindFilter, setKindFilter] = React.useState<'ALL' | 'INDEX' | 'MCP'>('ALL');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('ALL');
  const [search, setSearch] = React.useState('');

  const categories = React.useMemo(() => {
    return ['ALL', ...new Set(listings.map((l) => l.category))];
  }, [listings]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings.filter((item) => {
      if (kindFilter !== 'ALL' && item.kind !== kindFilter) return false;
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.tagline.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.tools.some((t) => t.name.toLowerCase().includes(q))
      );
    });
  }, [listings, kindFilter, categoryFilter, search]);

  return (
    <div className="space-y-8">
      {/* Filter & search bar */}
      <div className="border-hairline bg-paper-soft/80 flex flex-col gap-4 rounded-3xl border p-4 backdrop-blur-md md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['ALL', 'All listings', listings.length],
              ['INDEX', 'Knowledge Indexes', listings.filter((l) => l.kind === 'INDEX').length],
              ['MCP', 'MCP Servers', listings.filter((l) => l.kind === 'MCP').length],
            ] as const
          ).map(([k, label, count]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-all',
                kindFilter === k
                  ? 'bg-ink text-paper shadow-sm'
                  : 'text-ink-faded hover:bg-paper hover:text-ink',
              )}
            >
              <span>{label}</span>
              <span
                className={cn(
                  'num rounded-full px-1.5 py-0.5 text-[10.5px]',
                  kindFilter === k ? 'bg-paper/20 text-paper' : 'bg-paper text-ink-mute',
                )}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-w-[260px] md:w-80">
          <Search
            size={15}
            className="text-ink-mute pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search indexes, MCP tools, tags…"
            className="border-hairline-strong bg-paper text-ink placeholder:text-ink-mute focus:border-accent h-10 w-full rounded-full border pl-9 pr-4 text-[13px] outline-none"
          />
        </div>
      </div>

      {/* Category pills */}
      {categories.length > 2 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-technical text-ink-mute mr-1 text-[10.5px] uppercase tracking-[0.18em]">
            Domain
          </span>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] font-medium capitalize transition-colors',
                categoryFilter === cat
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-hairline bg-paper text-ink-faded hover:border-hairline-strong hover:text-ink',
              )}
            >
              {cat === 'ALL' ? 'All domains' : cat.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Cards grid */}
      {filtered.length === 0 ? (
        <div className="border-hairline bg-paper rounded-3xl border p-12 text-center">
          <p className="text-ink text-base font-medium">No listings match that filter.</p>
          <p className="text-ink-faded mt-1 text-[14px]">
            Clear your search or switch back to all listings.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <article
              key={item.slug}
              className="border-hairline bg-paper hover:border-accent/45 group relative flex flex-col justify-between overflow-hidden rounded-3xl border p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
            >
              <div className="via-accent/50 pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

              <div>
                {/* Header badges */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                      item.kind === 'INDEX'
                        ? 'border-accent/25 bg-accent/10 text-accent'
                        : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {item.kind === 'INDEX' ? <Database size={12} /> : <Plug size={12} />}
                    {item.kind === 'INDEX' ? 'Knowledge Index + MCP' : 'MCP Tool Server'}
                  </span>

                  <div className="flex items-center gap-1.5">
                    {item.featured && (
                      <span className="bg-accent-soft text-accent inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium">
                        <Sparkles size={10} />
                        Featured
                      </span>
                    )}
                    <span className="border-hairline text-ink-mute font-technical rounded-full border px-2 py-0.5 text-[10px] uppercase">
                      {item.minPlan}
                    </span>
                  </div>
                </div>

                {/* Title & publisher */}
                <Link href={`/marketplace/${item.slug}`} className="mt-5 block">
                  <h3 className="text-ink group-hover:text-accent text-xl font-semibold leading-snug tracking-tight transition-colors">
                    {item.name}
                  </h3>
                </Link>

                <div className="text-ink-mute mt-1.5 flex items-center gap-1.5 text-[12px]">
                  <span>by {item.publisherName}</span>
                  {item.verified && (
                    <span
                      title="Verified Horus publisher"
                      className="text-accent inline-flex items-center gap-0.5 font-medium"
                    >
                      <CheckCircle2 size={12} />
                    </span>
                  )}
                </div>

                <p className="text-ink-faded mt-3 text-[14px] leading-relaxed">{item.tagline}</p>

                {/* Metrics / Capabilities preview */}
                {item.stats ? (
                  <div className="border-hairline bg-paper-soft mt-5 grid grid-cols-3 gap-2 rounded-2xl border p-3 text-center">
                    <div>
                      <div className="num text-ink text-sm font-semibold">
                        {item.stats.documents.toLocaleString()}
                      </div>
                      <div className="text-ink-mute text-[10.5px]">Docs</div>
                    </div>
                    <div>
                      <div className="num text-ink text-sm font-semibold">
                        {item.stats.chunks.toLocaleString()}
                      </div>
                      <div className="text-ink-mute text-[10.5px]">Chunks</div>
                    </div>
                    <div>
                      <div className="num text-ink text-sm font-semibold">
                        {item.stats.entities.toLocaleString()}
                      </div>
                      <div className="text-ink-mute text-[10.5px]">Entities</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {item.tools.slice(0, 4).map((t) => (
                      <span
                        key={t.name}
                        className="border-hairline bg-paper-soft font-technical text-ink-soft rounded-lg border px-2 py-1 text-[11px]"
                      >
                        {t.name}()
                      </span>
                    ))}
                    {item.tools.length > 4 && (
                      <span className="text-ink-mute self-center text-[11px]">
                        +{item.tools.length - 4} more
                      </span>
                    )}
                  </div>
                )}

                {/* Protocol tags */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="border-hairline text-ink-mute font-technical rounded-full border px-2 py-0.5 text-[10px]">
                    MCP HTTP
                  </span>
                  <span className="border-hairline text-ink-mute font-technical rounded-full border px-2 py-0.5 text-[10px]">
                    REST v1
                  </span>
                  <span className="border-hairline text-ink-mute font-technical rounded-full border px-2 py-0.5 text-[10px]">
                    @horus/sdk
                  </span>
                </div>
              </div>

              {/* Footer CTAs */}
              <div className="border-hairline mt-6 flex items-center justify-between gap-2 border-t pt-4">
                <Link
                  href={`/marketplace/${item.slug}`}
                  className="text-ink group-hover:text-accent inline-flex items-center gap-1 text-[13px] font-medium transition-colors"
                >
                  Inspect &amp; connect
                  <ArrowUpRight size={14} />
                </Link>

                {signedIn && primaryWorkspaceSlug ? (
                  <Link
                    href={`/t/${primaryWorkspaceSlug}/marketplace?focus=${encodeURIComponent(item.slug)}`}
                    className="border-accent/30 bg-accent/8 text-accent hover:bg-accent rounded-full border px-3 py-1 text-[12px] font-medium transition-colors hover:text-white"
                  >
                    {item.slug === 'workspace' ? 'Get MCP key' : 'Use in workspace'}
                  </Link>
                ) : (
                  <Link
                    href={`/login?next=${encodeURIComponent(`/marketplace/${item.slug}`)}`}
                    className="border-hairline text-ink-faded hover:border-hairline-strong hover:text-ink rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
