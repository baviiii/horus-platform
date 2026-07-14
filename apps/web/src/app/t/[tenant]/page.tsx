import Link from 'next/link';
import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export default async function TenantOverview({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant, user } = await requireTenantMember(slug);

  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [
    documents,
    chunks,
    sessions30d,
    openAlerts,
    members,
    connections,
    recentDocs,
    recentSessions,
  ] = await Promise.all([
    prisma.document.count({ where: { tenantId: tenant.id } }),
    prisma.chunk.count({ where: { tenantId: tenant.id } }),
    prisma.chatSession.count({ where: { tenantId: tenant.id, createdAt: { gte: since30d } } }),
    prisma.alert.findMany({
      where: { tenantId: tenant.id, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    prisma.tenantMember.findMany({ where: { tenantId: tenant.id }, orderBy: { joinedAt: 'asc' } }),
    prisma.connection.count({ where: { tenantId: tenant.id } }),
    prisma.document.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: 4,
    }),
    prisma.chatSession.findMany({
      where: { tenantId: tenant.id },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: { _count: { select: { messages: true } } },
    }),
  ]);

  const firstName = user.displayName.split(' ')[0] ?? user.displayName;

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        eyebrow="Workspace overview"
        title={
          <>
            Welcome back,{' '}
            <span className="serif-italic text-ink-faded font-normal">{firstName}.</span>
          </>
        }
        description={
          openAlerts.length > 0
            ? `${openAlerts.length} open alert${openAlerts.length === 1 ? '' : 's'} need attention.`
            : 'Live workspace data — everything below reads straight from your database.'
        }
        actions={
          <>
            <Link
              href={`/t/${slug}/documents`}
              className="border-hairline-strong bg-paper text-ink hover:bg-paper-soft inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors"
            >
              Documents
            </Link>
            <Link
              href={`/t/${slug}/chat`}
              className="bg-ink text-paper hover:bg-ink-soft inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors"
            >
              New chat
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 6h6m0 0L6 3m3 3L6 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </>
        }
      />

      {/* KPI strip — live counts */}
      <div className="reveal-stagger mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Documents" value={documents.toLocaleString()} />
        <StatCard label="Knowledge chunks" value={chunks.toLocaleString()} />
        <StatCard label="Chat sessions · 30d" value={sessions30d.toLocaleString()} />
        <StatCard label="Open alerts" value={String(openAlerts.length)} />
      </div>

      <Reveal as="div" className="grid gap-6 lg:grid-cols-12">
        {/* Workspace facts */}
        <Panel
          title="Workspace"
          description={`Created ${tenant.createdAt.toLocaleDateString()}`}
          action={<Pill tone="accent">{tenant.plan}</Pill>}
          className="lg:col-span-7"
        >
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px]">
            <Row left="Slug" right={tenant.slug} />
            <Row left="Members" right={String(members.length)} />
            <Row left="Connections" right={String(connections)} />
            <Row left="Status" right={tenant.isActive ? 'active' : 'inactive'} />
          </div>
        </Panel>

        {/* Alerts */}
        <Panel
          title="Open alerts"
          description={openAlerts.length > 0 ? `${openAlerts.length} need attention` : 'All clear'}
          action={
            <Link
              href={`/t/${slug}/alerts`}
              className="text-accent text-[12px] font-medium underline-offset-4 hover:underline"
            >
              View all
            </Link>
          }
          className="lg:col-span-5"
        >
          {openAlerts.length === 0 ? (
            <p className="text-ink-faded py-2 text-[13.5px]">
              Nothing open. Alerts appear here when Horus flags something in your knowledge or
              feeds.
            </p>
          ) : (
            <ul className="space-y-4">
              {openAlerts.map((alert) => (
                <li key={alert.id}>
                  <div className="flex items-center gap-3">
                    <Pill
                      tone={
                        alert.severity === 'HIGH' || alert.severity === 'CRITICAL'
                          ? 'danger'
                          : alert.severity === 'MEDIUM'
                            ? 'warn'
                            : 'default'
                      }
                    >
                      {alert.severity.toLowerCase()}
                    </Pill>
                    <span className="text-ink-faded text-[11px] font-medium">
                      {alert.createdAt.toLocaleString()}
                    </span>
                  </div>
                  <h3 className="text-ink mt-2 text-[14px] font-medium leading-snug">
                    {alert.title}
                  </h3>
                  <div className="text-ink-faded mt-1 text-[12px]">{alert.kind}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Recent documents */}
        <Panel
          title="Recent documents"
          action={
            <Link
              href={`/t/${slug}/documents`}
              className="text-accent text-[12px] font-medium underline-offset-4 hover:underline"
            >
              All documents
            </Link>
          }
          className="lg:col-span-7"
        >
          {recentDocs.length === 0 ? (
            <p className="text-ink-faded py-2 text-[13.5px]">
              No documents yet — workspace ingestion is the next milestone. The playground pipeline
              (crawl → chunk → embed → index) is the engine that will power it.
            </p>
          ) : (
            <ul className="divide-hairline -mx-2 divide-y">
              {recentDocs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-4 px-2 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-ink truncate text-[14px] font-medium">{doc.title}</div>
                    <div className="text-ink-faded mt-0.5 flex items-center gap-2 text-[12px]">
                      <span>{doc.category ?? 'document'}</span>
                      <span>·</span>
                      <span>{doc.chunksCount} chunks</span>
                    </div>
                  </div>
                  <Pill
                    tone={
                      doc.status === 'INDEXED'
                        ? 'success'
                        : doc.status === 'FAILED'
                          ? 'danger'
                          : 'warn'
                    }
                  >
                    {doc.status.toLowerCase()}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Members */}
        <Panel title="Members" className="lg:col-span-5">
          <ul className="divide-hairline -mx-2 divide-y">
            {members.map((m) => {
              const isYou = m.userId === user.id;
              return (
                <li key={m.id} className="flex items-center gap-3 px-2 py-3">
                  <span className="bg-accent/10 text-accent grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
                    {isYou ? user.initials : m.userId.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-ink truncate text-[13.5px] font-medium">
                      {isYou ? `${user.displayName} (you)` : `Member ${m.userId.slice(0, 8)}`}
                    </div>
                    <div className="text-ink-faded truncate text-[11.5px]">
                      {isYou ? user.email : `joined ${m.joinedAt.toLocaleDateString()}`}
                    </div>
                  </div>
                  <Pill tone={m.role === 'OWNER' ? 'accent' : 'default'}>{m.role}</Pill>
                </li>
              );
            })}
          </ul>
        </Panel>

        {/* Recent chat sessions */}
        <Panel
          title="Recent chat sessions"
          action={
            <Link
              href={`/t/${slug}/chat`}
              className="text-accent text-[12px] font-medium underline-offset-4 hover:underline"
            >
              Open chat
            </Link>
          }
          className="lg:col-span-12"
        >
          {recentSessions.length === 0 ? (
            <p className="text-ink-faded py-2 text-[13.5px]">
              No conversations yet. Start one — the agent is live, grounded, and connected to your
              workspace tools.
            </p>
          ) : (
            <ul className="divide-hairline -mx-2 divide-y">
              {recentSessions.map((s) => (
                <li key={s.id} className="flex items-center gap-4 px-2 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-ink truncate text-[14px] font-medium">
                      {s.title ?? 'Untitled conversation'}
                    </div>
                    <div className="text-ink-faded mt-0.5 text-[12px]">
                      {s.updatedAt.toLocaleString()}
                    </div>
                  </div>
                  <span className="num text-ink-faded text-[12px]">{s._count.messages} msgs</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Reveal>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="border-hairline flex items-center justify-between border-b pb-2">
      <span className="text-ink-faded">{left}</span>
      <span className="num text-ink font-medium">{right}</span>
    </div>
  );
}
