'use client';

/**
 * End-user portal chat — a single, linear conversation with a named agent.
 * Same engine as the workspace chat (tenant partition, MCP tools attached),
 * but stripped of session history UI: this is a customer-facing surface.
 */
import * as React from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { readSse, type AgentCitationView } from '@/lib/playground-types';

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
  | { kind: 'citations'; citations: AgentCitationView[] }
  | { kind: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { kind: 'error'; message: string };

export function PortalChatClient({
  slug,
  agent,
  agentName,
}: {
  slug: string;
  agent: string | null;
  agentName: string | null;
}) {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send() {
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
          sessionId: sessionId ?? undefined,
          message: text,
          model: 'fast',
          ...(agent && { agent }),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        patch({
          content: body?.error ?? `The assistant is unavailable (${res.status}).`,
          streaming: false,
          error: true,
        });
        return;
      }
      for await (const ev of readSse<ChatEvent>(res)) {
        switch (ev.kind) {
          case 'session':
            setSessionId(ev.id);
            break;
          case 'token':
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + ev.text } : m)),
            );
            break;
          case 'citations':
            patch({ citations: ev.citations });
            break;
          case 'error':
            patch({ content: ev.message, streaming: false, error: true });
            break;
          case 'done':
            patch({ streaming: false });
            break;
        }
      }
    } catch {
      patch({ content: 'Connection failed.', streaming: false, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-hairline bg-paper flex h-[70vh] flex-col overflow-hidden rounded-2xl border">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 && (
          <div className="text-ink-faded py-16 text-center text-[13.5px]">
            {agentName
              ? `You're talking to ${agentName}. Ask anything.`
              : 'Ask anything — answers cite the passages they came from.'}
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed',
                m.role === 'user'
                  ? 'bg-accent text-accent-ink'
                  : m.error
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-paper-soft text-ink',
              )}
            >
              {m.content}
              {m.streaming && <span className="ml-1 inline-block animate-pulse">▋</span>}
              {m.citations && m.citations.length > 0 && (
                <div className="text-ink-mute border-current/10 mt-2 space-y-0.5 border-t pt-2 text-[11px]">
                  {m.citations.slice(0, 4).map((c, i) => (
                    <div key={i}>
                      [{i + 1}] {c.title ?? 'source'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="border-hairline flex items-center gap-2 border-t px-4 py-3"
      >
        <input
          className="border-hairline bg-paper-soft text-ink placeholder:text-ink-mute focus:border-accent/60 flex-1 rounded-xl border px-4 py-2.5 text-[13.5px] focus:outline-none"
          placeholder="Type your message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          maxLength={4000}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="bg-accent text-accent-ink hover:bg-accent/90 inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors disabled:opacity-50"
          aria-label="Send"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
        </button>
      </form>
    </div>
  );
}
