'use client';

/**
 * The Horus Playground — the live proof of the platform.
 *
 * Left: the knowledge bench. Point it at a URL or drop a PDF and watch the
 * real ingestion pipeline stream by (crawl → chunk → embed → index) in a
 * terminal readout. Right: a grounded agent over exactly that knowledge —
 * streaming chat with citations, and a live full-duplex voice call
 * (GA Realtime API over WebRTC: talk over it, it stops and listens).
 *
 * Open access by design: sessions are anonymous, ephemeral (TTL-swept), and
 * capped server-side.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUp,
  FileText,
  Globe,
  Loader2,
  Mic,
  PhoneOff,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Wordmark, HorusGlyph } from '@/components/horus';
import {
  readSse,
  type AgentCitationView,
  type ChatSse,
  type IngestSse,
  type KnowledgeSourceView,
  type PlaygroundLimits,
} from '@/lib/playground-types';
import { useRealtimeVoice } from './use-realtime-voice';

/* ============================================================================
 * Types + small utils
 * ========================================================================== */

interface LogLine {
  id: number;
  text: string;
  tone: 'dim' | 'normal' | 'accent' | 'error';
  /** Lines sharing a key replace each other (live progress counters). */
  key?: string;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: AgentCitationView[];
  streaming?: boolean;
  error?: boolean;
}

const SESSION_KEY = 'horus-playground-session';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/* ============================================================================
 * Markdown-lite renderer (no dangerouslySetInnerHTML, ever)
 * ========================================================================== */

