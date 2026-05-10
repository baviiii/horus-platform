import { Panel, Pill } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockChatHistory, mockChatMessages } from '@/lib/mock-data';

export const metadata = { title: 'Chat · Horus' };

export default async function ChatPage({ params }: { params: Promise<{ tenant: string }> }) {
  await params;

  return (
    <Reveal
      as="div"
      className="grid h-[calc(100vh-9rem)] grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]"
    >
      <aside className="border-hairline bg-paper hidden flex-col rounded-2xl border lg:flex">
        <div className="border-hairline border-b p-4">
          <Button className="w-full justify-center" size="sm">
            <span className="mr-1.5 text-[14px] leading-none">+</span>
            New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="text-ink-mute px-2.5 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
            Recent
          </div>
          <ul className="space-y-0.5">
            {mockChatHistory.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={
                    i === 0
                      ? 'bg-paper-soft ring-hairline group flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left ring-1 transition-colors'
                      : 'hover:bg-paper-soft group flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors'
                  }
                >
                  <span className="text-ink line-clamp-1 text-[13px] font-medium">
                    {s.starred && <span className="text-accent mr-1">★</span>}
                    {s.title}
                  </span>
                  <span className="text-ink-faded mt-0.5 text-[11px]">
                    {s.createdAt} · {s.msgs} messages
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className="border-hairline bg-paper flex min-h-0 flex-col rounded-2xl border">
        <header className="border-hairline flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-ink truncate text-[15px] font-semibold tracking-tight">
              Cross-jurisdictional risk classification
            </h1>
            <div className="text-ink-faded mt-0.5 flex items-center gap-2 text-[12px]">
              <Pill tone="accent">14 messages</Pill>
              <span>3 documents in scope · started 2 hr ago</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">
              Export
            </Button>
            <Button variant="outline" size="sm">
              Share
            </Button>
          </div>
        </header>

        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-8">
          {mockChatMessages.map((m, i) => (
            <Message key={i} m={m} />
          ))}
        </div>

        <footer className="border-hairline border-t p-4">
          <div className="border-hairline-strong bg-paper-soft focus-within:border-accent flex items-end gap-3 rounded-2xl border p-3 transition-colors">
            <textarea
              rows={1}
              placeholder="Ask about your sources…"
              className="text-ink placeholder:text-ink-mute flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[14px] focus:outline-none"
            />
            <Button size="sm" variant="accent">
              Send
              <span className="border-paper/30 bg-paper/10 font-technical ml-2 rounded border px-1.5 py-0.5 text-[10px]">
                ⌘↵
              </span>
            </Button>
          </div>
          <div className="text-ink-mute mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            <button type="button" className="hover:text-ink-faded">
              ＋ Attach
            </button>
            <button type="button" className="hover:text-ink-faded">
              ＠ Mention doc
            </button>
            <button type="button" className="hover:text-ink-faded">
              # Tag entity
            </button>
            <span className="ml-auto">Horus uses your sources only. Never trained on.</span>
          </div>
        </footer>
      </section>
    </Reveal>
  );
}

function Message({ m }: { m: (typeof mockChatMessages)[number] }) {
  if (m.role === 'USER') {
    return (
      <div className="flex justify-end">
        <div className="bg-ink text-paper max-w-[78%] rounded-2xl px-5 py-3.5 text-[14.5px] leading-relaxed">
          {m.content}
          <div className="font-technical text-paper/50 mt-1.5 text-right text-[10px] uppercase tracking-[0.18em]">
            {m.at}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <span className="bg-accent/15 font-technical text-accent grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
        H
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-ink text-[14.5px] leading-relaxed">{m.content}</div>
        {m.sources && (
          <div className="mt-4">
            <div className="text-ink-mute text-[10px] font-semibold uppercase tracking-[0.16em]">
              Sources
            </div>
            <ul className="mt-2 space-y-1.5">
              {m.sources.map((s, i) => (
                <li
                  key={i}
                  className="border-hairline bg-paper-soft flex items-center gap-3 rounded-lg border px-3 py-2 text-[12.5px]"
                >
                  <span className="bg-paper font-technical text-accent ring-hairline grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] font-semibold ring-1">
                    {i + 1}
                  </span>
                  <span className="text-ink min-w-0 flex-1 truncate">{s.doc}</span>
                  <span className="font-technical text-ink-faded text-[11px]">p.{s.page}</span>
                  <span className="font-technical text-ink-mute text-[11px]">
                    {(s.score * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="font-technical text-ink-mute mt-3 flex items-center gap-3 text-[10px] uppercase tracking-[0.16em]">
          <span>{m.at}</span>
          {m.latencyMs && <span>· {m.latencyMs} ms</span>}
          {m.tokensIn && (
            <span>
              · {m.tokensIn}↑ {m.tokensOut}↓
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
