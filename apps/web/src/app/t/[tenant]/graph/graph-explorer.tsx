'use client';

/**
 * Graph explorer — browse entities, then walk one entity's neighborhood.
 *
 * The point of the detail pane is provenance: every edge shows the sentence
 * the extractor took it from, and the documents the entity was found in. A
 * graph you can't audit is a graph you can't sell.
 */
import * as React from 'react';
import { ArrowLeft, ArrowRight, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { trpc } from '@/lib/trpc/client';
import { Panel, Pill } from '@/components/app/shell';

const inputCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-lg border py-1.5 pl-8 pr-2.5 text-[13px] focus:border-accent/60 focus:outline-none';

function evidenceOf(metadata: unknown): string | null {
  const ev = (metadata as { evidence?: string[] } | null)?.evidence;
  return ev && ev.length > 0 ? ev[0]! : null;
}

export function GraphExplorer({ types }: { types: string[] }) {
  const [type, setType] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const entities = trpc.entities.list.useQuery({
    ...(type && { type: type as never }),
    ...(debounced.length > 1 && { search: debounced }),
    limit: 60,
  });

  if (selectedId) {
    return <EntityDetail entityId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <Panel
      title="Entities"
      description="Ranked by how many documents mention them. Select one to walk its connections."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={13}
            className="text-ink-mute pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            className={inputCls}
            placeholder="Search entities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => setType(null)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
            type === null
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-hairline text-ink-faded hover:text-ink',
          )}
        >
          all
        </button>
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t === type ? null : t)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
              type === t
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-hairline text-ink-faded hover:text-ink',
            )}
          >
            {t.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {entities.isLoading ? (
        <div className="text-ink-faded flex items-center gap-2 py-8 text-[13.5px]">
          <Loader2 size={14} className="animate-spin" /> Loading entities…
        </div>
      ) : (entities.data ?? []).length === 0 ? (
        <p className="text-ink-faded py-8 text-center text-[13.5px]">
          No entities match that filter.
        </p>
      ) : (
        <ul className="divide-hairline -my-2 divide-y">
          {(entities.data ?? []).map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() => setSelectedId(entity.id)}
                className="hover:bg-paper-soft -mx-3 flex w-full flex-wrap items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-ink truncate text-[14px] font-medium">{entity.name}</span>
                    <Pill>{entity.type.replace(/_/g, ' ')}</Pill>
                  </div>
                  {entity.aliases.length > 0 && (
                    <div className="text-ink-mute mt-0.5 truncate text-[11.5px]">
                      aka {entity.aliases.join(', ')}
                    </div>
                  )}
                </div>
                <span className="num text-ink-faded shrink-0 text-[12px]">
                  {entity._count.documents} docs · {entity._count.outgoing + entity._count.incoming}{' '}
                  links
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EntityDetail({ entityId, onBack }: { entityId: string; onBack: () => void }) {
  const rels = trpc.entities.relationships.useQuery({ entityId });
  const docs = trpc.entities.documents.useQuery({ entityId });

  if (rels.isLoading) {
    return (
      <Panel>
        <div className="text-ink-faded flex items-center gap-2 py-8 text-[13.5px]">
          <Loader2 size={14} className="animate-spin" /> Loading entity…
        </div>
      </Panel>
    );
  }
  if (!rels.data) {
    return (
      <Panel>
        <p className="text-destructive py-8 text-center text-[13.5px]">
          {rels.error?.message ?? 'Entity not found.'}
        </p>
      </Panel>
    );
  }

  const { entity, outgoing, incoming } = rels.data;
  const attributes = (entity.metadata as { attributes?: Record<string, unknown> } | null)
    ?.attributes;

  return (
    <Panel
      title={entity.name}
      description={`${entity.type.replace(/_/g, ' ')}${entity.aliases.length > 0 ? ` · aka ${entity.aliases.join(', ')}` : ''}`}
      action={
        <button
          type="button"
          onClick={onBack}
          className="text-ink-faded hover:text-ink inline-flex items-center gap-1.5 text-[12.5px] font-medium transition-colors"
        >
          <ArrowLeft size={13} /> All entities
        </button>
      }
    >
      {attributes && Object.keys(attributes).length > 0 && (
        <div className="border-hairline mb-5 flex flex-wrap gap-4 rounded-lg border px-4 py-3">
          {Object.entries(attributes).map(([key, value]) => (
            <div key={key}>
              <div className="text-ink-mute text-[11px] uppercase tracking-wide">
                {key.replace(/_/g, ' ')}
              </div>
              <div className="num text-ink text-[14px] font-semibold">
                {typeof value === 'number' && key.includes('aud')
                  ? `$${value.toLocaleString()}`
                  : String(value)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <EdgeList
          title="Outgoing"
          empty="No outgoing relationships."
          rows={outgoing.map((r) => ({
            id: r.id,
            type: r.type,
            other: r.toEntity,
            evidence: evidenceOf(r.metadata),
            direction: 'out' as const,
          }))}
        />
        <EdgeList
          title="Incoming"
          empty="No incoming relationships."
          rows={incoming.map((r) => ({
            id: r.id,
            type: r.type,
            other: r.fromEntity,
            evidence: evidenceOf(r.metadata),
            direction: 'in' as const,
          }))}
        />
      </div>

      <div className="border-hairline mt-6 border-t pt-5">
        <h3 className="text-ink-mute mb-2 text-[10.5px] font-semibold uppercase tracking-[0.16em]">
          Found in
        </h3>
        {docs.isLoading ? (
          <div className="text-ink-faded flex items-center gap-2 text-[13px]">
            <Loader2 size={13} className="animate-spin" /> Loading documents…
          </div>
        ) : (
          <ul className="space-y-1.5">
            {(docs.data ?? []).map((link) => (
              <li key={link.id} className="flex items-center gap-3 text-[13px]">
                <span className="text-ink min-w-0 flex-1 truncate">{link.document.title}</span>
                <span className="text-ink-faded shrink-0 text-[12px]">
                  {link.mentions} mention{link.mentions === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function EdgeList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{
    id: string;
    type: string;
    other: { id: string; name: string; type: string };
    evidence: string | null;
    direction: 'in' | 'out';
  }>;
}) {
  return (
    <div>
      <h3 className="text-ink-mute mb-2 text-[10.5px] font-semibold uppercase tracking-[0.16em]">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-ink-faded text-[13px]">{empty}</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.id} className="text-[13px]">
              <div className="flex items-center gap-1.5">
                {row.direction === 'in' && (
                  <ArrowRight size={12} className="text-accent shrink-0" />
                )}
                <span className="text-accent font-medium">{row.type.replace(/_/g, ' ')}</span>
                {row.direction === 'out' && (
                  <ArrowRight size={12} className="text-accent shrink-0" />
                )}
                <span className="text-ink min-w-0 truncate">{row.other.name}</span>
                <span className="text-ink-mute shrink-0 text-[11px]">
                  {row.other.type.replace(/_/g, ' ')}
                </span>
              </div>
              {row.evidence && (
                <p className="text-ink-faded border-hairline mt-1 border-l-2 pl-2.5 text-[12px] leading-relaxed">
                  “{row.evidence}”
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
