'use client';

/**
 * Public incident-reporting demo — the pitch surface.
 *
 * A support coordinator types (or taps a sample) → the real drafting engine
 * fills the NDIS starter form with cited values → statutory clocks appear →
 * they download the Word document, identified or de-identified. Stateless on
 * the server; the banner says so because it's true.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Camera,
  Clock,
  Download,
  FileCheck2,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Wordmark } from '@/components/horus';
import { Button } from '@/components/ui/button';

/* ── Draft payload types (mirrors /api/playground/incidents/draft) ────── */

interface FieldDraft {
  value: string | string[] | boolean | number | null;
  confidence?: 'high' | 'medium' | 'low' | 'manual';
  evidence?: Array<{ evidenceId: string; quote: string }>;
}
interface TemplateField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  pii: boolean;
  section: string;
  options?: string[];
  conditional?: { field: string; equals: string };
}
interface DraftResponse {
  template: {
    name: string;
    schema: {
      sections: Array<{ key: string; title: string; description?: string }>;
      fields: TemplateField[];
    };
  };
  fields: Record<string, FieldDraft>;
  missingRequired: string[];
  categoryKey: string | null;
  categoryLabel: string | null;
  severity: string;
  title: string;
  summary: string;
  occurredAtIso: string | null;
  awareAtIso: string;
  deadlines: { notifyDueAt: string | null; reportDueAt: string | null; basis: string };
  photo: { description: string; text: string } | null;
  pack: {
    name: string;
    version: string;
    disclaimer: string;
    sources: Array<{ label: string; url: string }>;
  };
}

const SAMPLES: Array<{ label: string; text: string }> = [
  {
    label: 'Medication error',
    text: "During the 8am medication round at the Fairfield group home this morning I realised I'd given Marcus T the evening dose blister pack instead of the morning one. He'd already swallowed the tablets when I noticed the pack said PM. I rang the on-call nurse straight away and she said to monitor him and call poisons info, which I did — they advised he should be okay but to watch for drowsiness. His support coordinator Sarah was told at about 8:30 and his mum was called just after. Marcus seemed fine all morning, a bit sleepy after lunch. I'm the team leader on shift, Priya was with me and saw the whole thing. We've put the AM and PM packs in separate cupboards now.",
  },
  {
    label: 'Unauthorised restraint',
    text: "Last night around 9pm at the Westmead SIL house, James B became very distressed after a phone call and started hitting the wall and then swung at staff member Daniel. Daniel held James's arms against the wall for about a minute until he calmed down. There's no physical restraint authorised in James's behaviour support plan. James wasn't hurt but was upset and went to his room. Daniel told me (shift supervisor, Amy K) when I came on at 10pm and we checked on James together — he was settled. His guardian hasn't been called yet. I think the BSP needs an urgent review because these phone calls keep setting him off.",
  },
];

const selectCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-xl border px-4 py-3 text-[14px] focus:border-accent/60 focus:outline-none';

function isVisible(field: TemplateField, values: Record<string, FieldDraft>): boolean {
  if (!field.conditional) return true;
  const v = values[field.conditional.field]?.value;
  if (typeof v === 'boolean') return String(v) === field.conditional.equals;
  if (Array.isArray(v)) return v.includes(field.conditional.equals);
  return v === field.conditional.equals;
}

function formatValue(value: FieldDraft['value']): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function Countdown({ dueIso }: { dueIso: string }) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(dueIso).getTime() - Date.now();
  const overdue = ms <= 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const text = h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
  return (
    <span className={cn('num font-semibold', overdue ? 'text-red-500' : 'text-ink')}>
      {text}
      {overdue ? ' overdue' : ''}
    </span>
  );
}

