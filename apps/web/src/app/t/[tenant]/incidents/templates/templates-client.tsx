'use client';

/**
 * Template management: absorb an uploaded form → review the extracted schema
 * → edit fields (label/type/required/PII) → activate. Editing writes a new
 * template version; incidents keep the schema they were drafted against.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Panel, Pill } from '@/components/app/shell';

type FieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'time'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'number';

interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  pii: boolean;
  section: string;
  options?: string[];
  help?: string;
  conditional?: { field: string; equals: string };
}

interface TemplateSchema {
  sections: Array<{ key: string; title: string; description?: string }>;
  fields: TemplateField[];
}

const FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'date',
  'time',
  'datetime',
  'select',
  'multiselect',
  'checkbox',
  'number',
];

const inputCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-lg border px-2.5 py-1.5 text-[13px] focus:border-accent/60 focus:outline-none';

export function TemplatesClient({ slug }: { slug: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const templates = trpc.incidents.listTemplates.useQuery({});
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [uploadState, setUploadState] = React.useState<
    | { phase: 'idle' }
    | { phase: 'extracting' }
    | { phase: 'absorbing'; filename: string }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' });
  const fileRef = React.useRef<HTMLInputElement>(null);

  const absorb = trpc.incidents.absorbTemplate.useMutation({
    onSuccess: (template) => {
      setUploadState({ phase: 'idle' });
      void utils.incidents.listTemplates.invalidate();
      setEditingId(template.id);
      router.refresh();
    },
    onError: (err) => setUploadState({ phase: 'error', message: err.message }),
  });
  const starter = trpc.incidents.createStarterTemplate.useMutation({
    onSuccess: () => {
      void utils.incidents.listTemplates.invalidate();
      router.refresh();
    },
  });
  const setStatus = trpc.incidents.setTemplateStatus.useMutation({
    onSuccess: () => void utils.incidents.listTemplates.invalidate(),
  });

  async function onFile(file: File) {
    setUploadState({ phase: 'extracting' });
    const body = new FormData();
    body.set('tenant', slug);
    body.set('file', file);
    try {
      const res = await fetch('/api/incidents/parse-file', { method: 'POST', body });
      const json = (await res.json()) as { filename?: string; text?: string; error?: string };
      if (!res.ok || !json.text) {
        setUploadState({ phase: 'error', message: json.error ?? 'Extraction failed' });
        return;
      }
      setUploadState({ phase: 'absorbing', filename: json.filename ?? file.name });
      absorb.mutate({ filename: json.filename ?? file.name, text: json.text });
    } catch {
      setUploadState({ phase: 'error', message: 'Upload failed — check your connection' });
    }
  }

  const busy = uploadState.phase === 'extracting' || uploadState.phase === 'absorbing';

  return (
    <div className="space-y-6">
      <Panel
        title="Absorb a form"
        description="PDF, .docx, .txt or .md up to 10 MB. The AI proposes the schema; you stay in control of every field."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => starter.mutate()}
            disabled={starter.isPending}
          >
            {starter.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            NDIS starter template
          </Button>
        }
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className={cn(
            'border-hairline-strong hover:border-accent/50 hover:bg-paper-soft flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 transition-colors',
            busy && 'pointer-events-none opacity-70',
          )}
        >
          {busy ? (
            <>
              <Loader2 size={20} className="text-accent animate-spin" />
              <span className="text-ink text-[13.5px] font-medium">
                {uploadState.phase === 'extracting'
                  ? 'Extracting text…'
                  : `Absorbing "${(uploadState as { filename: string }).filename}" — mapping fields, sections, PII…`}
              </span>
            </>
          ) : (
            <>
              <FileUp size={20} className="text-ink-faded" />
              <span className="text-ink text-[13.5px] font-medium">
                Drop your incident form here or click to browse
              </span>
              <span className="text-ink-faded text-[12px]">
                Your form stays yours — Horus just learns its structure.
              </span>
            </>
          )}
        </button>
        {uploadState.phase === 'error' && (
          <p className="text-destructive mt-3 text-[13px]">{uploadState.message}</p>
        )}
      </Panel>

      {templates.isLoading ? (
        <div className="text-ink-faded flex items-center gap-2 py-8 text-[13.5px]">
          <Loader2 size={14} className="animate-spin" /> Loading templates…
        </div>
      ) : (templates.data ?? []).length === 0 ? (
        <Panel>
          <p className="text-ink-faded py-4 text-center text-[13.5px]">
            No templates yet — absorb your own form above, or start from the NDIS starter template.
          </p>
        </Panel>
      ) : (
        (templates.data ?? []).map((template) => (
          <Panel
            key={template.id}
            title={template.name}
            description={template.description ?? undefined}
            action={
              <div className="flex items-center gap-2">
                <Pill
                  tone={
                    template.status === 'ACTIVE'
                      ? 'success'
                      : template.status === 'ARCHIVED'
                        ? 'default'
                        : 'warn'
                  }
                >
                  {template.status.toLowerCase()} · v{template.version}
                </Pill>
                {template.status !== 'ACTIVE' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: template.id, status: 'ACTIVE' })}
                  >
                    Activate
                  </Button>
                )}
                {template.status === 'ACTIVE' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: template.id, status: 'ARCHIVED' })}
                  >
                    Archive
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={editingId === template.id ? 'subtle' : 'outline'}
                  onClick={() => setEditingId(editingId === template.id ? null : template.id)}
                >
                  <Pencil size={13} />
                  {editingId === template.id ? 'Close editor' : 'Edit fields'}
                </Button>
              </div>
            }
          >
            <div className="text-ink-faded flex flex-wrap gap-4 text-[12.5px]">
              <span>{(template.schema as unknown as TemplateSchema).fields.length} fields</span>
              <span>{(template.schema as unknown as TemplateSchema).sections.length} sections</span>
              <span>
                {(template.schema as unknown as TemplateSchema).fields.filter((f) => f.pii).length}{' '}
                PII-marked
              </span>
              <span>{template._count.incidents} incidents</span>
              {template.sourceDocumentTitle && <span>from “{template.sourceDocumentTitle}”</span>}
            </div>
            {editingId === template.id && (
              <SchemaEditor
                templateId={template.id}
                initial={template.schema as unknown as TemplateSchema}
                onSaved={() => {
                  setEditingId(null);
                  void utils.incidents.listTemplates.invalidate();
                }}
              />
            )}
          </Panel>
        ))
      )}
    </div>
  );
}

/* ── Schema editor ─────────────────────────────────────────────────────── */

