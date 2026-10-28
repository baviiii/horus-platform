'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { inviteMemberAction, type InviteResult } from './actions';

const ROLE_OPTIONS = [
  { value: 'MEMBER', label: 'Member' },
  { value: 'VIEWER', label: 'Viewer' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'OWNER', label: 'Owner' },
];

export function InviteForm({
  slug,
  canInviteOwner,
  signupUrl,
  workspaceName,
}: {
  slug: string;
  canInviteOwner: boolean;
  signupUrl: string;
  workspaceName: string;
}) {
  const action = inviteMemberAction.bind(null, slug);
  const [result, formAction, pending] = useActionState<InviteResult | null, FormData>(action, null);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          name="email"
          type="email"
          placeholder="name@company.com"
          required
          maxLength={254}
          className="focus-ring border-hairline-strong bg-paper placeholder:text-ink-mute/70 h-9 min-w-[220px] flex-1 rounded-full border px-4 text-[13px] outline-none"
        />
        <select
          name="role"
          defaultValue="MEMBER"
          className="focus-ring border-hairline-strong bg-paper h-9 rounded-full border px-3 text-[13px] outline-none"
        >
          {ROLE_OPTIONS.filter((r) => canInviteOwner || r.value !== 'OWNER').map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? 'Inviting…' : 'Invite'}
        </Button>
      </form>

      {result?.error && <p className="text-destructive mt-2 text-[12.5px]">{result.error}</p>}

      {result?.ok && result.email && (
        <div className="border-accent/40 bg-accent-soft mt-3 rounded-xl border p-4 text-[13px]">
          <p className="text-ink font-semibold">Invite ready for {result.email}.</p>
          <p className="text-ink-faded mt-1">
            Horus doesn&apos;t email invites yet — send them this link. Once they sign up (or sign
            in) with <span className="text-ink">{result.email}</span> and confirm the address, they
            land in {workspaceName}.
          </p>
          <code className="mono text-ink mt-2 block select-all break-all rounded-lg bg-white/60 p-3 text-[12px]">
            {signupUrl}
          </code>
        </div>
      )}
    </div>
  );
}
