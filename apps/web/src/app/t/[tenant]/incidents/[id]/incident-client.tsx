'use client';

/**
 * Incident review screen — where the human does their part.
 *
 * Left: the form, grouped by the template's own sections. AI-filled values
 * show their confidence and cite the evidence they came from; anything the
 * reviewer edits becomes "manual" and is never overwritten by a re-draft.
 * Right: statutory clocks, lifecycle actions, evidence, timeline.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Camera,
  Download,
  FileText,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  StickyNote,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel, Pill } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { severityTone, statusLabel, statusTone } from '../ui';

/* ── Types mirrored from the server page ─────────────────────────────── */

type FieldValue = string | string[] | boolean | number | null;
interface FieldDraft {
  value: FieldValue;
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
  help?: string;
  conditional?: { field: string; equals: string };
}

export interface IncidentView {
  id: string;
  ref: string;
  title: string;
  status: string;
  severity: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  occurredAt: string | null;
  discoveredAt: string | null;
  location: string | null;
  summary: string | null;
  fields: Record<string, FieldDraft>;
  missingRequired: string[];
  notifyDueAt: string | null;
  reportDueAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  templateName: string;
  schema: {
    sections: Array<{ key: string; title: string; description?: string }>;
    fields: TemplateField[];
  };
  evidence: Array<{
    id: string;
    kind: string;
    label: string;
    text: string | null;
    createdAt: string;
  }>;
  events: Array<{ id: string; kind: string; note: string | null; createdAt: string }>;
}

interface Props {
  slug: string;
  incident: IncidentView;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  categories: Array<{ key: string; label: string }>;
  disclaimer: string;
}

const inputCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-lg border px-2.5 py-1.5 text-[13px] focus:border-accent/60 focus:outline-none disabled:opacity-60';

const EVENT_LABELS: Record<string, string> = {
  created: 'Incident created',
  drafted: 'AI draft generated',
  field_updated: 'Fields edited',
  evidence_added: 'Evidence added',
  submitted: 'Submitted for review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  exported_identified: 'Exported (identified)',
  exported_deidentified: 'Exported (de-identified)',
  closed: 'Closed',
};

function isVisible(field: TemplateField, values: Record<string, FieldDraft>): boolean {
  if (!field.conditional) return true;
  const v = values[field.conditional.field]?.value;
  if (typeof v === 'boolean') return String(v) === field.conditional.equals;
  if (Array.isArray(v)) return v.includes(field.conditional.equals);
  return v === field.conditional.equals;
}