function SchemaEditor({
  templateId,
  initial,
  onSaved,
}: {
  templateId: string;
  initial: TemplateSchema;
  onSaved: () => void;
}) {
  const [schema, setSchema] = React.useState<TemplateSchema>(
    () => JSON.parse(JSON.stringify(initial)) as TemplateSchema,
  );
  const update = trpc.incidents.updateTemplate.useMutation({ onSuccess: onSaved });

  function patchField(ix: number, patch: Partial<TemplateField>) {
    setSchema((s) => ({
      ...s,
      fields: s.fields.map((f, i) => (i === ix ? { ...f, ...patch } : f)),
    }));
  }

  function addField(sectionKey: string) {
    const key = `new_field_${Date.now() % 100_000}`;
    setSchema((s) => ({
      ...s,
      fields: [
        ...s.fields,
        { key, label: 'New field', type: 'text', required: false, pii: false, section: sectionKey },
      ],
    }));
  }

  return (
    <div className="border-hairline mt-5 border-t pt-5">
      {schema.sections.map((section) => (
        <div key={section.key} className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-ink text-[13px] font-semibold uppercase tracking-[0.08em]">
              {section.title}
            </h3>
            <Button size="sm" variant="ghost" onClick={() => addField(section.key)}>
              <Plus size={13} /> Field
            </Button>
          </div>
          <ul className="space-y-2">
            {schema.fields.map((field, ix) =>
              field.section === section.key ? (
                <li
                  key={`${field.key}-${ix}`}
                  className="border-hairline bg-paper-soft/50 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
                >
                  <input
                    className={cn(inputCls, 'max-w-[240px] flex-1')}
                    value={field.label}
                    onChange={(e) => patchField(ix, { label: e.target.value })}
                  />
                  <select
                    className={cn(inputCls, 'w-auto')}
                    value={field.type}
                    onChange={(e) => patchField(ix, { type: e.target.value as FieldType })}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <label className="text-ink-faded flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => patchField(ix, { required: e.target.checked })}
                    />
                    required
                  </label>
                  <label className="text-ink-faded flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox"
                      checked={field.pii}
                      onChange={(e) => patchField(ix, { pii: e.target.checked })}
                    />
                    PII
                  </label>
                  {(field.type === 'select' || field.type === 'multiselect') && (
                    <input
                      className={cn(inputCls, 'min-w-[180px] flex-1')}
                      placeholder="options, comma-separated"
                      value={(field.options ?? []).join(', ')}
                      onChange={(e) =>
                        patchField(ix, {
                          options: e.target.value
                            .split(',')
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="text-ink-mute hover:text-destructive ml-auto transition-colors"
                    onClick={() =>
                      setSchema((s) => ({ ...s, fields: s.fields.filter((_, i) => i !== ix) }))
                    }
                    aria-label={`Remove ${field.label}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="accent"
          disabled={update.isPending}
          onClick={() => update.mutate({ id: templateId, schema })}
        >
          {update.isPending && <Loader2 size={13} className="animate-spin" />}
          Save as new version
        </Button>
        {update.error && <p className="text-destructive text-[12.5px]">{update.error.message}</p>}
      </div>
    </div>
  );
}
