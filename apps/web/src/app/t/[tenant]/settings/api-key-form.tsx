'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { createApiKeyAction, type CreateKeyResult } from './actions';

export function ApiKeyForm({ slug }: { slug: string }) {
  const action = createApiKeyAction.bind(null, slug);
  const [result, formAction, pending] = useActionState<CreateKeyResult | null, FormData>(
    action,
    null,
  );

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          placeholder="Key name (e.g. Production · Web app)"
          required
          maxLength={80}
          className="focus-ring border-hairline-strong bg-paper placeholder:text-ink-mute/70 h-9 min-w-[260px] flex-1 rounded-full border px-4 text-[13px] outline-none"
        />
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create key'}
        </Button>
      </form>

      {result?.error && <p className="text-destructive mt-2 text-[12.5px]">{result.error}</p>}

      {result?.ok && result.plaintext && (
        <div className="border-accent/40 bg-accent-soft mt-3 rounded-xl border p-4">
          <p className="text-ink text-[13px] font-semibold">
            Copy this key now — it will never be shown again.
          </p>
          <code className="mono text-ink mt-2 block select-all break-all rounded-lg bg-white/60 p-3 text-[12px]">
            {result.plaintext}
          </code>
        </div>
      )}
    </div>
  );
}
