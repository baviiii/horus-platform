import { PageHeader, Panel, Pill } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockApiKeys, mockMembers, mockTenant } from '@/lib/mock-data';

export const metadata = { title: 'Settings · Horus' };

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  await params;

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings."
        description="Identity, members, keys, billing. Everything plumbed into your tenant."
      />

      <nav className="border-hairline mb-6 flex flex-wrap gap-1 border-b">
        <Tab active>General</Tab>
        <Tab>Members</Tab>
        <Tab>API keys</Tab>
        <Tab>Billing</Tab>
        <Tab>Integrations</Tab>
        <Tab>Webhooks</Tab>
      </nav>

      <Reveal as="div" className="space-y-6">
        <Panel
          title="Workspace identity"
          description="How Horus refers to your tenant in the UI and emails."
        >
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Workspace name" hint="Visible to all members.">
              <input
                defaultValue={mockTenant.name}
                className="border-hairline bg-paper text-ink focus:border-accent h-10 w-full rounded-lg border px-3.5 text-[14px] focus:outline-none"
              />
            </Field>
            <Field label="Slug" hint="Used in URLs. Cannot be changed after creation.">
              <input
                disabled
                defaultValue={mockTenant.slug}
                className="border-hairline bg-paper-soft font-technical text-ink-faded h-10 w-full rounded-lg border px-3.5 text-[13px]"
              />
            </Field>
            <Field label="Plan" hint="Adjust on the billing tab.">
              <div className="border-hairline bg-paper-soft flex h-10 items-center gap-2 rounded-lg border px-3.5">
                <Pill tone="accent">{mockTenant.plan}</Pill>
                <span className="text-ink-faded text-[12.5px]">until 2026-12-31</span>
              </div>
            </Field>
            <Field label="Created" hint="">
              <div className="font-technical text-ink-faded flex h-10 items-center text-[13px]">
                {mockTenant.createdAt.toISOString().slice(0, 10)}
              </div>
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
            <Button size="sm">Save changes</Button>
          </div>
        </Panel>

        <Panel
          title="Members"
          description={`${mockMembers.length} active. Owners can invite, manage roles, and remove.`}
          action={<Button size="sm">Invite member</Button>}
        >
          <ul className="divide-hairline -mx-2 divide-y">
            {mockMembers.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-2 py-3">
                <span className="bg-accent/15 font-technical text-accent grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold">
                  {m.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-ink text-[13.5px] font-medium">{m.name}</div>
                  <div className="text-ink-faded text-[12px]">{m.email}</div>
                </div>
                <Pill tone={m.status === 'invited' ? 'warn' : 'default'}>{m.role}</Pill>
                <span className="text-ink-mute hidden w-28 text-right text-[12px] md:block">
                  {m.lastActive}
                </span>
                <button
                  type="button"
                  className="text-ink-faded hover:bg-paper-soft hover:text-ink rounded-md p-1.5 transition-colors"
                  aria-label="Member options"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="3" cy="7" r="1.2" fill="currentColor" />
                    <circle cx="7" cy="7" r="1.2" fill="currentColor" />
                    <circle cx="11" cy="7" r="1.2" fill="currentColor" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="API keys"
          description="Server-side only. Rotate freely; revoking is instant."
          action={<Button size="sm">Create key</Button>}
        >
          <ul className="divide-hairline -mx-2 divide-y">
            {mockApiKeys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-2 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-ink text-[13.5px] font-medium">{k.name}</div>
                  <div className="font-technical text-ink-faded mt-1 text-[11.5px]">
                    {k.keyPrefix}
                    <span className="text-ink-mute mx-1.5">·</span>
                    created {k.createdAt}
                    <span className="text-ink-mute mx-1.5">·</span>
                    last used {k.lastUsedAt}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {k.scopes.map((s) => (
                    <span
                      key={s}
                      className="border-hairline bg-paper-soft font-technical text-ink-soft rounded-md border px-1.5 py-0.5 text-[10.5px]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <span className="num font-technical text-ink-faded w-20 text-right text-[12px]">
                  {k.requestsToday.toLocaleString()} req/d
                </span>
                <Button variant="ghost" size="sm">
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Danger zone"
          description="Irreversible. Affects every member and integration."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <DangerRow
              title="Transfer ownership"
              body="Move workspace ownership to another member."
              cta="Transfer"
            />
            <DangerRow
              title="Delete workspace"
              body="All data, embeddings, and graphs are purged within 30 days."
              cta="Delete"
              destructive
            />
          </div>
        </Panel>
      </Reveal>
    </>
  );
}

function Tab({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={
        active
          ? 'border-ink text-ink relative -mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium'
          : 'text-ink-faded hover:text-ink border-b-2 border-transparent px-4 py-2.5 text-[13px] font-medium transition-colors'
      }
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-ink text-[12.5px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-ink-mute mt-1.5 block text-[11.5px]">{hint}</span>}
    </label>
  );
}

function DangerRow({
  title,
  body,
  cta,
  destructive,
}: {
  title: string;
  body: string;
  cta: string;
  destructive?: boolean;
}) {
  return (
    <div
      className={
        destructive
          ? 'rounded-xl border border-red-500/30 bg-red-500/5 p-4'
          : 'border-hairline bg-paper-soft rounded-xl border p-4'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-ink text-[13.5px] font-medium">{title}</div>
          <div className="text-ink-faded mt-0.5 text-[12.5px]">{body}</div>
        </div>
        <Button variant={destructive ? 'destructive' : 'outline'} size="sm">
          {cta}
        </Button>
      </div>
    </div>
  );
}
