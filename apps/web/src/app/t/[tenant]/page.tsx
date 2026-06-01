import Link from 'next/link';
import { PageHeader, Panel, Pill, SparkLine, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import {
  mockTenant,
  mockMembers,
  mockTenantStats,
  mockSpark,
  mockAlerts,
  mockDocuments,
} from '@/lib/mock-data';

export default async function TenantOverview({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;

  const recentDocs = mockDocuments.slice(0, 4);
  const openAlerts = mockAlerts.filter((a) => a.status === 'OPEN').slice(0, 3);

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        eyebrow="Workspace overview"
        title={
          <>
            Welcome back, <span className="serif-italic text-ink-faded font-normal">Tess.</span>
          </>
        }
        description={<>Three new alerts since you last looked. Two regulators have moved.</>}
        actions={
          <>
            <Link
              href={`/t/${slug}/documents`}
              className="border-hairline-strong bg-paper text-ink hover:bg-paper-soft inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M6.5 2.5v8M2.5 6.5h8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Upload
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

      {/* KPI strip */}
      <div className="reveal-stagger mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Documents"
          value={mockTenantStats.documents.toLocaleString()}
          delta="+24 · 7d"
          trend="up"
        />
        <StatCard
          label="Pages indexed"
          value={mockTenantStats.pages.toLocaleString()}
          delta="+1.2k · 7d"
          trend="up"
        />
        <StatCard
          label="Queries · 30d"
          value={mockTenantStats.queries30d.toLocaleString()}
          delta="+18.4%"
          trend="up"
        />
        <StatCard label="Avg latency" value="214ms" delta="−6ms" trend="down" />
      </div>

      <Reveal as="div" className="grid gap-6 lg:grid-cols-12">
        {/* Capacity */}
        <Panel
          title="Cycle usage"
          description={`Plan · ${mockTenant.plan} · resets in 11 days`}
          action={<Pill tone="accent">{mockTenant.plan}</Pill>}
          className="lg:col-span-7"
        >
          <div className="space-y-5">
            <UsageRow
              label="RAG queries"
              used={mockTenantStats.queries30d}
              limit={67000}
              suffix=""
            />
            <UsageRow
              label="Storage"
              used={mockTenantStats.storageGb}
              limit={mockTenantStats.storageLimitGb}
              suffix="GB"
            />
            <UsageRow
              label="Spend"
              used={mockTenantStats.monthSpend}
              limit={mockTenantStats.monthLimit}
              suffix=""
              prefix="$"
            />
          </div>

          <div className="border-hairline mt-6 grid grid-cols-2 gap-x-8 gap-y-3 border-t pt-5 text-[13px]">
            <Row left="Queries today" right={mockTenantStats.queriesToday.toLocaleString()} />
            <Row left="Members" right={String(mockMembers.length)} />
            <Row left="Webhooks today" right="412" />
            <Row left="P95 latency" right="318ms" />
          </div>
        </Panel>

        {/* Alerts */}
        <Panel
          title="Open alerts"
          description={`${openAlerts.length} need attention`}
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
          <ul className="space-y-4">
            {openAlerts.map((alert) => (
              <li key={alert.id} className="group">
                <div className="flex items-center gap-3">
                  <Pill
                    tone={
                      alert.severity === 'HIGH'
                        ? 'danger'
                        : alert.severity === 'MEDIUM'
                          ? 'warn'
                          : 'default'
                    }
                  >
                    {alert.severity.toLowerCase()}
                  </Pill>
                  <span className="text-ink-faded text-[11px] font-medium">{alert.at}</span>
                </div>
                <h3 className="text-ink mt-2 text-[14px] font-medium leading-snug">
                  {alert.title}
                </h3>
                <div className="text-ink-faded mt-1 text-[12px]">{alert.source}</div>
              </li>
            ))}
          </ul>
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
          <ul className="divide-hairline -mx-2 divide-y">
            {recentDocs.map((doc) => (
              <li key={doc.id} className="group flex items-center gap-4 px-2 py-3">
                <span className="bg-paper-soft text-ink-faded grid h-8 w-8 shrink-0 place-items-center rounded-lg">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M4 2h5l3 3v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9 2v3h3"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-ink truncate text-[14px] font-medium">{doc.title}</div>
                  <div className="text-ink-faded mt-0.5 flex items-center gap-2 text-[12px]">
                    <span>{doc.type}</span>
                    <span>·</span>
                    <span>{doc.pages} pp</span>
                    <span>·</span>
                    <span>{doc.uploader}</span>
                  </div>
                </div>
                <Pill
                  tone={
                    doc.status === 'INDEXED'
                      ? 'success'
                      : doc.status === 'PROCESSING'
                        ? 'warn'
                        : 'danger'
                  }
                >
                  {doc.status.toLowerCase()}
                </Pill>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Members */}
        <Panel
          title="Members"
          action={
            <Link
              href={`/t/${slug}/settings/members`}
              className="text-accent text-[12px] font-medium underline-offset-4 hover:underline"
            >
              Manage
            </Link>
          }
          className="lg:col-span-5"
        >
          <ul className="divide-hairline -mx-2 divide-y">
            {mockMembers.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-2 py-3">
                <span
                  className={
                    m.status === 'invited'
                      ? 'bg-paper-soft text-ink-faded ring-hairline grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-1'
                      : 'bg-accent/10 text-accent grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold'
                  }
                >
                  {m.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-ink truncate text-[13.5px] font-medium">{m.name}</div>
                  <div className="text-ink-faded truncate text-[11.5px]">{m.email}</div>
                </div>
                <Pill tone={m.role === 'OWNER' ? 'accent' : 'default'}>{m.role}</Pill>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Activity sparkline */}
        <Panel title="Query volume · 14d" className="lg:col-span-12">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="num text-ink text-4xl font-semibold tracking-tight">
                {mockTenantStats.queries30d.toLocaleString()}
              </div>
              <div className="text-ink-faded mt-1 text-[13px]">Queries this cycle</div>
            </div>
            <SparkLine
              data={mockSpark.ragQueries}
              width={520}
              height={64}
              className="max-w-[520px] flex-1"
            />
          </div>
        </Panel>
      </Reveal>
    </div>
  );
}

function UsageRow({
  label,
  used,
  limit,
  suffix,
  prefix = '',
}: {
  label: string;
  used: number;
  limit: number;
  suffix: string;
  prefix?: string;
}) {
  const pct = Math.min(used / limit, 1);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-ink font-medium">{label}</span>
        <span className="font-technical text-ink-faded text-[12px]">
          <span className="num text-ink">
            {prefix}
            {used.toLocaleString()}
          </span>
          {suffix}
          <span className="text-ink-mute"> / </span>
          <span className="num">
            {prefix}
            {limit.toLocaleString()}
          </span>
          {suffix}
        </span>
      </div>
      <div className="bg-paper-soft mt-2 h-1.5 overflow-hidden rounded-full">
        <div
          className={
            pct > 0.85 ? 'h-full rounded-full bg-amber-500' : 'bg-accent h-full rounded-full'
          }
          style={{ width: `${pct * 100}%` }}
        />
      </div>
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
