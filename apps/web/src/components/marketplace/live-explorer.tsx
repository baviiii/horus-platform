'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Play, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface WorkspaceOption {
  slug: string;
  name: string;
  plan: string;
}

interface ToolOption {
  name: string;
  description: string;
}

export function LiveExplorer({
  listingSlug,
  kind,
  samplePrompts,
  tools,
  workspaces,
  signedIn,
}: {
  listingSlug: string;
  kind: 'INDEX' | 'MCP';
  samplePrompts: string[];
  tools: ToolOption[];
  workspaces: WorkspaceOption[];
  signedIn: boolean;
}) {
  const [workspace, setWorkspace] = React.useState(workspaces[0]?.slug ?? '');
  const [mode, setMode] = React.useState<'search' | 'ask' | 'graph' | 'tools' | 'call'>(
    kind === 'INDEX' ? 'search' : 'tools',
  );
  const [query, setQuery] = React.useState(samplePrompts[0] ?? '');
  const [entity, setEntity] = React.useState('TAFE SA');
  const [selectedTool, setSelectedTool] = React.useState(tools[0]?.name ?? '');
  const [toolArgsJson, setToolArgsJson] = React.useState(
    '{\n  "role": "Senior Software Engineer"\n}',
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [response, setResponse] = React.useState<Record<string, unknown> | null>(null);

  if (!signedIn) {
    return (
      <div className="border-hairline bg-paper-soft rounded-3xl border p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="font-technical text-accent text-[11px] font-medium uppercase tracking-[0.18em]">
              Interactive console
            </div>
            <h3 className="text-ink mt-2 text-xl font-semibold tracking-tight">
              Sign in to run live queries against this {kind === 'INDEX' ? 'index' : 'MCP server'}.
            </h3>
            <p className="text-ink-faded mt-1.5 text-[14px] leading-relaxed">
              Signed-in workspaces can test passages, grounded citations, knowledge graph edges, and
              MCP tool executions right here in the browser — or mint a scoped API key for Cursor,
              Claude Desktop, and external apps.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/login?next=${encodeURIComponent(`/marketplace/${listingSlug}`)}`}
              className="bg-ink text-paper hover:bg-ink-soft inline-flex h-10 items-center rounded-full px-5 text-[13.5px] font-medium transition-colors"
            >
              Sign in to test
            </Link>
            <Link
              href="/signup"
              className="border-hairline-strong bg-paper text-ink hover:border-accent/50 inline-flex h-10 items-center rounded-full border px-5 text-[13.5px] font-medium transition-colors"
            >
              Start free
            </Link>
          </div>
        </div>

        {samplePrompts.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {samplePrompts.map((p) => (
              <span
                key={p}
                className="border-hairline bg-paper text-ink-faded rounded-full border px-3 py-1 text-[12px]"
              >
                “{p}”
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResponse(null);
    setLoading(true);

    try {
      let payload: Record<string, unknown>;
      if (mode === 'search') {
        payload = { mode: 'search', query, topK: 6, ...(workspace && { tenant: workspace }) };
      } else if (mode === 'ask') {
        payload = { mode: 'ask', query, maxSources: 8, ...(workspace && { tenant: workspace }) };
      } else if (mode === 'graph') {
        payload = { mode: 'graph', entity, ...(workspace && { tenant: workspace }) };
      } else if (mode === 'tools') {
        payload = { mode: 'tools', ...(workspace && { tenant: workspace }) };
      } else {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolArgsJson || '{}') as Record<string, unknown>;
        } catch {
          setError('Tool arguments must be valid JSON.');
          setLoading(false);
          return;
        }
        payload = {
          mode: 'call',
          tool: selectedTool,
          arguments: parsedArgs,
          ...(workspace && { tenant: workspace }),
        };
      }

      const res = await fetch(`/api/v1/marketplace/${encodeURIComponent(listingSlug)}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      } else {
        setResponse(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  const hits = Array.isArray(response?.hits)
    ? (response.hits as Array<{
        rank: number;
        score: number;
        title: string;
        excerpt: string;
        sourceUrl?: string;
        pageNumber?: number;
      }>)
    : null;

  const sources = Array.isArray(response?.sources)
    ? (response.sources as Array<{
        n: number;
        title: string;
        sourceUrl?: string;
        pageNumber?: number;
      }>)
    : null;

  return (
    <div className="border-hairline bg-paper rounded-3xl border p-6 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-technical text-accent flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em]">
            <Sparkles size={12} />
            Live explorer
          </div>
          <h3 className="text-ink mt-1 text-lg font-semibold tracking-tight">
            Test right in your browser
          </h3>
        </div>

        {workspaces.length > 0 && (
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-ink-faded">Metered to:</span>
            <select
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="border-hairline bg-paper-soft text-ink rounded-lg border px-2.5 py-1 text-[12.5px] font-medium outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.slug} value={w.slug}>
                  {w.name} ({w.plan})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {kind === 'INDEX' ? (
          <>
            {(
              [
                ['search', 'Search passages'],
                ['ask', 'Grounded answer'],
                ['graph', 'Knowledge graph'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setResponse(null);
                  setError(null);
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                  mode === m
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-hairline bg-paper-soft text-ink-faded hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </>
        ) : (
          <>
            {(
              [
                ['tools', 'Inspect live tools'],
                ['call', 'Execute tool'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setResponse(null);
                  setError(null);
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                  mode === m
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-hairline bg-paper-soft text-ink-faded hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </>
        )}
      </div>

      <form onSubmit={onRun} className="mt-4 space-y-3">
        {(mode === 'search' || mode === 'ask') && (
          <>
            {samplePrompts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {samplePrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setQuery(p)}
                    className="border-hairline bg-paper-soft text-ink-faded hover:border-accent/40 hover:text-ink rounded-full border px-2.5 py-1 text-left text-[11.5px] transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask or search this knowledge index…"
                required
                className="border-hairline-strong bg-paper text-ink placeholder:text-ink-mute focus:border-accent h-10 flex-1 rounded-xl border px-3.5 text-[13.5px] outline-none"
              />
              <Button type="submit" disabled={loading || !query.trim()}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                Run
              </Button>
            </div>
          </>
        )}

        {mode === 'graph' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              placeholder="Entity name (e.g. TAFE SA, Fee-Free TAFE, Defence)…"
              required
              className="border-hairline-strong bg-paper text-ink placeholder:text-ink-mute focus:border-accent h-10 flex-1 rounded-xl border px-3.5 text-[13.5px] outline-none"
            />
            <Button type="submit" disabled={loading || !entity.trim()}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Traverse graph
            </Button>
          </div>
        )}

        {mode === 'tools' && (
          <div>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Probe MCP server tools
            </Button>
          </div>
        )}

        {mode === 'call' && (
          <div className="space-y-3">
            <select
              value={selectedTool}
              onChange={(e) => setSelectedTool(e.target.value)}
              className="border-hairline-strong bg-paper text-ink h-10 w-full rounded-xl border px-3 text-[13px] outline-none"
            >
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} — {t.description.slice(0, 72)}
                </option>
              ))}
            </select>
            <textarea
              value={toolArgsJson}
              onChange={(e) => setToolArgsJson(e.target.value)}
              rows={4}
              className="border-hairline-strong bg-paper font-technical text-ink w-full rounded-xl border p-3 text-[12px] outline-none"
              placeholder='{"key": "value"}'
            />
            <Button type="submit" disabled={loading || !selectedTool}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Call MCP tool
            </Button>
          </div>
        )}
      </form>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {response && (
        <div className="border-hairline bg-paper-soft mt-5 space-y-4 rounded-2xl border p-4">
          {typeof response.answer === 'string' && (
            <div className="space-y-3">
              <div className="text-ink whitespace-pre-wrap text-[14px] leading-relaxed">
                {response.answer}
              </div>
              {sources && sources.length > 0 && (
                <div className="border-hairline space-y-1.5 border-t pt-3">
                  <div className="font-technical text-ink-mute text-[10.5px] uppercase tracking-wider">
                    Citations ({sources.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sources.map((s) =>
                      s.sourceUrl ? (
                        <a
                          key={s.n}
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="border-hairline bg-paper text-ink-soft hover:border-accent/50 hover:text-accent inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors"
                        >
                          <span className="font-technical text-accent font-semibold">[{s.n}]</span>
                          <span className="max-w-[240px] truncate">{s.title}</span>
                          {s.pageNumber !== undefined && (
                            <span className="text-ink-mute">p.{s.pageNumber}</span>
                          )}
                          <ExternalLink size={11} />
                        </a>
                      ) : (
                        <span
                          key={s.n}
                          className="border-hairline bg-paper text-ink-soft inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px]"
                        >
                          <span className="font-technical text-accent font-semibold">[{s.n}]</span>
                          <span className="max-w-[240px] truncate">{s.title}</span>
                          {s.pageNumber !== undefined && (
                            <span className="text-ink-mute">p.{s.pageNumber}</span>
                          )}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {hits && (
            <div className="space-y-2.5">
              <div className="font-technical text-ink-mute text-[11px] uppercase tracking-wider">
                {hits.length} retrieved passage{hits.length === 1 ? '' : 's'}
              </div>
              {hits.length === 0 ? (
                <p className="text-ink-faded text-[13px]">No passages matched this query.</p>
              ) : (
                hits.map((h) => (
                  <div
                    key={`${h.rank}-${h.title}`}
                    className="border-hairline bg-paper rounded-xl border p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-ink text-[13px] font-semibold">
                        <span className="font-technical text-accent mr-1.5">[{h.rank}]</span>
                        {h.title}
                        {h.pageNumber !== undefined && (
                          <span className="text-ink-mute ml-1.5 font-normal">
                            · p. {h.pageNumber}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-technical text-ink-mute text-[11px]">
                          score {h.score.toFixed(3)}
                        </span>
                        {h.sourceUrl && (
                          <a
                            href={h.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent inline-flex items-center gap-1 text-[11.5px] hover:underline"
                          >
                            Source <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                    <p className="text-ink-faded mt-2 line-clamp-4 text-[12.5px] leading-relaxed">
                      {h.excerpt}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {typeof response.summaryText === 'string' && (
            <pre className="font-technical text-ink overflow-x-auto whitespace-pre-wrap text-[12px] leading-relaxed">
              {response.summaryText}
            </pre>
          )}

          {typeof response.output === 'string' && (
            <pre className="font-technical text-ink overflow-x-auto whitespace-pre-wrap text-[12px] leading-relaxed">
              {response.output}
            </pre>
          )}

          {mode === 'tools' && Array.isArray(response.tools) && (
            <div className="space-y-2">
              <div className="font-technical text-ink-mute text-[11px] uppercase tracking-wider">
                {(response.tools as ToolOption[]).length} tools discovered
              </div>
              {(response.tools as ToolOption[]).map((t) => (
                <div key={t.name} className="border-hairline bg-paper rounded-xl border p-3">
                  <div className="font-technical text-accent text-[12.5px] font-semibold">
                    {t.name}
                  </div>
                  <div className="text-ink-faded mt-0.5 text-[12.5px]">{t.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
