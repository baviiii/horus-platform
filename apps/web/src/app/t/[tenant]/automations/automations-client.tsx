'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/app/shell';

type Trigger = 'DOCUMENT_INDEXED' | 'CHAT_SESSION_ENDED' | 'SCHEDULE' | 'WEBHOOK';
type Status = 'DRAFT' | 'ACTIVE' | 'PAUSED';
type ActionKind = 'webhook' | 'alert' | 'email' | 'infer';

interface Automation {
  id: string;
  name: string;
  description: string | null;
  trigger: Trigger;
  status: Status;
  runCount: number;
  lastRunAt: string | null;
  lastError: string | null;
}

const inputCls =
  'border-hairline bg-paper text-ink placeholder:text-ink-mute w-full rounded-xl border px-4 py-2.5 text-[13.5px] focus:border-accent/60 focus:outline-none';

const triggerLabel: Record<Trigger, string> = {
  DOCUMENT_INDEXED: 'document indexed',
  CHAT_SESSION_ENDED: 'chat session ended',
  SCHEDULE: 'on schedule',
  WEBHOOK: 'inbound webhook',
};

export function AutomationsClient({ initial }: { initial: Automation[] }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [trigger, setTrigger] = React.useState<Trigger>('DOCUMENT_INDEXED');
  const [actionKind, setActionKind] = React.useState<ActionKind>('alert');
  const [actionTarget, setActionTarget] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const createMut = trpc.automations.create.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });
  const statusMut = trpc.automations.setStatus.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });
  const deleteMut = trpc.automations.delete.useMutation({
    onSuccess: () => router.refresh(),
    onError: (e) => setError(e.message),
  });

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    await createMut.mutateAsync({
      name: name.trim(),
      trigger,
      triggerConfig: {},
      action: {
        kind: actionKind,
        config: actionTarget.trim() ? { target: actionTarget.trim() } : {},
      },
    });
    setName('');
    setActionTarget('');
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onCreate}
        className="border-hairline grid gap-3 rounded-xl border p-4 md:grid-cols-[1.4fr_0.9fr_0.9fr_1fr_auto]"
      >
        <input
          className={inputCls}
          placeholder="Automation name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <select
          className={inputCls}
          value={trigger}
          onChange={(e) => setTrigger(e.target.value as Trigger)}
        >
          {Object.entries(triggerLabel).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={actionKind}
          onChange={(e) => setActionKind(e.target.value as ActionKind)}
        >
          <option value="alert">raise alert</option>
          <option value="email">send email</option>
          <option value="webhook">call webhook</option>
          <option value="infer">run AI inference</option>
        </select>
        <input
          className={inputCls}
          placeholder={
            actionKind === 'email'
              ? 'recipient email'
              : actionKind === 'webhook'
                ? 'https://…'
                : actionKind === 'infer'
                  ? 'prompt key'
                  : 'alert title'
          }
          value={actionTarget}
          onChange={(e) => setActionTarget(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={createMut.isPending || !name.trim()}>
          {createMut.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          New
        </Button>
      </form>
      {error && <p className="text-destructive text-[12.5px]">{error}</p>}

      {initial.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-ink text-[15px] font-medium">No automations yet.</p>
          <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
            An automation watches for a trigger (a document indexed, a session ending, a schedule, a
            webhook) and runs an action. Create one above, then flip it to <em>active</em>.
          </p>
        </div>
      ) : (
        <ul className="divide-hairline -my-2 divide-y">
          {initial.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink truncate text-[14px] font-medium">{a.name}</span>
                  <Pill
                    tone={
                      a.status === 'ACTIVE' ? 'success' : a.status === 'PAUSED' ? 'warn' : 'default'
                    }
                  >
                    {a.status.toLowerCase()}
                  </Pill>
                  <Pill>{triggerLabel[a.trigger]}</Pill>
                </div>
                <div className="text-ink-faded mt-0.5 text-[12px]">
                  {a.runCount} runs
                  {a.lastRunAt && ` · last run ${new Date(a.lastRunAt).toLocaleString()}`}
                </div>
                {a.lastError && (
                  <div className="text-destructive mt-0.5 text-[12px]">{a.lastError}</div>
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
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete automation "${a.name}"?`)) {
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
