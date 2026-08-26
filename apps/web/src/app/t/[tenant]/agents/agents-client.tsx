'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/app/shell';
import { cn } from '@/lib/cn';

type Kind = 'CHAT' | 'VOICE' | 'HYBRID';
type Status = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

interface Agent {
  id: string;
  name: string;
  slug: string;
  kind: Kind;
  status: Status;
  persona: string | null;
  collectionIds: string[];
  toolSlugs: string[];
}

const inputCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-xl border px-4 py-2.5 text-[13.5px] focus:border-accent/60 focus:outline-none';

export function AgentsClient({
  slug,
  collections,
  initial,
  collectionNames,
}: {
  slug: string;
  collections: Array<{ id: string; name: string }>;
  initial: Agent[];
  collectionNames: Record<string, string>;
}) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('CHAT');
  const [persona, setPersona] = React.useState('');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const createMut = trpc.agents.create.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });
  const statusMut = trpc.agents.update.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });
  const deleteMut = trpc.agents.delete.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    await createMut.mutateAsync({
      name: name.trim(),
      kind,
      persona: persona.trim() || undefined,
      collectionIds: selected,
    });
    setName('');
    setPersona('');
    setSelected([]);
  }

  function toggleCollection(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const kindIcon: Record<Kind, React.ReactNode> = {
    CHAT: <MessageSquare size={13} />,
    VOICE: <Mic size={13} />,
    HYBRID: (
      <span className="flex items-center gap-0.5">
        <MessageSquare size={11} />
        <Mic size={11} />
      </span>
    ),
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onCreate} className="border-hairline space-y-3 rounded-xl border p-4">
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.7fr_auto]">
          <input
            className={inputCls}
            placeholder="Agent name (e.g. Front-desk helper)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="CHAT">Chat</option>
            <option value="VOICE">Voice</option>
            <option value="HYBRID">Hybrid</option>
          </select>
          <Button type="submit" size="sm" disabled={createMut.isPending || !name.trim()}>
            {createMut.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            New agent
          </Button>
        </div>
        <textarea
          className={cn(inputCls, 'min-h-[80px] resize-y')}
          placeholder="Persona / system prompt — who this agent is, what it refuses to answer, tone."
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
        />
        {collections.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-faded text-[12px]">Grounding:</span>
            {collections.map((c) => {
              const active = selected.includes(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => toggleCollection(c.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                    active
                      ? 'bg-accent/10 text-accent border-accent/40'
                      : 'bg-paper-soft text-ink-faded border-hairline hover:border-hairline-strong',
                  )}
                >
                  {c.name}
                </button>
              );
            })}
            {selected.length === 0 && (
              <span className="text-ink-mute text-[11.5px]">
                No selection = whole workspace knowledge
              </span>
            )}
          </div>
        )}
      </form>
      {error && <p className="text-destructive text-[12.5px]">{error}</p>}

      {initial.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-ink text-[15px] font-medium">No agents yet.</p>
          <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
            Create your first agent above. It shows up in the end-user portal as soon as you set its
            status to <em>active</em>.
          </p>
        </div>
      ) : (
        <ul className="divide-hairline -my-2 divide-y">
          {initial.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {kindIcon[a.kind]}
                  <span className="text-ink truncate text-[14px] font-medium">{a.name}</span>
                  <Pill
                    tone={
                      a.status === 'ACTIVE' ? 'success' : a.status === 'PAUSED' ? 'warn' : 'default'
                    }
                  >
                    {a.status.toLowerCase()}
                  </Pill>
                </div>
                <div className="text-ink-faded mt-0.5 text-[12px]">
                  {a.slug} ·{' '}
                  {a.collectionIds.length === 0
                    ? 'all knowledge'
                    : a.collectionIds.map((id) => collectionNames[id] ?? id.slice(0, 8)).join(', ')}
                  {a.toolSlugs.length > 0 && ` · ${a.toolSlugs.length} tool connection(s)`}
                </div>
                {a.persona && (
                  <div className="text-ink-mute mt-1 line-clamp-1 text-[12px]">{a.persona}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {a.status !== 'ACTIVE' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusMut.isPending}
                    onClick={() => statusMut.mutate({ id: a.id, status: 'ACTIVE' })}
                  >
                    Activate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusMut.isPending}
                    onClick={() => statusMut.mutate({ id: a.id, status: 'PAUSED' })}
                  >
                    Pause
                  </Button>
                )}
                <a
                  href={`/t/${slug}/portal?agent=${a.slug}`}
                  className="text-accent text-[12.5px] hover:underline"
                >
                  Open in portal
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete agent "${a.name}"?`)) {
                      deleteMut.mutate({ id: a.id });
                    }
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
