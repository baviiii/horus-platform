'use client';

/**
 * Intake: narrative + optional attachments → create incident → attach
 * evidence → AI draft → straight to the review screen. The reporter sees
 * each stage as it happens; nothing here feels like filling in a form —
 * that part is the machine's job now.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Camera, FileText, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/app/shell';

interface Props {
  slug: string;
  templates: Array<{ id: string; name: string }>;
  categories: Array<{ key: string; label: string }>;
}

type Attachment = { file: File; kind: 'photo' | 'document' };

type Phase =
  | { step: 'compose' }
  | { step: 'creating' }
  | { step: 'uploading'; done: number; total: number }
  | { step: 'drafting' }
  | { step: 'error'; message: string };

const selectCls =
  'border-hairline bg-paper text-ink w-full rounded-lg border px-3 py-2 text-[13.5px] focus:border-accent/60 focus:outline-none';

export function NewIncidentClient({ slug, templates, categories }: Props) {
  const router = useRouter();
  const [templateId, setTemplateId] = React.useState(templates[0]?.id ?? '');
  const [categoryKey, setCategoryKey] = React.useState('');
  const [occurredAt, setOccurredAt] = React.useState('');
  const [discoveredAt, setDiscoveredAt] = React.useState('');
  const [narrative, setNarrative] = React.useState('');
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [phase, setPhase] = React.useState<Phase>({ step: 'compose' });
  const photoRef = React.useRef<HTMLInputElement>(null);
  const docRef = React.useRef<HTMLInputElement>(null);

  const create = trpc.incidents.create.useMutation();
  const draft = trpc.incidents.draft.useMutation();

  const busy = phase.step !== 'compose' && phase.step !== 'error';

  async function run() {
    if (narrative.trim().length < 40) {
      setPhase({
        step: 'error',
        message: 'Describe the incident first — at least a few sentences.',
      });
      return;
    }
    try {
      setPhase({ step: 'creating' });
      const incident = await create.mutateAsync({
        templateId,
        narrative: narrative.trim(),
        ...(categoryKey && { categoryKey }),
        ...(occurredAt && { occurredAt: new Date(occurredAt) }),
        ...(discoveredAt && { discoveredAt: new Date(discoveredAt) }),
      });

      for (let i = 0; i < attachments.length; i++) {
        setPhase({ step: 'uploading', done: i, total: attachments.length });
        const att = attachments[i]!;
        const body = new FormData();
        body.set('tenant', slug);
        body.set('incidentId', incident.id);
        body.set('file', att.file);
        const endpoint =
          att.kind === 'photo' ? '/api/incidents/photo' : '/api/incidents/parse-file';
        const res = await fetch(endpoint, { method: 'POST', body });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(json?.error ?? `Failed to attach ${att.file.name}`);
        }
      }

      setPhase({ step: 'drafting' });
      await draft.mutateAsync({ incidentId: incident.id });
      router.push(`/t/${slug}/incidents/${incident.id}`);
    } catch (err) {
      setPhase({
        step: 'error',
        message: err instanceof Error ? err.message : 'Something failed — try again',
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Panel title="Report">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">Template</span>
            <select
              className={selectCls}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={busy}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">
              NDIS category
            </span>
            <select
              className={selectCls}
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              disabled={busy}
            >
              <option value="">Let the AI suggest</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">
              When it happened <span className="text-ink-mute">(optional)</span>
            </span>
            <input
              type="datetime-local"
              className={selectCls}
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block">
            <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">
              When your team became aware <span className="text-ink-mute">(starts the clock)</span>
            </span>
            <input
              type="datetime-local"
              className={selectCls}
              value={discoveredAt}
              onChange={(e) => setDiscoveredAt(e.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-ink-faded mb-1.5 block text-[12.5px] font-medium">
            What happened
          </span>
          <textarea
            className={cn(selectCls, 'min-h-[180px] resize-y leading-relaxed')}
            placeholder="Plain language, in order. Who was involved, what you saw, what was done immediately, who was told…"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            disabled={busy}
          />
          <span className="text-ink-mute mt-1 block text-[11.5px]">
            The AI only uses what you write and attach — anything it can't cite stays empty for a
            human to fill.
          </span>
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setAttachments((a) => [...a, { file, kind: 'photo' }]);
              e.target.value = '';
            }}
          />
          <input
            ref={docRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setAttachments((a) => [...a, { file, kind: 'document' }]);
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => photoRef.current?.click()}
          >
            <Camera size={14} /> Photo
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => docRef.current?.click()}
          >
            <FileText size={14} /> Document
          </Button>
          {attachments.map((att, ix) => (
            <span
              key={`${att.file.name}-${ix}`}
              className="border-hairline bg-paper-soft text-ink inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]"
            >
              {att.kind === 'photo' ? <Camera size={12} /> : <FileText size={12} />}
              <span className="max-w-[160px] truncate">{att.file.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => setAttachments((a) => a.filter((_, i) => i !== ix))}
                className="text-ink-mute hover:text-ink"
                aria-label={`Remove ${att.file.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </Panel>

      <div className="flex items-center gap-4">
        <Button variant="accent" disabled={busy} onClick={() => void run()}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          {phase.step === 'creating'
            ? 'Creating incident…'
            : phase.step === 'uploading'
              ? `Attaching evidence ${phase.done + 1}/${phase.total}…`
              : phase.step === 'drafting'
                ? 'Drafting with AI…'
                : 'Create & draft with AI'}
        </Button>
        {phase.step === 'error' && <p className="text-destructive text-[13px]">{phase.message}</p>}
      </div>
    </div>
  );
}
