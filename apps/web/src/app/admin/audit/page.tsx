import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockAudit } from '@/lib/mock-data';

export const metadata = { title: 'Audit log · Admin · Horus' };

export default function AuditPage() {
  return (
    <>
      <PageHeader
        eyebrow="Platform · Audit log"
        title="Append-only. Cryptographically chained."
        description="Every privileged action across every tenant. Exportable to your SIEM. Retained 7 years."
        actions={
          <>
            <Button variant="outline" size="sm">
              Stream to SIEM
            </Button>
            <Button size="sm">Download .ndjson</Button>
          </>
        }
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Events · 24h" value="3,418" delta="+182" trend="up" />
        <StatCard label="Privileged actions" value="42" />
        <StatCard label="Failed integrations" value="2" delta="needs review" trend="down" />
        <StatCard label="Chain integrity" value="OK" delta="last: 14:02 UTC" />
      </div>

      <div className="reveal-stagger mt-8 flex flex-wrap items-center gap-2 text-[12px]">
        <FilterChip active>All actions</FilterChip>
        <FilterChip>Auth</FilterChip>
        <FilterChip>API keys</FilterChip>
        <FilterChip>Documents</FilterChip>
        <FilterChip>Members</FilterChip>
        <FilterChip>Billing</FilterChip>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            placeholder="Filter by actor, action, target…"
            className="border-hairline bg-paper text-ink placeholder:text-ink-mute focus:border-accent h-8 w-72 rounded-full border px-3.5 text-[12.5px] focus:outline-none"
          />
        </div>
      </div>

      <Reveal as="div">
        <Panel className="mt-4">
          <div className="-mx-6 -my-6 overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[13px]">
              <thead>
                <tr className="border-hairline text-ink-mute border-b text-[10px] font-semibold uppercase tracking-[0.16em]">
                  <th className="px-6 py-3">Time</th>
                  <th className="px-3 py-3">Actor</th>
                  <th className="px-3 py-3">Action</th>
                  <th className="px-3 py-3">Target</th>
                  <th className="px-3 py-3">Tenant</th>
                  <th className="px-3 py-3">IP</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {mockAudit.map((e, i) => (
                  <tr
                    key={i}
                    className="border-hairline/60 hover:bg-paper-soft border-b transition-colors last:border-b-0"
                  >
                    <td className="font-technical text-ink-faded px-6 py-3 text-[12px]">{e.at}</td>
                    <td className="px-3 py-3">
                      {e.actor === 'system' ? (
                        <Pill tone="default">system</Pill>
                      ) : (
                        <span className="text-ink">{e.actor}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-technical text-ink-soft text-[12px]">{e.action}</span>
                    </td>
                    <td className="text-ink px-3 py-3">{e.target}</td>
                    <td className="px-3 py-3">
                      <Pill tone={e.tenant === 'platform' ? 'accent' : 'default'}>{e.tenant}</Pill>
                    </td>
                    <td className="font-technical text-ink-faded px-3 py-3 text-[11.5px]">
                      {e.ip}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        className="text-ink-faded hover:text-ink transition-colors"
                        aria-label="Inspect"
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

      <p className="text-ink-mute mt-6 text-[11.5px]">
        Each row is hash-chained to the previous. Tampering is detectable; deletion is not possible.
      </p>
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
