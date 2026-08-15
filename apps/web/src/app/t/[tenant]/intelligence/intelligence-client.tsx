'use client';

/**
 * Intelligence briefs — the GraphRAG deep-dive surface.
 *
 * Subject + focus → graph anchor + retrieved passages → a structured brief.
 * Everything on screen is traceable: key numbers carry their citation, the
 * graph badge says how many edges shaped the answer, and "gaps" states what
 * the corpus does not cover rather than papering over it.
 */
import * as React from 'react';
import {
  AlertCircle,
  BookOpen,
  Coins,
  GraduationCap,
  Loader2,
  Network,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Panel, Pill } from '@/components/app/shell';

type Focus = 'overview' | 'funding' | 'skills' | 'outlook';

interface BriefShape {
  title?: string;
  overview?: string;
  key_numbers?: Array<{ label?: string; value?: string; n?: number }>;
  programs_and_funding?: Array<{ name?: string; detail?: string; n?: number }>;
  skills_and_occupations?: Array<{ name?: string; detail?: string; n?: number }>;
  outlook?: string;
  gaps?: string[];
}

const FOCUSES: Array<{ key: Focus; label: string; icon: React.ReactNode; hint: string }> = [
  { key: 'overview', label: 'Overview', icon: <BookOpen size={13} />, hint: 'What is going on' },
  { key: 'funding', label: 'Money', icon: <Coins size={13} />, hint: 'Budgets and programs' },
  {
    key: 'skills',
    label: 'Skills & jobs',
    icon: <GraduationCap size={13} />,
    hint: 'Who is needed',
  },
  { key: 'outlook', label: 'Outlook', icon: <TrendingUp size={13} />, hint: 'Where it is heading' },
];

const inputCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-xl border px-4 py-3 text-[14px] focus:border-accent/60 focus:outline-none';
const selectCls =
  'border-hairline bg-paper text-ink rounded-lg border px-2.5 py-1.5 text-[12.5px] focus:border-accent/60 focus:outline-none';