function clock(dueIso: string | null): { text: string; overdue: boolean } | null {
  if (!dueIso) return null;
  const ms = new Date(dueIso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const label = h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
  return ms <= 0
    ? { text: `${label} overdue`, overdue: true }
    : { text: `${label} left`, overdue: false };
}

export function IncidentClient({ slug, incident, role, categories, disclaimer }: Props) {
  const router = useRouter();
  const [fields, setFields] = React.useState<Record<string, FieldDraft>>(incident.fields);
  const [dirty, setDirty] = React.useState<Record<string, FieldValue>>({});
  const [meta, setMeta] = React.useState({
    title: incident.title,
    categoryKey: incident.categoryKey ?? '',
    severity: incident.severity,
    location: incident.location ?? '',
    summary: incident.summary ?? '',
  });
  const [metaDirty, setMetaDirty] = React.useState(false);
  const [note, setNote] = React.useState({ label: '', text: '', open: false });
  const [banner, setBanner] = React.useState<string | null>(null);
  const photoRef = React.useRef<HTMLInputElement>(null);
  const docRef = React.useRef<HTMLInputElement>(null);

  const canEdit =
    role !== 'VIEWER' && incident.status !== 'CLOSED' && incident.status !== 'EXPORTED';
  const canReview = role === 'ADMIN' || role === 'OWNER';
  const evidenceById = new Map(incident.evidence.map((e) => [e.id, e]));

  const refresh = () => router.refresh();
  const onErr = (err: { message: string }) => setBanner(err.message);

  const update = trpc.incidents.update.useMutation({ onSuccess: refresh, onError: onErr });
  const redraft = trpc.incidents.draft.useMutation({ onSuccess: refresh, onError: onErr });
  const submit = trpc.incidents.submit.useMutation({ onSuccess: refresh, onError: onErr });
  const approve = trpc.incidents.approve.useMutation({ onSuccess: refresh, onError: onErr });
  const requestChanges = trpc.incidents.requestChanges.useMutation({
    onSuccess: refresh,
    onError: onErr,
  });
  const close = trpc.incidents.close.useMutation({ onSuccess: refresh, onError: onErr });
  const addNote = trpc.incidents.addNoteEvidence.useMutation({
    onSuccess: () => {
      setNote({ label: '', text: '', open: false });
      refresh();
    },
    onError: onErr,
  });

  const anyPending =
    update.isPending ||
    redraft.isPending ||
    submit.isPending ||
    approve.isPending ||
    requestChanges.isPending ||
    close.isPending;

  function setField(key: string, value: FieldValue) {
    setFields((f) => ({
      ...f,
      [key]: { value, confidence: 'manual', evidence: f[key]?.evidence },
    }));
    setDirty((d) => ({ ...d, [key]: value }));
  }

  function saveAll() {
    update.mutate({
      incidentId: incident.id,
      ...(metaDirty && {
        title: meta.title,
        categoryKey: meta.categoryKey || null,
        severity: meta.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        location: meta.location || null,
        summary: meta.summary || null,
      }),
      ...(Object.keys(dirty).length > 0 && { fields: dirty }),
    });
    setDirty({});
    setMetaDirty(false);
  }

  async function attach(file: File, kind: 'photo' | 'document') {
    const body = new FormData();
    body.set('tenant', slug);
    body.set('incidentId', incident.id);
    body.set('file', file);
    const endpoint = kind === 'photo' ? '/api/incidents/photo' : '/api/incidents/parse-file';
    const res = await fetch(endpoint, { method: 'POST', body });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setBanner(json?.error ?? `Failed to attach ${file.name}`);
      return;
    }
    refresh();
  }

  const notify = clock(incident.notifyDueAt);
  const report = clock(incident.reportDueAt);
  const missingLabels = incident.missingRequired
    .map((key) => incident.schema.fields.find((f) => f.key === key)?.label ?? key)
    .slice(0, 12);
  const hasUnsaved = Object.keys(dirty).length > 0 || metaDirty;

  return (
    <>
      <PageHeader
        eyebrow={`Incidents / ${incident.ref}`}
        title={incident.title}
        description={`${incident.templateName} · reported ${new Date(incident.createdAt).toLocaleString('en-AU')}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={severityTone(incident.severity)}>{incident.severity.toLowerCase()}</Pill>
            <Pill tone={statusTone(incident.status)}>{statusLabel(incident.status)}</Pill>
          </div>
        }
      />

      {banner && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mb-6 flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-[13px]">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="font-medium">
            Dismiss
          </button>
        </div>
      )}

      {(notify || report) && (
        <div
          className={cn(
            'mb-6 rounded-xl border px-4 py-3',
            notify?.overdue || report?.overdue
              ? 'border-red-500/30 bg-red-500/10'
              : 'border-amber-500/30 bg-amber-500/10',
          )}
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
            <span className="text-ink font-semibold">
              {incident.categoryLabel ?? 'Statutory clocks'}
            </span>
            {notify && (
              <span className={notify.overdue ? 'text-red-500' : 'text-ink-soft'}>
                Commission notification: {notify.text}
              </span>
            )}
            {report && (
              <span className={report.overdue ? 'text-red-500' : 'text-ink-soft'}>
                Detailed report: {report.text}
              </span>
            )}
          </div>
          <p className="text-ink-mute mt-1 text-[11.5px]">{disclaimer}</p>
        </div>
      )}

      {incident.missingRequired.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px]">
          <span className="text-ink font-semibold">
            {incident.missingRequired.length} required field
            {incident.missingRequired.length === 1 ? '' : 's'} still missing:
          </span>{' '}
          <span className="text-ink-soft">{missingLabels.join(' · ')}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── The form ─────────────────────────────────────────────────── */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Classification">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">Title</span>
                <input
                  className={inputCls}
                  value={meta.title}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setMeta((m) => ({ ...m, title: e.target.value }));
                    setMetaDirty(true);
                  }}
                />
              </label>
              <label className="block">
                <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">
                  NDIS category
                </span>
                <select
                  className={inputCls}
                  value={meta.categoryKey}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setMeta((m) => ({ ...m, categoryKey: e.target.value }));
                    setMetaDirty(true);
                  }}
                >
                  <option value="">Not reportable / unclassified</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">
                  Severity
                </span>
                <select
                  className={inputCls}
                  value={meta.severity}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setMeta((m) => ({ ...m, severity: e.target.value }));
                    setMetaDirty(true);
                  }}
                >
                  {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">
                  Summary
                </span>
                <textarea
                  className={cn(inputCls, 'min-h-[70px] resize-y')}
                  value={meta.summary}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setMeta((m) => ({ ...m, summary: e.target.value }));
                    setMetaDirty(true);
                  }}
                />
              </label>
            </div>
          </Panel>

          {incident.schema.sections.map((section) => {
            const sectionFields = incident.schema.fields.filter(
              (f) => f.section === section.key && isVisible(f, fields),
            );
            if (sectionFields.length === 0) return null;
            return (
              <Panel key={section.key} title={section.title} description={section.description}>
                <div className="space-y-4">
                  {sectionFields.map((field) => (
                    <FieldEditor
                      key={field.key}
                      field={field}
                      draft={fields[field.key]}
                      disabled={!canEdit}
                      missing={incident.missingRequired.includes(field.key)}
                      evidenceById={evidenceById}
                      onChange={(v) => setField(field.key, v)}
                    />
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>

        {/* ── Rail ─────────────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Panel title="Actions">
            <div className="flex flex-col gap-2">
              {hasUnsaved && canEdit && (
                <Button variant="accent" size="sm" disabled={anyPending} onClick={saveAll}>
                  {update.isPending && <Loader2 size={13} className="animate-spin" />}
                  Save changes
                </Button>
              )}
              {canEdit && (incident.status === 'DRAFT' || incident.status === 'IN_REVIEW') && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={anyPending}
                  onClick={() => redraft.mutate({ incidentId: incident.id })}
                  title="Re-run the AI over all evidence. Your manual edits are never overwritten."
                >
                  {redraft.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  Re-draft from evidence
                </Button>
              )}
              {canEdit && incident.status === 'DRAFT' && (
                <Button
                  variant="default"
                  size="sm"
                  disabled={anyPending || hasUnsaved}
                  title={hasUnsaved ? 'Save your changes first' : undefined}
                  onClick={() => submit.mutate({ incidentId: incident.id })}
                >
                  Submit for review
                </Button>
              )}
              {canReview && incident.status === 'IN_REVIEW' && (
                <>
                  <Button
                    variant="accent"
                    size="sm"
                    disabled={anyPending || incident.missingRequired.length > 0}
                    title={
                      incident.missingRequired.length > 0
                        ? 'Required fields are still missing'
                        : undefined
                    }
                    onClick={() => approve.mutate({ incidentId: incident.id })}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={anyPending}
                    onClick={() => {
                      const reviewNote = window.prompt('What needs to change?');
                      if (reviewNote?.trim()) {
                        requestChanges.mutate({ incidentId: incident.id, note: reviewNote.trim() });
                      }
                    }}
                  >
                    Request changes
                  </Button>
                </>
              )}
              {(incident.status === 'APPROVED' || incident.status === 'EXPORTED') && (
                <>
                  <Button asChild variant="accent" size="sm">
                    <a
                      href={`/api/incidents/export?tenant=${slug}&id=${incident.id}&mode=identified`}
                    >
                      <Download size={13} /> Export .docx
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/api/incidents/export?tenant=${slug}&id=${incident.id}&mode=deidentified`}
                    >
                      <Download size={13} /> De-identified .docx
                    </a>
                  </Button>
                  {role !== 'VIEWER' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={anyPending}
                      onClick={() => close.mutate({ incidentId: incident.id })}
                    >
                      Close incident
                    </Button>
                  )}
                </>
              )}
              {(incident.status === 'DRAFT' || incident.status === 'IN_REVIEW') && (
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={`/api/incidents/export?tenant=${slug}&id=${incident.id}&mode=identified`}
                  >
                    <Download size={13} /> Draft .docx (watermarked)
                  </a>
                </Button>
              )}
            </div>
            <p className="text-ink-mute mt-3 text-[11.5px] leading-relaxed">
              Horus never lodges anything with the Commission — you export, review, and submit
              through the NDIS portal yourself.
            </p>
          </Panel>

          <Panel
            title="Evidence"
            action={
              canEdit ? (
                <div className="flex gap-1.5">
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void attach(f, 'photo');
                      e.target.value = '';
                    }}
                  />
                  <input
                    ref={docRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void attach(f, 'document');
                      e.target.value = '';
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={() => photoRef.current?.click()}>
                    <Camera size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => docRef.current?.click()}>
                    <FileText size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setNote((n) => ({ ...n, open: !n.open }))}
                  >
                    <StickyNote size={13} />
                  </Button>
                </div>
              ) : undefined
            }
          >
            {note.open && (
              <div className="border-hairline mb-4 space-y-2 rounded-lg border p-3">
                <input
                  className={inputCls}
                  placeholder="Note label (e.g. Phone call with family)"
                  value={note.label}
                  onChange={(e) => setNote((n) => ({ ...n, label: e.target.value }))}
                />
                <textarea
                  className={cn(inputCls, 'min-h-[80px] resize-y')}
                  placeholder="What was said / observed…"
                  value={note.text}
                  onChange={(e) => setNote((n) => ({ ...n, text: e.target.value }))}
                />
                <Button
                  size="sm"
                  variant="accent"
                  disabled={addNote.isPending || !note.label.trim() || !note.text.trim()}
                  onClick={() =>
                    addNote.mutate({
                      incidentId: incident.id,
                      label: note.label.trim(),
                      text: note.text.trim(),
                    })
                  }
                >
                  {addNote.isPending && <Loader2 size={13} className="animate-spin" />}
                  <MessageSquarePlus size={13} /> Add note
                </Button>
              </div>
            )}
            <ul className="space-y-3">
              {incident.evidence.map((item) => (
                <li key={item.id} className="text-[13px]">
                  <details>
                    <summary className="text-ink hover:text-accent cursor-pointer font-medium">
                      <span className="mono text-ink-mute mr-1.5 text-[10.5px] uppercase">
                        {item.kind}
                      </span>
                      {item.label}
                    </summary>
                    {item.text && (
                      <p className="text-ink-faded border-hairline mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 pl-3 text-[12.5px] leading-relaxed">
                        {item.text.slice(0, 2000)}
                      </p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Timeline">
            <ul className="space-y-3">
              {incident.events.map((event) => (
                <li key={event.id} className="flex gap-3 text-[12.5px]">
                  <span className="bg-accent/60 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                  <div className="min-w-0">
                    <div className="text-ink">{EVENT_LABELS[event.kind] ?? event.kind}</div>
                    {event.note && <div className="text-ink-faded mt-0.5">“{event.note}”</div>}
                    <div className="text-ink-mute mt-0.5 text-[11px]">
                      {new Date(event.createdAt).toLocaleString('en-AU')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ── Field editor ──────────────────────────────────────────────────────── */

const CONFIDENCE_DOT: Record<string, string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-red-400',
  manual: 'bg-accent',
};

function FieldEditor({
  field,
  draft,
  disabled,
  missing,
  evidenceById,
  onChange,
}: {
  field: TemplateField;
  draft: FieldDraft | undefined;
  disabled: boolean;
  missing: boolean;
  evidenceById: Map<string, { label: string }>;
  onChange: (value: FieldValue) => void;
}) {
  const value = draft?.value;
  const confidence = draft?.confidence;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-ink-faded text-[12.5px] font-medium">
          {field.label}
          {field.required && <span className="text-red-400"> *</span>}
        </span>
        {field.pii && (
          <span className="text-ink-mute border-hairline rounded border px-1 text-[10px] uppercase tracking-wide">
            pii
          </span>
        )}
        {confidence && (
          <span
            className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide"
            title={
              confidence === 'manual'
                ? 'Edited by a person — the AI will not overwrite this'
                : `AI confidence: ${confidence}`
            }
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', CONFIDENCE_DOT[confidence])} />
            <span className="text-ink-mute">{confidence === 'manual' ? 'edited' : confidence}</span>
          </span>
        )}
        {missing && <span className="text-[11px] font-medium text-amber-500">needs a value</span>}
      </div>

      {field.type === 'textarea' ? (
        <textarea
          className={cn(inputCls, 'min-h-[90px] resize-y leading-relaxed')}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'checkbox' ? (
        <label className="text-ink flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {value === true ? 'Yes' : 'No'}
        </label>
      ) : field.type === 'select' ? (
        <select
          className={inputCls}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === 'multiselect' ? (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((option) => {
            const selected = Array.isArray(value) && value.includes(option);
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => {
                  const current = Array.isArray(value) ? value : [];
                  onChange(selected ? current.filter((v) => v !== option) : [...current, option]);
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  selected
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-hairline text-ink-faded hover:text-ink',
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : (
        <input
          type={
            field.type === 'date'
              ? 'date'
              : field.type === 'datetime'
                ? 'datetime-local'
                : field.type === 'time'
                  ? 'time'
                  : field.type === 'number'
                    ? 'number'
                    : 'text'
          }
          className={inputCls}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              field.type === 'number'
                ? e.target.value === ''
                  ? null
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}

      {field.help && <p className="text-ink-mute mt-1 text-[11.5px]">{field.help}</p>}

      {(draft?.evidence ?? []).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(draft?.evidence ?? []).map((ref, i) => (
            <span
              key={i}
              title={`“${ref.quote}”`}
              className="border-hairline bg-paper-soft text-ink-faded inline-flex max-w-full cursor-help items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px]"
            >
              <span className="text-accent">❝</span>
              <span className="truncate">
                {evidenceById.get(ref.evidenceId)?.label ?? 'evidence'}: “{ref.quote.slice(0, 70)}
                {ref.quote.length > 70 ? '…' : ''}”
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
