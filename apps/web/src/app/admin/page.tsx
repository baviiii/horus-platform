import Link from 'next/link';
import { PageHeader, Panel, Pill, SparkLine, StatCard } from '@/components/app/shell';
import { mockPlatform, mockSpark, mockPlatformTenants } from '@/lib/mock-data';

export default function AdminOverview() {
  const recent = mockPlatformTenants.slice(0, 6);

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        eyebrow="Platform admin"
        title={
          <>
            Everything,{' '}
            <span className="serif-italic text-ink-faded font-normal">at a glance.</span>
          </>
        }
        description="Active tenants, revenue, queries served, and platform health."
        actions={
          <>
            <Link
              href="/admin/usage"
              className="border-hairline-strong bg-paper text-ink hover:bg-paper-soft inline-flex h-9 items-center rounded-full border px-4 text-[13px] font-medium transition-colors"
            >
              Export usage
            </Link>
            <Link
              href="/admin/tenants"
              className="bg-ink text-paper hover:bg-ink-soft inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors"
            >
              All tenants
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

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Active tenants"
          value={`${mockPlatform.activeTenants}/${mockPlatform.tenants}`}
          delta={`+${Math.round(mockPlatform.growth7d * 100)}% · 7d`}
          trend="up"
        />
        <StatCard
          label="MRR"
          value={`$${(mockPlatform.mrrUsd / 1000).toFixed(1)}k`}
          delta={`ARR $${(mockPlatform.arrUsd / 1_000_000).toFixed(2)}M`}
          trend="up"
        />
        <StatCard
          label="Queries · 30d"
          value={`${(mockPlatform.ragQueries30d / 1_000_000).toFixed(2)}M`}
          delta="+18.4%"
          trend="up"
        />
        <StatCard
          label="Documents"
          value={`${(mockPlatform.documentsAcrossPlatform / 1_000_000).toFixed(2)}M`}
          delta="+124k · 7d"
          trend="up"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Health */}
        <Panel
          title="Platform health"
          description="Live · last 30 days"
          action={<Pill tone="success">99.96% uptime</Pill>}
          className="lg:col-span-7"
        >
          <div className="grid grid-cols-3 gap-6">
            <Metric label="P50 latency" value="14ms" sub="−2ms vs last week" />
            <Metric label="Reranker quality" value="98.4" sub="MRR@5" />
            <Metric label="Tenant churn" value="0.012%" sub="30d" />
          </div>

          <div className="border-hairline mt-6 grid grid-cols-2 gap-x-8 gap-y-3 border-t pt-5 text-[13px]">
            <Row left="Ingest workers" right="14 · all green" />
            <Row left="Entity extraction" right="6 · all green" />
            <Row left="Alert workers" right="4 · all green" />
            <Row left="PDF renderer" right="8 · all green" />
            <Row left="Webhook queue depth" right="12" />
            <Row left="Search indices" right="146" />
          </div>
        </Panel>

        {/* Queries trend */}
        <Panel title="Queries · 14d" className="lg:col-span-5">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="num text-ink text-3xl font-semibold tracking-tight">
              {(mockPlatform.ragQueries30d / 1_000_000).toFixed(2)}M
            </div>
            <span className="font-technical text-[11px] font-medium text-emerald-500">+18.4%</span>
          </div>
          <SparkLine data={mockSpark.ragQueries} width={400} height={80} className="w-full" />
        </Panel>

        {/* Tenants table */}
        <Panel
          title="Recent tenants"
          action={
            <Link
              href="/admin/tenants"
              className="text-accent text-[12px] font-medium underline-offset-4 hover:underline"
            >
              All tenants
            </Link>
          }
          className="lg:col-span-12"
        >
          <div className="-mx-6 -mb-6 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-hairline text-ink-faded border-b text-left text-[11px] font-medium uppercase tracking-wider">
                  <th className="px-6 py-3 font-medium">Tenant</th>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 text-right font-medium">Documents</th>
                  <th className="px-6 py-3 text-right font-medium">Spend</th>
                  <th className="px-6 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr
                    key={t.id}
                    className="border-hairline hover:bg-paper-soft border-b transition-colors last:border-0"
                  >
                    <td className="px-6 py-4">
                      <div className="text-ink font-medium">{t.name}</div>
                      <div className="text-ink-faded text-[12px]">{t.slug}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Pill tone={t.plan === 'SCALE' ? 'accent' : 'default'}>{t.plan}</Pill>
                    </td>
                    <td className="num text-ink px-6 py-4 text-right">{t.docs.toLocaleString()}</td>
                    <td className="num text-ink px-6 py-4 text-right">
                      ${t.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Pill tone="success">active</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-ink-faded text-[12px] font-medium">{label}</div>
      <div className="num text-ink mt-1.5 text-3xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-ink-faded mt-0.5 text-[11.5px]">{sub}</div>}
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
