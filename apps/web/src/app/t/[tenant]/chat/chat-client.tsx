'use client';

/**
 * Workspace agent chat — streams from /api/agent/chat (the same engine as
 * the playground: knowledge search + page fetch + the workspace's MCP
 * connections), with every turn persisted server-side.
 */
import * as React from 'react';
import { ArrowUp, Loader2, MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { readSse, type AgentCitationView } from '@/lib/playground-types';

interface SessionRow {
  id: string;
  title: string;
  updatedAt: string;
  msgs: number;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: AgentCitationView[];
  streaming?: boolean;
  error?: boolean;
}

type ChatEvent =
  | { kind: 'session'; id: string }
  | { kind: 'token'; text: string }
  | { kind: 'tool'; name: string; status: 'start' | 'end'; detail?: string }
  | { kind: 'citations'; citations: AgentCitationView[] }
  | { kind: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { kind: 'error'; message: string };

export function TenantChatClient({
  slug,
  initialSessions,
}: {
  slug: string;
  initialSessions: SessionRow[];
}) {
  const [sessions, setSessions] = React.useState(initialSessions);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [tool, setTool] = React.useState<string | null>(null);
  const [tier, setTier] = React.useState<'fast' | 'deep'>('fast');
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, tool]);

  const openSession = React.useCallback(
    async (id: string) => {
      setActiveId(id);
      setMessages([]);
      try {
        const res = await fetch(`/api/agent/chat?tenant=${slug}&sessionId=${id}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          messages: Array<{ id: string; role: string; content: string; sources: unknown }>;
        };
        setMessages(
          body.messages
            .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
            .map((m) => ({
              id: m.id,
              role: m.role === 'USER' ? 'user' : 'assistant',
              content: m.content,
              citations: Array.isArray(m.sources) ? (m.sources as AgentCitationView[]) : undefined,
            })),
        );
      } catch {
        /* keep empty */
      }
    },
    [slug],
  );

  const send = React.useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    const patch = (updates: Partial<Msg>) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...updates } : m)));

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant: slug,
          sessionId: activeId ?? undefined,
          message: text,
          model: tier,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        patch({
          content: body?.error ?? `The agent is unavailable (${res.status}).`,
          streaming: false,
          error: true,
        });
        return;
      }
      for await (const ev of readSse<ChatEvent>(res)) {
        switch (ev.kind) {
          case 'session':
            if (!activeId) {
              setActiveId(ev.id);
              setSessions((prev) =>
                prev.some((s) => s.id === ev.id)
                  ? prev
                  : [
                      {
                        id: ev.id,
                        title: text.slice(0, 80),
                        updatedAt: new Date().toISOString(),
                        msgs: 1,
                      },
                      ...prev,
                    ],
              );
            }
            break;
          case 'token':
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + ev.text } : m)),
            );
            break;
          case 'tool':
            setTool(
              ev.status === 'start'
                ? ev.name === 'search_knowledge'
                  ? `searching “${ev.detail ?? ''}”`
                  : `running ${ev.name}`
                : null,
            );
            break;
          case 'citations':
            patch({ citations: ev.citations });
            break;
          case 'error':
            patch({ content: ev.message, streaming: false, error: true });
            break;
          case 'done':
            break;
        }
      }
      patch({ streaming: false });
    } catch {
      patch({ content: 'Connection dropped mid-answer.', streaming: false, error: true });
    } finally {
      setTool(null);
      setBusy(false);
    }
  }, [input, busy, slug, activeId, tier]);

  return (
    <div className="border-hairline bg-paper grid min-h-[560px] overflow-hidden rounded-2xl border lg:grid-cols-[260px_1fr]">
      {/* Sessions */}
      <aside className="border-hairline hidden border-r lg:block">
        <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
          <span className="text-ink text-[13px] font-semibold">Sessions</span>
          <button
            onClick={() => {
              setActiveId(null);
              setMessages([]);
            }}
            title="New conversation"
            className="text-ink-faded hover:text-accent transition-colors"
          >
            <MessageSquarePlus size={15} />
          </button>
        </div>
        <ul className="max-h-[520px] overflow-y-auto p-2">
          {sessions.length === 0 && (
            <li className="text-ink-mute px-2 py-3 text-[12.5px]">No conversations yet.</li>
          )}
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => void openSession(s.id)}
                className={cn(
                  'w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                  activeId === s.id ? 'bg-accent-soft' : 'hover:bg-paper-soft',
                )}
              >
                <div className="text-ink truncate text-[13px] font-medium">{s.title}</div>
                <div className="text-ink-mute mt-0.5 text-[11px]">
                  {new Date(s.updatedAt).toLocaleDateString()} · {s.msgs} msgs
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation */}
      <div className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
              <p className="serif-italic text-ink-soft text-lg">Ask your workspace anything.</p>
              <p className="text-ink-mute mt-2 max-w-sm text-[12.5px] leading-relaxed">
                Grounded in workspace knowledge, with every connected tool server available. Turns
                are saved to this workspace.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="bg-ink text-paper max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] leading-relaxed">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id}>
                    {m.streaming && tool && <span className="chip chip-dot mb-2">{tool}</span>}
                    <div
                      className={cn(
                        'whitespace-pre-wrap border-l-2 pl-4 text-[14.5px] leading-[1.75]',
                        m.error
                          ? 'border-destructive/50 text-destructive'
                          : 'border-accent/50 text-ink-soft',
                      )}
                    >
                      {m.content ||
                        (m.streaming && !tool && (
                          <span className="animate-cursor text-accent text-lg leading-none">▍</span>
                        ))}
                      {m.streaming && m.content && (
                        <span className="animate-cursor text-accent">▍</span>
                      )}
                    </div>
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 pl-4">
                        {m.citations.map((c) =>
                          c.url ? (
                            <a
                              key={c.n}
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="border-hairline hover:border-accent/60 hover:text-accent mono text-ink-faded inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] transition-colors"
                            >
                              <span className="text-accent num font-semibold">{c.n}</span>
                              <span className="truncate">{c.title}</span>
                            </a>
                          ) : (
                            <span
                              key={c.n}
                              className="border-hairline mono text-ink-faded inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px]"
                            >
                              <span className="text-accent num font-semibold">{c.n}</span>
                              <span className="truncate">{c.title}</span>
                            </span>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                ),
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-hairline border-t p-3">
          <div className="focus-ring border-hairline-strong bg-paper flex items-end gap-1.5 rounded-2xl border p-1.5">
            <textarea
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask the workspace agent…"
              className="placeholder:text-ink-mute/70 max-h-[120px] w-full resize-none bg-transparent px-2.5 py-1.5 text-[14px] leading-relaxed outline-none"
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || busy}
              aria-label="Send"
              className="bg-ink text-paper hover:bg-ink-soft grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all disabled:opacity-30"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
            </button>
          </div>
          <div className="mono mt-1.5 flex items-center gap-0.5 px-1 text-[10px]">
            {(['fast', 'deep'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={cn(
                  'rounded-full px-2 py-0.5 uppercase tracking-[0.12em] transition-colors',
                  tier === t
                    ? 'bg-accent-soft text-accent-deep font-medium'
                    : 'text-ink-mute hover:text-ink',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