function InlineText({
  text,
  citations,
}: {
  text: string;
  citations?: AgentCitationView[];
}): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-ink font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="mono bg-paper-deep text-ink rounded px-1 py-0.5 text-[0.82em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const marker = part.match(/^\[(\d+)\]$/);
    if (marker) {
      const n = Number(marker[1]);
      const citation = citations?.find((c) => c.n === n);
      const sup = (
        <sup className="text-accent ml-px text-[0.72em] font-semibold tracking-tight">[{n}]</sup>
      );
      return citation?.url ? (
        <a key={i} href={citation.url} target="_blank" rel="noreferrer" title={citation.title}>
          {sup}
        </a>
      ) : (
        <span key={i} title={citation?.title}>
          {sup}
        </span>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function AssistantBody({
  content,
  citations,
}: {
  content: string;
  citations?: AgentCitationView[];
}) {
  // Hosted-tool citation markers (e.g. 【3:5†source】) render as chips instead.
  const blocks = content
    .replace(/【[^】]*】/g, '')
    .split(/\n{2,}/)
    .filter((b) => b.trim());
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const isList = lines.length > 0 && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="space-y-1.5 pl-1">
              {lines.map((line, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="bg-accent/70 mt-[0.6em] h-1 w-1 shrink-0 rounded-full" />
                  <span>
                    <InlineText
                      text={line.replace(/^\s*([-*•]|\d+[.)])\s+/, '')}
                      citations={citations}
                    />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        const heading = block.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return (
            <p key={i} className="text-ink pt-1 text-[15px] font-semibold">
              <InlineText text={heading[1]!} citations={citations} />
            </p>
          );
        }
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                <InlineText text={line} citations={citations} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * Component
 * ========================================================================== */

export function PlaygroundClient() {
  const [sessionId, setSessionId] = React.useState('');
  const [sources, setSources] = React.useState<KnowledgeSourceView[]>([]);
  const [limits, setLimits] = React.useState<PlaygroundLimits>({
    maxSources: 8,
    maxPagesPerCrawl: 20,
    maxPdfMb: 15,
    sessionTtlHours: 24,
  });

  const [log, setLog] = React.useState<LogLine[]>([]);
  const [ingesting, setIngesting] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState('');
  const [dragOver, setDragOver] = React.useState(false);

  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [chatBusy, setChatBusy] = React.useState(false);
  const [toolActivity, setToolActivity] = React.useState<string | null>(null);
  const [input, setInput] = React.useState('');
  const [tier, setTier] = React.useState<'fast' | 'deep'>('fast');

  const [notice, setNotice] = React.useState<string | null>(null);
  const [mobileTab, setMobileTab] = React.useState<'knowledge' | 'chat'>('knowledge');

  const logIdRef = React.useRef(0);
  const logEndRef = React.useRef<HTMLDivElement>(null);
  const chatEndRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const showNotice = React.useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 4200);
  }, []);

  /* ------------------------------------------------------------------ voice */

  // Live-call transcripts land in the same chat feed. Each agent voice turn
  // (keyed by response id) becomes one streaming assistant message.
  const voiceTurnsRef = React.useRef(new Map<string, string>());

  const voiceMsgFor = React.useCallback((turnId: string): string => {
    let msgId = voiceTurnsRef.current.get(turnId);
    if (!msgId) {
      msgId = crypto.randomUUID();
      voiceTurnsRef.current.set(turnId, msgId);
      setMessages((prev) => [
        ...prev,
        { id: msgId!, role: 'assistant', content: '', streaming: true },
      ]);
    }
    return msgId;
  }, []);

  const voice = useRealtimeVoice({
    onUserUtterance: (text) =>
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }]),
    onAgentDelta: (turnId, delta) => {
      const msgId = voiceMsgFor(turnId);
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, content: m.content + delta } : m)),
      );
    },
    onAgentDone: (turnId) => {
      const msgId = voiceTurnsRef.current.get(turnId);
      if (!msgId) return;
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, streaming: false } : m)));
    },
    onCitations: (turnId, citations) => {
      const msgId = voiceMsgFor(turnId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, citations: [...(m.citations ?? []), ...citations] } : m,
        ),
      );
    },
    onToolActivity: setToolActivity,
    onNotice: showNotice,
  });

  const toggleVoiceCall = React.useCallback(() => {
    if (!sessionId) return;
    setMobileTab('chat');
    voice.toggleCall(sessionId);
  }, [sessionId, voice]);

  /* ---------------------------------------------------------------- session */

  React.useEffect(() => {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    setSessionId(id);
  }, []);

  const refreshSources = React.useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/playground/sources?sessionId=${id}`);
      if (!res.ok) return;
      const body = (await res.json()) as {
        sources: KnowledgeSourceView[];
        limits: PlaygroundLimits;
      };
      setSources(body.sources);
      setLimits(body.limits);
    } catch {
      /* offline — leave as-is */
    }
  }, []);

  React.useEffect(() => {
    if (sessionId) void refreshSources(sessionId);
  }, [sessionId, refreshSources]);

  /* -------------------------------------------------------------- ingestion */

  const pushLog = React.useCallback((text: string, tone: LogLine['tone'], key?: string) => {
    setLog((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (key && last?.key === key) {
        next[next.length - 1] = { ...last, text, tone };
        return next;
      }
      return [...next, { id: ++logIdRef.current, text, tone, key }];
    });
  }, []);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  const consumeIngest = React.useCallback(
    async (res: Response) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        pushLog(`✕ ${body?.error ?? `request failed (${res.status})`}`, 'error');
        return;
      }
      for await (const ev of readSse<IngestSse>(res)) {
        switch (ev.kind) {
          case 'status':
            pushLog(ev.message, 'dim');
            break;
          case 'page':
            pushLog(`+ p.${String(ev.count).padStart(2, '0')}  ${ev.title.slice(0, 56)}`, 'normal');
            break;
          case 'chunked':
            pushLog(`✂ ${ev.chunks} chunks`, 'normal');
            break;
          case 'embedding':
            pushLog(`⚡ embedding ${ev.done}/${ev.total}`, 'normal', 'embed');
            break;
          case 'done':
            pushLog(
              `✓ ${ev.source.chunkCount} chunks indexed · ${ev.pageCount} page${ev.pageCount === 1 ? '' : 's'} · live`,
              'accent',
            );
            void refreshSources(sessionId);
            break;
          case 'error':
            pushLog(`✕ ${ev.message}`, 'error');
            break;
        }
      }
    },
    [pushLog, refreshSources, sessionId],
  );

  const ingestUrl = React.useCallback(
    async (raw: string) => {
      const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
      setIngesting(true);
      pushLog(`→ crawl ${url}`, 'accent');
      try {
        const res = await fetch('/api/playground/ingest/url', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, url }),
        });
        await consumeIngest(res);
      } catch {
        pushLog('✕ network error during ingest', 'error');
      } finally {
        setIngesting(false);
      }
    },
    [sessionId, pushLog, consumeIngest],
  );

  const ingestPdf = React.useCallback(
    async (file: File) => {
      setIngesting(true);
      pushLog(`→ pdf ${file.name.slice(0, 60)}`, 'accent');
      try {
        const form = new FormData();
        form.set('sessionId', sessionId);
        form.set('file', file);
        const res = await fetch('/api/playground/ingest/pdf', { method: 'POST', body: form });
        await consumeIngest(res);
      } catch {
        pushLog('✕ network error during ingest', 'error');
      } finally {
        setIngesting(false);
      }
    },
    [sessionId, pushLog, consumeIngest],
  );

  /* ------------------------------------------------------------------- chat */

  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, toolActivity]);

  const send = React.useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || chatBusy || !sessionId) return;

      const history = [
        ...messages.filter((m) => !m.error),
        { role: 'user' as const, content: text },
      ];
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: text },
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ]);
      setInput('');
      setChatBusy(true);
      setMobileTab('chat');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';

      const patch = (updates: Partial<ChatMsg>) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...updates } : m)));
      const appendToken = (t: string) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m)),
        );

      try {
        const res = await fetch('/api/playground/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            model: tier,
            messages: history.map(({ role, content }) => ({ role, content })),
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
        for await (const ev of readSse<ChatSse>(res)) {
          switch (ev.kind) {
            case 'token':
              appendToken(ev.text);
              break;
            case 'tool':
              setToolActivity(
                ev.status === 'start'
                  ? ev.name === 'search_knowledge'
                    ? `searching “${ev.detail ?? ''}”`
                    : ev.name === 'fetch_page'
                      ? `fetching ${ev.detail ? hostOf(ev.detail) : 'page'}`
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
        setToolActivity(null);
        setChatBusy(false);
      }
    },
    [chatBusy, sessionId, messages, tier],
  );

  const resetSession = React.useCallback(async () => {
    if (!window.confirm('Reset this session? Connected knowledge and chat will be cleared.'))
      return;
    voice.endCall();
    voiceTurnsRef.current.clear();
    try {
      await fetch(`/api/playground/session?sessionId=${sessionId}`, { method: 'DELETE' });
    } catch {
      /* best effort */
    }
    setSources([]);
    setMessages([]);
    setLog([]);
    showNotice('Session cleared.');
  }, [sessionId, voice, showNotice]);

  /* ------------------------------------------------------------- rendering */

  const suggestions =
    sources.length > 0 && messages.length === 0
      ? [
          'Summarize everything you just learned.',
          `What does ${sources[0]!.sourceType === 'url' ? hostOf(sources[0]!.sourceUrl) : sources[0]!.title} actually offer?`,
          'What should I ask you about this knowledge?',
        ]
      : [];

  return (
    <div className="bg-paper text-ink flex h-dvh flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="glass sticky top-0 z-30">
        <div className="flex h-14 items-center justify-between gap-4 px-4 md:px-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Wordmark size="sm" />
          </Link>

          <span className="eyebrow hidden items-center md:inline-flex">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="bg-accent animate-pulse-soft absolute inset-0 rounded-full" />
            </span>
            Playground · open access
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void resetSession()}
              className="text-ink-faded hover:text-ink hover:bg-paper-soft inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors"
            >
              <RotateCcw size={13} />
              Reset
            </button>
            <Link
              href="/playground/infer"
              className="mono text-ink-mute hover:text-ink hidden h-8 items-center rounded-full px-3 text-[11px] tracking-wide transition-colors sm:inline-flex"
            >
              raw infer ↗
            </Link>
          </div>
        </div>

        {/* Mobile tab switch */}
        <div className="border-hairline flex border-t lg:hidden">
          {(['knowledge', 'chat'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={cn(
                'mono flex-1 py-2.5 text-[11px] uppercase tracking-[0.14em] transition-colors',
                mobileTab === tab
                  ? 'text-accent border-accent border-b-2'
                  : 'text-ink-mute border-b-2 border-transparent',
              )}
            >
              {tab === 'knowledge' ? `Knowledge · ${sources.length}` : 'Chat'}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Knowledge bench ──────────────────────────────────────────── */}
        <aside
          className={cn(
            'border-hairline w-full shrink-0 overflow-y-auto border-r lg:block lg:w-[400px]',
            mobileTab === 'knowledge' ? 'block' : 'hidden',
          )}
        >
          <div className="space-y-8 p-6">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Give it a brain.</h1>
              <p className="text-ink-faded mt-1.5 text-[13px] leading-relaxed">
                Connect a website or documents — Horus crawls, chunks, embeds and indexes them live.
                Then talk to it, by text or voice. Every answer cites its source.
              </p>
            </div>

            {/* 01 — website */}
            <section>
              <div className="eyebrow mb-3">01 · Connect a website</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (urlInput.trim() && !ingesting) {
                    void ingestUrl(urlInput);
                    setUrlInput('');
                  }
                }}
                className="focus-ring border-hairline-strong bg-paper flex items-center gap-1 rounded-xl border p-1 pl-3"
              >
                <Globe size={14} className="text-ink-mute shrink-0" />
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="acme.com"
                  disabled={ingesting || !sessionId}
                  className="mono placeholder:text-ink-mute/70 w-full bg-transparent py-1.5 text-[13px] outline-none"
                />
                <button
                  type="submit"
                  disabled={ingesting || !urlInput.trim()}
                  aria-label="Crawl website"
                  className="bg-ink text-paper hover:bg-ink-soft grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-35"
                >
                  {ingesting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ArrowRight size={14} />
                  )}
                </button>
              </form>
              <p className="mono text-ink-mute mt-2 text-[10.5px] tracking-wide">
                same-origin crawl · up to {limits.maxPagesPerCrawl} pages
              </p>
            </section>

            {/* 02 — documents */}
            <section>
              <div className="eyebrow mb-3">02 · Upload documents</div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file && !ingesting) void ingestPdf(file);
                }}
                disabled={ingesting || !sessionId}
                className={cn(
                  'w-full rounded-xl border border-dashed p-5 text-center transition-all duration-200',
                  dragOver
                    ? 'border-accent bg-accent-soft'
                    : 'border-hairline-strong hover:border-ink/30 hover:bg-paper-soft',
                  ingesting && 'pointer-events-none opacity-50',
                )}
              >
                <FileText size={18} className="text-ink-mute mx-auto" />
                <p className="mt-2 text-[13px] font-medium">Drop a PDF, or browse</p>
                <p className="mono text-ink-mute mt-1 text-[10.5px] tracking-wide">
                  text PDFs · up to {limits.maxPdfMb}MB
                </p>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file && !ingesting) void ingestPdf(file);
                }}
              />
            </section>

            {/* Pipeline readout */}
            {log.length > 0 && (
              <section className="animate-fade">
                <div className="eyebrow mb-3">Pipeline</div>
                <div className="bg-ink max-h-56 overflow-y-auto rounded-xl p-4 shadow-md">
                  <div className="mono space-y-1 text-[11px] leading-relaxed">
                    {log.map((line) => (
                      <div
                        key={line.id}
                        className={cn(
                          'break-words',
                          line.tone === 'dim' && 'text-paper/45',
                          line.tone === 'normal' && 'text-paper/80',
                          line.tone === 'accent' && 'text-accent-glow',
                          line.tone === 'error' && 'text-red-400',
                        )}
                      >
                        {line.text}
                      </div>
                    ))}
                    {ingesting && <span className="animate-cursor text-accent-glow">▍</span>}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </section>
            )}

            {/* Sources */}
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="eyebrow">Connected sources</div>
                <span className="mono text-ink-mute num text-[10.5px]">
                  {sources.length}/{limits.maxSources}
                </span>
              </div>

              {sources.length === 0 ? (
                <p className="serif-italic text-ink-mute py-3 text-[15px]">
                  Nothing connected yet.
                </p>
              ) : (
                <ul>
                  {sources.map((s) => (
                    <li
                      key={s.sourceId}
                      className="border-hairline flex items-center gap-2.5 border-b py-2.5 last:border-0"
                    >
                      {s.sourceType === 'url' ? (
                        <Globe size={13} className="text-accent shrink-0" />
                      ) : (
                        <FileText size={13} className="text-ink-faded shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        {s.sourceType === 'url' ? (
                          <a
                            href={s.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-accent block truncate text-[13px] font-medium transition-colors"
                          >
                            {s.title || hostOf(s.sourceUrl)}
                          </a>
                        ) : (
                          <span className="block truncate text-[13px] font-medium">{s.title}</span>
                        )}
                        <span className="mono text-ink-mute block truncate text-[10px]">
                          {s.sourceType === 'url' ? hostOf(s.sourceUrl) : 'uploaded pdf'}
                        </span>
                      </div>
                      <span className="mono num text-ink-mute shrink-0 text-[10.5px]">
                        {s.chunkCount} ch
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mono text-ink-mute/70 mt-3 text-[10px] tracking-wide">
                anonymous session · knowledge auto-expires after {limits.sessionTtlHours}h
              </p>
            </section>
          </div>
        </aside>

        {/* ── Chat ─────────────────────────────────────────────────────── */}
        <main
          className={cn(
            'relative min-w-0 flex-1 flex-col lg:flex',
            mobileTab === 'chat' ? 'flex' : 'hidden',
          )}
        >
          <div className="bg-wash pointer-events-none absolute inset-0 opacity-60" />

          <div className="relative flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <HorusGlyph size={52} className="animate-drift" />
                <p className="serif-italic text-ink-soft mt-6 text-xl md:text-2xl">
                  Feed it a website. Then ask it anything.
                </p>
                <p className="mono text-ink-mute mt-3 text-[11px] tracking-wide">
                  ① connect a source&ensp;→&ensp;② watch it learn&ensp;→&ensp;③ ask by text or voice
                </p>
                {suggestions.length > 0 && (
                  <div className="reveal-stagger mt-8 flex max-w-md flex-wrap justify-center gap-2">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => void send(s)}
                        className="chip hover:border-accent/50 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mx-auto w-full max-w-2xl space-y-7 px-5 py-8 md:px-6">
                {messages.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="bg-ink text-paper max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14.5px] leading-relaxed shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="animate-fade">
                      {m.streaming && toolActivity && (
                        <span className="chip chip-dot mb-3">{toolActivity}</span>
                      )}
                      <div
                        className={cn(
                          'border-l-2 pl-4 text-[15px] leading-[1.75]',
                          m.error
                            ? 'border-destructive/50 text-destructive'
                            : 'border-accent/50 text-ink-soft',
                        )}
                      >
                        {m.content ? (
                          <AssistantBody content={m.content} citations={m.citations} />
                        ) : (
                          m.streaming &&
                          !toolActivity && (
                            <span className="animate-cursor text-accent text-lg leading-none">
                              ▍
                            </span>
                          )
                        )}
                        {m.streaming && m.content && (
                          <span className="animate-cursor text-accent">▍</span>
                        )}
                      </div>

                      {m.citations && m.citations.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5 pl-4">
                          {m.citations.map((c) =>
                            c.url ? (
                              <a
                                key={c.n}
                                href={c.url}
                                target="_blank"
                                rel="noreferrer"
                                title={c.snippet}
                                className="border-hairline hover:border-accent/60 hover:text-accent mono text-ink-faded inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] transition-colors"
                              >
                                <span className="text-accent num font-semibold">{c.n}</span>
                                <span className="truncate">{c.title || hostOf(c.url)}</span>
                                <span aria-hidden>↗</span>
                              </a>
                            ) : (
                              <span
                                key={c.n}
                                title={c.snippet}
                                className="border-hairline mono text-ink-faded inline-flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px]"
                              >
                                <span className="text-accent num font-semibold">{c.n}</span>
                                <FileText size={10} />
                                <span className="truncate">{c.title}</span>
                              </span>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  ),
                )}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-hairline relative border-t p-3 md:p-4">
            <div className="mx-auto w-full max-w-2xl">
              <div className="focus-ring border-hairline-strong bg-paper flex items-end gap-1.5 rounded-2xl border p-1.5 shadow-sm">
                {/* Voice call toggle — full duplex, barge-in native */}
                <button
                  type="button"
                  onClick={toggleVoiceCall}
                  disabled={!voice.available || !sessionId}
                  title={
                    voice.available
                      ? voice.callState === 'idle'
                        ? 'Start a live voice call'
                        : 'End the voice call'
                      : 'Voice not configured'
                  }
                  className={cn(
                    'relative grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all duration-200',
                    voice.callState === 'live'
                      ? 'bg-accent shadow-blue text-white'
                      : 'text-ink-faded hover:text-accent hover:bg-accent-soft',
                    !voice.available && 'cursor-not-allowed opacity-30',
                  )}
                >
                  {voice.callState === 'live' && (
                    <span
                      className={cn(
                        'bg-accent/40 absolute inset-0 rounded-full',
                        voice.agentSpeaking ? 'animate-pulse' : 'animate-ping',
                      )}
                    />
                  )}
                  {voice.callState === 'connecting' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : voice.callState === 'live' ? (
                    <PhoneOff size={15} className="relative" />
                  ) : (
                    <Mic size={16} className="relative" />
                  )}
                </button>

                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder={
                    voice.callState === 'live'
                      ? 'Voice call live — just talk. Interrupt any time.'
                      : voice.callState === 'connecting'
                        ? 'Connecting the call…'
                        : sources.length > 0
                          ? 'Ask about your connected knowledge…'
                          : 'Connect a source first, or just say hello…'
                  }
                  disabled={!sessionId || voice.callState !== 'idle'}
                  className="placeholder:text-ink-mute/70 max-h-[140px] w-full resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-relaxed outline-none disabled:opacity-60"
                />

                {/* Send */}
                <button
                  type="button"
                  onClick={() => void send(input)}
                  disabled={!input.trim() || chatBusy || !sessionId || voice.callState !== 'idle'}
                  aria-label="Send"
                  className="bg-ink text-paper hover:bg-ink-soft grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all disabled:opacity-30"
                >
                  {chatBusy ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ArrowUp size={15} />
                  )}
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between px-1">
                <div className="mono flex items-center gap-0.5 text-[10px]">
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
                <span className="mono text-ink-mute/70 text-[10px] tracking-wide">
                  {voice.callState === 'live'
                    ? 'live voice · full duplex'
                    : 'grounded answers · citations [n]'}
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Notice toast */}
      {notice && (
        <div className="animate-rise fixed bottom-20 left-1/2 z-50 -translate-x-1/2">
          <span className="bg-ink text-paper rounded-full px-4 py-2 text-[12.5px] shadow-lg">
            {notice}
          </span>
        </div>
      )}
    </div>
  );
}
