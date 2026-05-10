import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockPlatform, mockPlatformTenants } from '@/lib/mock-data';

export const metadata = { title: 'Tenants · Admin · Horus' };

export default function TenantsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Platform · Tenants"
        title="Every workspace, in one place."
        description="Search, filter, and drill into any tenant. Spend, plan, member count, and health roll up here."
        actions={
          <>
            <Button variant="outline" size="sm">
              Export CSV
            </Button>
            <Button size="sm">New tenant</Button>
          </>
        }
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Total" value={String(mockPlatform.tenants)} />
        <StatCard label="Active" value={String(mockPlatform.activeTenants)} delta="+4" trend="up" />
        <StatCard label="Past due" value="2" delta="needs review" trend="down" />
        <StatCard label="Trials" value="12" delta="3 expiring" trend="flat" />
      </div>

      <div className="reveal-stagger mt-8 flex flex-wrap items-center gap-2 text-[12px]">
        <FilterChip active>All</FilterChip>
        <FilterChip>Active</FilterChip>
        <FilterChip>Past due</FilterChip>
        <FilterChip>Trial</FilterChip>
        <FilterChip>Cancelled</FilterChip>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            placeholder="Search tenant name, slug, owner…"
            className="border-hairline bg-paper text-ink placeholder:text-ink-mute focus:border-accent h-8 w-64 rounded-full border px-3.5 text-[12.5px] focus:outline-none"
          />
        </div>
      </div>

      <Reveal as="div">
        <Panel className="mt-4">
          <div className="-mx-6 -my-6 overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[13px]">
              <thead>
                <tr className="border-hairline text-ink-mute border-b text-[10px] font-semibold uppercase tracking-[0.16em]">
                  <th className="px-6 py-3">Tenant</th>
                  <th className="px-3 py-3">Plan</th>
                  <th className="px-3 py-3 text-right">Members</th>
                  <th className="px-3 py-3 text-right">Documents</th>
                  <th className="px-3 py-3 text-right">MRR</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Created</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {mockPlatformTenants.map((t) => (
                  <tr
                    key={t.id}
                    className="border-hairline/60 hover:bg-paper-soft border-b transition-colors last:border-b-0"
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="bg-paper-soft font-technical text-ink-soft ring-hairline grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-semibold ring-1">
                          {t.name
                            .split(' ')
                            .map((p) => p[0])
                            .slice(0, 2)
                            .join('')}
                        </span>
                        <div>
                          <div className="text-ink font-medium">{t.name}</div>
                          <div className="font-technical text-ink-mute text-[11px]">/{t.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Pill tone={planTone(t.plan)}>{t.plan}</Pill>
                    </td>
                    <td className="num text-ink-soft px-3 py-3.5 text-right tabular-nums">
                      {t.members}
                    </td>
                    <td className="num text-ink-soft px-3 py-3.5 text-right tabular-nums">
                      {t.docs.toLocaleString()}
                    </td>
                    <td className="num text-ink px-3 py-3.5 text-right tabular-nums">
                      ${t.spend.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-3.5">
                      <Pill tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Pill>
                    </td>
                    <td className="font-technical text-ink-faded px-3 py-3.5 text-[12px]">
                      {t.createdAt}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <button
                        type="button"
                        className="text-ink-faded hover:text-ink transition-colors"
                        aria-label="Open"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path
                            d="M5 3l4 4-4 4"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Reveal>

      <div className="text-ink-faded mt-6 flex items-center justify-between text-[12px]">
        <span>Showing 7 of {mockPlatform.tenants}</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled>
            Previous
          </Button>
          <Button variant="outline" size="sm">
            Next
          </Button>
        </div>
      </div>
    </>
  );
}

function FilterChip({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={
        active
          ? 'bg-ink text-paper rounded-full px-3 py-1 text-[12px] font-medium'
          : 'border-hairline bg-paper text-ink-faded hover:border-hairline-strong hover:text-ink rounded-full border px-3 py-1 text-[12px] transition-colors'
      }
    >
      {children}
    </button>
  );
}

function planTone(plan: string): 'default' | 'accent' | 'success' {
  if (plan === 'SCALE') return 'accent';
  if (plan === 'PRO') return 'success';
  return 'default';
}

function statusTone(s: string): 'success' | 'warn' | 'accent' | 'default' {
  if (s === 'active') return 'success';
  if (s === 'past_due') return 'warn';
  if (s === 'trial') return 'accent';
  return 'default';
}
