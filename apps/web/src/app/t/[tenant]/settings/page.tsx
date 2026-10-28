import { headers } from 'next/headers';
import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { managedKeyCreators, membersWithIdentity } from '@/lib/members';
import { isPlatformAdmin, requireTenantMember } from '@/lib/tenant-context';
import { cancelInviteAction, removeMemberAction, revokeApiKeyAction } from './actions';
import { ApiKeyForm } from './api-key-form';
import { InviteForm } from './invite-form';

export const metadata = { title: 'Settings · Horus' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant, user } = await requireTenantMember(slug);

  const [members, invites, apiKeys] = await Promise.all([
    membersWithIdentity(tenant.id),
    prisma.tenantInvite.findMany({
      where: { tenantId: tenant.id, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.apiKey.findMany({
      where: { tenantId: tenant.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const managedCreators = await managedKeyCreators([...new Set(apiKeys.map((k) => k.createdById))]);

  const revoke = revokeApiKeyAction.bind(null, slug);
  const cancelInvite = cancelInviteAction.bind(null, slug);
  const removeMember = removeMemberAction.bind(null, slug);
  const canManage = user.role === 'OWNER' || user.role === 'ADMIN';
  const isOperator = isPlatformAdmin(user.email);
  const ownerCount = members.filter((m) => m.role === 'OWNER').length;
  const now = new Date();

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const signupUrl = `${proto}://${host}/signup?invited=1`;

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings."
        description="Identity, members, and API keys — live from your tenant record."
      />

      <Reveal as="div" className="grid gap-6 lg:grid-cols-12">
        <Panel title="General" className="lg:col-span-5">
          <div className="space-y-3 text-[13.5px]">
            <Row left="Name" right={tenant.name} />
            <Row left="Slug" right={tenant.slug} />
            <Row left="Plan" right={tenant.plan} />
            <Row left="Created" right={tenant.createdAt.toLocaleDateString()} />
            <Row left="Status" right={tenant.isActive ? 'active' : 'inactive'} />
            <Row left="Your role" right={user.role} />
          </div>
        </Panel>

        <Panel
          title="Members"
          description={`${members.length} member${members.length === 1 ? '' : 's'}`}
          className="lg:col-span-7"
        >
          {canManage && (
            <div className="mb-4">
              <InviteForm
                slug={slug}
                canInviteOwner={user.role === 'OWNER'}
                signupUrl={signupUrl}
                workspaceName={tenant.name}
              />
            </div>
          )}

          <ul className="divide-hairline -my-2 divide-y">
            {members.map((m) => {
              const isYou = m.userId === user.id;
              const label = isYou
                ? `${user.displayName} (you)`
                : (m.email ?? `Member ${m.userId.slice(0, 8)}`);
              const canRemove =
                canManage &&
                !isYou &&
                !m.isHorusTeam &&
                (m.role !== 'OWNER' || (user.role === 'OWNER' && ownerCount > 1));
              return (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <span className="bg-accent/10 text-accent grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
                    {isYou ? user.initials : (m.email ?? m.userId).slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-ink truncate text-[13.5px] font-medium">{label}</div>
                    <div className="text-ink-faded text-[11.5px]">
                      {isYou ? `${user.email} · ` : ''}joined {m.joinedAt.toLocaleDateString()}
                    </div>
                  </div>
                  {m.isHorusTeam && <Pill>Horus team</Pill>}
                  <Pill tone={m.role === 'OWNER' ? 'accent' : 'default'}>{m.role}</Pill>
                  {canRemove && (
                    <form action={removeMember}>
                      <input type="hidden" name="id" value={m.id} />
                      <Button variant="outline" size="sm" type="submit">
                        Remove
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>

          {invites.length > 0 && (
            <div className="mt-5">
              <div className="text-ink-faded mb-1 text-[11.5px] font-medium uppercase tracking-wide">
                Pending invites
              </div>
              <ul className="divide-hairline divide-y">
                {invites.map((inv) => {
                  const expired = inv.expiresAt < now;
                  return (
                    <li key={inv.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-ink truncate text-[13.5px] font-medium">
                          {inv.email}
                        </div>
                        <div className="text-ink-faded text-[11.5px]">
                          {expired
                            ? `expired ${inv.expiresAt.toLocaleDateString()} — invite again to renew`
                            : `waiting for sign-in · expires ${inv.expiresAt.toLocaleDateString()}`}
                        </div>
                      </div>
                      <Pill>{inv.role}</Pill>
                      {canManage && (
                        <form action={cancelInvite}>
                          <input type="hidden" name="id" value={inv.id} />
                          <Button variant="outline" size="sm" type="submit">
                            Cancel
                          </Button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Panel>

        <Panel
          title="API keys"
          description="Scoped keys for the SDK and external integrations. Secrets are hashed — shown once at creation."
          className="lg:col-span-12"
        >
          {canManage && <ApiKeyForm slug={slug} />}

          {apiKeys.length === 0 ? (
            <p className="text-ink-faded mt-4 text-[13.5px]">No active keys.</p>
          ) : (
            <ul className="divide-hairline mt-4 divide-y">
              {apiKeys.map((k) => {
                const managed = managedCreators.has(k.createdById);
                return (
                  <li key={k.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink text-[13.5px] font-medium">{k.name}</span>
                        {managed && <Pill tone="accent">Managed by Horus</Pill>}
                      </div>
                      <div className="font-technical text-ink-mute mt-0.5 text-[11.5px]">
                        {k.keyPrefix}…
                        {k.lastUsedAt
                          ? ` · last used ${k.lastUsedAt.toLocaleString()}`
                          : ' · never used'}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {k.scopes.slice(0, 6).map((s) => (
                          <span
                            key={s}
                            className="border-hairline text-ink-faded font-technical rounded-full border px-2 py-0.5 text-[10px]"
                          >
                            {s}
                          </span>
                        ))}
                        {k.scopes.length > 6 && (
                          <span className="text-ink-mute text-[10px]">+{k.scopes.length - 6}</span>
                        )}
                      </div>
                    </div>
                    {canManage && (!managed || isOperator) && (
                      <form action={revoke}>
                        <input type="hidden" name="id" value={k.id} />
                        <Button variant="outline" size="sm" type="submit">
                          Revoke
                        </Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="border-hairline flex items-center justify-between border-b pb-2">
      <span className="text-ink-faded">{left}</span>
      <span className="text-ink font-medium">{right}</span>
    </div>
  );
}
