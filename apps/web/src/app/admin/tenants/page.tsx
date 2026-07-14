import Link from 'next/link';
import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';

export const metadata = { title: 'Tenants · Admin · Horus' };
export const dynamic = 'force-dynamic';

export default async function TenantsPage() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { members: true, documents: true, chatSessions: true, connections: true } },
    },
  });

  const active = tenants.filter((t) => t.isActive).length;

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Tenants."
        description="Every workspace on the platform, with live counts."
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-3">
        <StatCard label="Total" value={String(tenants.length)} />
        <StatCard label="Active" value={String(active)} />
        <StatCard label="Inactive" value={String(tenants.length - active)} />
      </div>

      <Reveal as="div" className="mt-8">
        <Panel title="All tenants">
          {tenants.length === 0 ? (
            <p className="text-ink-faded py-2 text-[13.5px]">No tenants yet.</p>
          ) : (
            <ul className="divide-hairline -my-2 divide-y">
              {tenants.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/t/${t.slug}`}
                        className="text-ink hover:text-accent truncate text-[14px] font-medium transition-colors"
                      >
                        {t.name}
                      </Link>
                      <Pill tone="accent">{t.plan}</Pill>
                      <Pill tone={t.isActive ? 'success' : 'danger'}>
                        {t.isActive ? 'active' : 'inactive'}
                      </Pill>
                    </div>
                    <div className="font-technical text-ink-mute mt-0.5 text-[11.5px]">
                      /{t.slug} · created {t.createdAt.toLocaleDateString()}
                    </div>
                  </div>
                  <span className="num text-ink-faded text-[12px]">
                    {t._count.members} members · {t._count.documents} docs · {t._count.chatSessions}{' '}
                    chats · {t._count.connections} connections
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Reveal>
    </>
  );
}
