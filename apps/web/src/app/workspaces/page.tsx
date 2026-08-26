import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@horus/db';
import { getCurrentUser } from '@/lib/supabase/server';
import { PageHeader, Panel, Pill } from '@/components/app/shell';
import { Reveal } from '@/components/motion';

export const metadata = { title: 'Workspaces · Horus' };
export const dynamic = 'force-dynamic';

const ROLE_HINT: Record<string, string> = {
  OWNER: 'You own this workspace',
  ADMIN: 'You administer this workspace',
  MEMBER: 'You work in this workspace',
  VIEWER: 'You can view this workspace',
};

export default async function WorkspacesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/workspaces');

  const memberships = await prisma.tenantMember.findMany({
    where: { userId: user.id, tenant: { isActive: true } },
    include: {
      tenant: {
        select: {
          slug: true,
          name: true,
          plan: true,
          createdAt: true,
          _count: { select: { members: true, documents: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  if (memberships.length === 0) redirect('/onboarding');
  if (memberships.length === 1) redirect(`/t/${memberships[0]!.tenant.slug}`);

  return (
    <div className="bg-canvas min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <PageHeader
          eyebrow="Your workspaces"
          title="Where do you want to work?"
          description="Each workspace is a fully isolated tenant — its own knowledge, agents, customers, and usage."
        />

        <Reveal as="div">
          <Panel>
            <ul className="divide-hairline -my-2 divide-y">
              {memberships.map((m) => (
                <li key={m.tenant.slug}>
                  <Link
                    href={`/t/${m.tenant.slug}`}
                    className="hover:bg-paper-soft group flex items-center gap-4 px-2 py-4 transition-colors"
                  >
                    <span className="bg-accent/10 text-accent grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[13px] font-semibold">
                      {m.tenant.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ink text-[14.5px] font-semibold">
                          {m.tenant.name}
                        </span>
                        <Pill tone="accent">{m.tenant.plan}</Pill>
                        <Pill>{m.role.toLowerCase()}</Pill>
                      </div>
                      <div className="text-ink-faded mt-0.5 text-[12.5px]">
                        {ROLE_HINT[m.role] ?? ''} · {m.tenant._count.members}{' '}
                        {m.tenant._count.members === 1 ? 'member' : 'members'} ·{' '}
                        {m.tenant._count.documents}{' '}
                        {m.tenant._count.documents === 1 ? 'document' : 'documents'}
                      </div>
                    </div>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      className="text-ink-mute group-hover:text-accent shrink-0 transition-colors"
                    >
                      <path
                        d="M5 3l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </Reveal>

        <p className="text-ink-faded mt-6 text-center text-[12.5px]">
          Need a new workspace?{' '}
          <Link href="/onboarding" className="text-accent hover:underline">
            Create one
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