/** Renders [n] markers as superscript citation chips. */
function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[\d+(?:,\s*\d+)*\])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\[\d+(?:,\s*\d+)*\]$/.test(part) ? (
          <sup key={i} className="text-accent mx-0.5 text-[10px] font-semibold">
            {part}
          </sup>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

export function IntelligenceClient({
  suggestions,
  categories,
  years,
}: {
  suggestions: Array<{ name: string; type: string }>;
  categories: string[];
  years: number[];
}) {
  const [subject, setSubject] = React.useState('');
  const [focus, setFocus] = React.useState<Focus>('overview');
  const [category, setCategory] = React.useState('');
  const [year, setYear] = React.useState('');

  const brief = trpc.intelligence.brief.useMutation();

  function run(subjectOverride?: string) {
    const s = (subjectOverride ?? subject).trim();
    if (s.length < 2) return;
    if (subjectOverride) setSubject(subjectOverride);
    brief.mutate({
      subject: s,
      focus,
      ...(category && { category }),
      ...(year && { year: Number(year) }),
    });
  }

  const data = brief.data?.brief as BriefShape | undefined;
  const citations = brief.data?.citations ?? [];

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          {FOCUSES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFocus(f.key)}
              title={f.hint}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                focus === f.key
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-hairline text-ink-faded hover:text-ink',
              )}
            >
              {f.icon}
              {f.label}
            </button>
          ))}
          <div className="flex-1" />
          {categories.length > 0 && (
            <select
              className={selectCls}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">all areas</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {years.length > 0 && (
            <select className={selectCls} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">all years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            className={cn(inputCls, 'min-w-[240px] flex-1')}
            placeholder="e.g. defence shipbuilding, TAFE SA, early childhood educators…"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
            }}
            disabled={brief.isPending}
          />
          <Button
            variant="accent"
            disabled={brief.isPending || subject.trim().length < 2}
            onClick={() => run()}
          >
            {brief.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            {brief.isPending ? 'Researching…' : 'Build brief'}
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="text-ink-faded mr-1 text-[12px]">In your corpus:</span>
            {suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                disabled={brief.isPending}
                onClick={() => run(s.name)}
                className="border-hairline hover:border-accent/50 hover:text-accent text-ink-faded rounded-full border px-2.5 py-1 text-[12px] transition-colors disabled:opacity-50"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {brief.error && <p className="text-destructive mt-3 text-[13px]">{brief.error.message}</p>}
      </Panel>

      {brief.isPending && (
        <Panel>
          <div className="text-ink-faded flex items-center gap-2 py-8 text-[13.5px]">
            <Loader2 size={15} className="animate-spin" />
            Walking the graph, retrieving passages, writing the brief…
          </div>
        </Panel>
      )}

      {data && !brief.isPending && (
        <>
          <Panel
            title={data.title ?? subject}
            action={
              brief.data?.graph ? (
                <Pill tone="accent">
                  <Network size={11} />
                  graph anchor: {brief.data.graph.entity.name} · {brief.data.graph.edgeCount} edges
                </Pill>
              ) : (
                <Pill>passages only — no graph anchor</Pill>
              )
            }
          >
            {data.overview && (
              <div className="text-ink space-y-3 text-[14px] leading-relaxed">
                {data.overview.split(/\n\n+/).map((para, i) => (
                  <p key={i}>
                    <Cited text={para} />
                  </p>
                ))}
              </div>
            )}

            {(data.key_numbers ?? []).length > 0 && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(data.key_numbers ?? []).slice(0, 8).map((kn, i) => (
                  <div key={i} className="border-hairline bg-paper-soft/40 rounded-xl border p-4">
                    <div className="num text-ink text-[22px] font-semibold tracking-tight">
                      {kn.value ?? '—'}
                    </div>
                    <div className="text-ink-faded mt-1 text-[12px] leading-snug">
                      {kn.label ?? ''}
                      {kn.n ? (
                        <sup className="text-accent ml-0.5 font-semibold">[{kn.n}]</sup>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            {(data.programs_and_funding ?? []).length > 0 && (
              <Panel title="Programs & funding">
                <ul className="space-y-3">
                  {(data.programs_and_funding ?? []).map((p, i) => (
                    <li key={i} className="text-[13.5px]">
                      <div className="text-ink font-medium">
                        {p.name}
                        {p.n ? <sup className="text-accent ml-0.5 text-[10px]">[{p.n}]</sup> : null}
                      </div>
                      {p.detail && (
                        <p className="text-ink-faded mt-0.5 leading-relaxed">{p.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {(data.skills_and_occupations ?? []).length > 0 && (
              <Panel title="Skills & occupations">
                <ul className="space-y-3">
                  {(data.skills_and_occupations ?? []).map((s, i) => (
                    <li key={i} className="text-[13.5px]">
                      <div className="text-ink font-medium">
                        {s.name}
                        {s.n ? <sup className="text-accent ml-0.5 text-[10px]">[{s.n}]</sup> : null}
                      </div>
                      {s.detail && (
                        <p className="text-ink-faded mt-0.5 leading-relaxed">{s.detail}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          {data.outlook && (
            <Panel title="Outlook">
              <p className="text-ink text-[14px] leading-relaxed">
                <Cited text={data.outlook} />
              </p>
            </Panel>
          )}

          {(data.gaps ?? []).length > 0 && (
            <Panel title="What this corpus does not answer">
              <ul className="space-y-2">
                {(data.gaps ?? []).map((gap, i) => (
                  <li key={i} className="text-ink-faded flex gap-2 text-[13px] leading-relaxed">
                    <AlertCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                    {gap}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {citations.length > 0 && (
            <Panel title="Sources" description="Every claim above cites one of these passages.">
              <ol className="space-y-1.5">
                {citations.map((c) => (
                  <li key={c.n} className="flex gap-2.5 text-[12.5px]">
                    <span className="text-accent shrink-0 font-semibold">[{c.n}]</span>
                    <span className="text-ink-faded min-w-0">
                      <span className="text-ink">{c.title}</span>
                      {c.sourceUrl?.startsWith('http') && (
                        <>
                          {' — '}
                          <a
                            href={c.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            source
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
