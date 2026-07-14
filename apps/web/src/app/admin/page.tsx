import Link from 'next/link';
import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';

export const dynamic = 'force-dynamic';

export default async function AdminOverview() {
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [tenants, activeTenants, documents, sessions30d, members, recent] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { isActive: true } }),
    prisma.document.count(),
    prisma.chatSession.count({ where: { createdAt: { gte: since30d } } }),
    prisma.tenantMember.count(),
    prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { _count: { select: { members: true, documents: true, chatSessions: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        eyebrow="Platform"
        title="Admin console."
        description="Live platform-wide numbers — straight from the database."
      />

      <div className="reveal-stagger mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Tenants" value={String(tenants)} />
        <StatCard label="Active" value={String(activeTenants)} />
        <StatCard label="Documents" value={documents.toLocaleString()} />
        <StatCard label="Chat sessions · 30d" value={sessions30d.toLocaleString()} />
      </div>

      <Reveal as="div">
        <Panel
          title="Tenants"
          description={`${members} memberships across the platform`}
          action={
            <Link
              href="/admin/tenants"
              className="text-accent text-[12px] font-medium underline-offset-4 hover:underline"
            >
              View all
            </Link>
          }
        >
          <ul className="divide-hairline -my-2 divide-y">
            {recent.map((t) => (
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
                    {!t.isActive && <Pill tone="danger">inactive</Pill>}
                  </div>
                  <div className="font-technical text-ink-mute mt-0.5 text-[11.5px]">
                    /{t.slug} · created {t.createdAt.toLocaleDateString()}
                  </div>
                </div>
                <span className="num text-ink-faded text-[12px]">
                  {t._count.members} members · {t._count.documents} docs · {t._count.chatSessions}{' '}
                  chats
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </Reveal>
    </div>
  );
}