export function IncidentsDemoClient() {
  const [narrative, setNarrative] = React.useState('');
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftResponse | null>(null);
  const photoRef = React.useRef<HTMLInputElement>(null);
  const resultRef = React.useRef<HTMLDivElement>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set('narrative', narrative);
    if (photo) body.set('photo', photo);
    try {
      const res = await fetch('/api/playground/incidents/draft', { method: 'POST', body });
      const json = (await res.json()) as DraftResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Drafting failed — try again');
      } else {
        setDraft(json);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setBusy(false);
    }
  }

  async function exportDocx(mode: 'identified' | 'deidentified') {
    if (!draft) return;
    setExporting(mode);
    try {
      const res = await fetch('/api/playground/incidents/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          title: draft.title,
          summary: draft.summary,
          categoryKey: draft.categoryKey,
          severity: draft.severity,
          awareAtIso: draft.awareAtIso,
          occurredAtIso: draft.occurredAtIso,
          narrative,
          photoText: draft.photo?.text ?? null,
          fields: draft.fields,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `INC-DEMO-0001${mode === 'deidentified' ? '-deidentified' : ''}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="bg-paper text-ink min-h-dvh">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="glass sticky top-0 z-30">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 md:px-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <Wordmark size="sm" />
          </Link>
          <span className="eyebrow hidden items-center md:inline-flex">
            <span className="bg-accent relative inline-flex h-1.5 w-1.5 animate-pulse rounded-full" />
            Incident reporting · live demo
          </span>
          <Link
            href="/playground"
            className="text-ink-faded hover:text-ink inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-colors"
          >
            Knowledge playground <ArrowRight size={12} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-12 md:px-6">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            The incident report that writes itself.
            <span className="text-ink-faded"> You stay in charge.</span>
          </h1>
          <p className="text-ink-faded mx-auto mt-4 max-w-xl text-[15px] leading-relaxed">
            Describe what happened the way you'd tell a colleague. Horus fills the NDIS incident
            form with values it can <em>cite back to your words</em>, computes the Commission's
            notification clocks, and hands you the Word document. Nothing is ever submitted for you.
          </p>
        </div>

        {/* ── Intake ────────────────────────────────────────────────────── */}
        <div className="border-hairline bg-paper-soft/40 mx-auto mt-10 max-w-3xl rounded-2xl border p-5 md:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-ink-faded text-[12.5px] font-medium">Try a sample:</span>
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setNarrative(s.text)}
                className="border-hairline hover:border-accent/50 hover:text-accent text-ink-faded rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>
          <textarea
            className={cn(selectCls, 'min-h-[160px] resize-y leading-relaxed')}
            placeholder="During the 8am medication round this morning I realised…"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            disabled={busy}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={photoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                setPhoto(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => photoRef.current?.click()}
            >
              <Camera size={14} /> Add a photo
            </Button>
            {photo && (
              <span className="border-hairline bg-paper inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]">
                <Camera size={12} />
                <span className="max-w-[140px] truncate">{photo.name}</span>
                <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo">
                  <X size={12} />
                </button>
              </span>
            )}
            <div className="flex-1" />
            <Button
              variant="accent"
              disabled={busy || narrative.trim().length < 60}
              onClick={() => void run()}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {busy ? 'Drafting from your words…' : 'Draft the incident report'}
            </Button>
          </div>
          {error && <p className="text-destructive mt-3 text-[13px]">{error}</p>}
          <p className="text-ink-mute mt-4 text-[11.5px] leading-relaxed">
            Demo only — please don't enter real participant details. Nothing you type here is
            stored: the draft is generated in-flight and exists only in your browser.
          </p>
        </div>

        {/* ── Result ────────────────────────────────────────────────────── */}
        {draft && (
          <div ref={resultRef} className="mx-auto mt-12 max-w-3xl space-y-6">
            {/* Verdict row */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="border-hairline bg-paper rounded-2xl border p-4">
                <div className="text-ink-faded flex items-center gap-1.5 text-[11.5px] font-medium">
                  <ShieldCheck size={13} className="text-accent" /> Suggested category
                </div>
                <div className="text-ink mt-1.5 text-[14px] font-semibold leading-snug">
                  {draft.categoryLabel ?? 'Not reportable'}
                </div>
                <div className="text-ink-faded mt-0.5 text-[12px]">severity {draft.severity}</div>
              </div>
              <div className="border-hairline bg-paper rounded-2xl border p-4">
                <div className="text-ink-faded flex items-center gap-1.5 text-[11.5px] font-medium">
                  <Clock size={13} className="text-accent" /> Notify Commission
                </div>
                <div className="mt-1.5 text-[18px]">
                  {draft.deadlines.notifyDueAt ? (
                    <Countdown dueIso={draft.deadlines.notifyDueAt} />
                  ) : (
                    <span className="text-ink-faded text-[14px]">No clock</span>
                  )}
                </div>
              </div>
              <div className="border-hairline bg-paper rounded-2xl border p-4">
                <div className="text-ink-faded flex items-center gap-1.5 text-[11.5px] font-medium">
                  <FileCheck2 size={13} className="text-accent" /> Detailed report
                </div>
                <div className="mt-1.5 text-[18px]">
                  {draft.deadlines.reportDueAt ? (
                    <Countdown dueIso={draft.deadlines.reportDueAt} />
                  ) : (
                    <span className="text-ink-faded text-[14px]">No clock</span>
                  )}
                </div>
              </div>
            </div>
            <p className="text-ink-mute -mt-2 text-[11.5px]">{draft.deadlines.basis}</p>

            {draft.photo && (
              <div className="border-hairline bg-paper rounded-2xl border p-4">
                <div className="text-ink-faded mb-1 flex items-center gap-1.5 text-[11.5px] font-medium">
                  <Camera size={13} className="text-accent" /> Photo analysis (gpt-4o vision)
                </div>
                <p className="text-ink text-[13px] leading-relaxed">{draft.photo.description}</p>
              </div>
            )}

            {/* Summary + missing */}
            <div className="border-hairline bg-paper rounded-2xl border p-5">
              <div className="text-ink text-[15px] font-semibold">{draft.title}</div>
              <p className="text-ink-faded mt-1.5 text-[13.5px] leading-relaxed">{draft.summary}</p>
              {draft.missingRequired.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px]">
                  <span className="font-semibold">
                    The AI won't guess. {draft.missingRequired.length} required field
                    {draft.missingRequired.length === 1 ? '' : 's'} left for a human:
                  </span>{' '}
                  <span className="text-ink-soft">
                    {draft.missingRequired
                      .map((k) => draft.template.schema.fields.find((f) => f.key === k)?.label ?? k)
                      .join(' · ')}
                  </span>
                </div>
              )}
            </div>

            {/* The filled form */}
            <div className="border-hairline bg-paper rounded-2xl border">
              <div className="border-hairline flex items-center justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h2 className="text-ink text-[15px] font-semibold">{draft.template.name}</h2>
                  <p className="text-ink-faded text-[12px]">
                    Hover a citation chip to see the exact words each value came from.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={exporting !== null}
                    onClick={() => void exportDocx('identified')}
                  >
                    {exporting === 'identified' ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    Word
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={exporting !== null}
                    title="Names become Participant A / Staff Member 1; identifiers are redacted."
                    onClick={() => void exportDocx('deidentified')}
                  >
                    {exporting === 'deidentified' ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    De-identified
                  </Button>
                </div>
              </div>
              <div className="space-y-6 p-5">
                {draft.template.schema.sections.map((section) => {
                  const rows = draft.template.schema.fields.filter(
                    (f) => f.section === section.key && isVisible(f, draft.fields),
                  );
                  if (rows.length === 0) return null;
                  return (
                    <div key={section.key}>
                      <h3 className="text-ink-mute mb-2 text-[10.5px] font-semibold uppercase tracking-[0.16em]">
                        {section.title}
                      </h3>
                      <dl className="divide-hairline divide-y">
                        {rows.map((field) => {
                          const cell = draft.fields[field.key];
                          const filled = cell !== undefined;
                          return (
                            <div
                              key={field.key}
                              className="grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4"
                            >
                              <dt className="text-ink-faded text-[12.5px] sm:pt-0.5">
                                {field.label}
                                {field.required && <span className="text-red-400"> *</span>}
                              </dt>
                              <dd className="sm:col-span-2">
                                <span
                                  className={cn(
                                    'text-[13.5px] leading-relaxed',
                                    filled ? 'text-ink' : 'text-ink-mute italic',
                                  )}
                                >
                                  {filled ? formatValue(cell!.value) : 'left for a human'}
                                </span>
                                {(cell?.evidence ?? []).map((ref, i) => (
                                  <span
                                    key={i}
                                    title={`“${ref.quote}”`}
                                    className="border-hairline bg-paper-soft text-ink-faded ml-2 inline-flex max-w-[260px] cursor-help items-center gap-1 truncate rounded-full border px-2 py-0.5 align-middle text-[10.5px]"
                                  >
                                    <span className="text-accent">❝</span>
                                    <span className="truncate">{ref.quote.slice(0, 46)}…</span>
                                  </span>
                                ))}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pitch close */}
            <div className="border-accent/25 bg-accent/5 rounded-2xl border p-5 text-center">
              <p className="text-ink text-[14.5px] font-medium">
                In production this runs on <em>your</em> forms — upload the incident form you use
                today and Horus absorbs it. Review, approve, export. Every step audited.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                <Button asChild size="sm" variant="accent">
                  <Link href="/contact">Talk to us</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/playground">
                    See the knowledge engine <ArrowRight size={13} />
                  </Link>
                </Button>
              </div>
            </div>

            <p className="text-ink-mute text-[11.5px] leading-relaxed">
              {draft.pack.disclaimer} Reference:{' '}
              {draft.pack.sources.map((s, i) => (
                <React.Fragment key={s.url}>
                  {i > 0 && ' · '}
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                    {s.label}
                  </a>
                </React.Fragment>
              ))}{' '}
              (pack v{draft.pack.version})
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
