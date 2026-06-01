import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockAlerts } from '@/lib/mock-data';

export const metadata = { title: 'Alerts · Horus' };

export default async function AlertsPage({ params }: { params: Promise<{ tenant: string }> }) {
  await params;

  const open = mockAlerts.filter((a) => a.status === 'OPEN').length;
  const ack = mockAlerts.filter((a) => a.status === 'ACKNOWLEDGED').length;
  const resolved = mockAlerts.filter((a) => a.status === 'RESOLVED').length;

  return (
    <>
      <PageHeader
        eyebrow="Alerts"
        title="Regulatory and source-feed signals."
        description="Anything Horus picks up from your tracked feeds, classifiers, and saved queries lands here. Triage, assign, or close."
        actions={
          <>
            <Button variant="outline" size="sm">
              Configure feeds
            </Button>
            <Button size="sm">New saved query</Button>
          </>
        }
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Open" value={String(open)} delta="+2 this week" trend="up" />
        <StatCard label="Acknowledged" value={String(ack)} />
        <StatCard label="Resolved · 30d" value={String(resolved)} delta="−12%" trend="down" />
        <StatCard label="Mean time to triage" value="42m" delta="−8m" trend="up" />
      </div>

      <div className="reveal-stagger mt-8 flex flex-wrap items-center gap-2 text-[12px]">
        <FilterChip active>All</FilterChip>
        <FilterChip>Open</FilterChip>
        <FilterChip>Acknowledged</FilterChip>
        <FilterChip>Resolved</FilterChip>
        <span className="text-ink-faded ml-auto">{mockAlerts.length} alerts</span>
      </div>

      <Reveal as="div" className="mt-4 space-y-3">
        {mockAlerts.map((a) => (
          <article
            key={a.id}
            className="border-hairline bg-paper hover:border-hairline-strong rounded-2xl border p-5 transition-colors"
          >
            <div className="flex flex-wrap items-start gap-3">
              <SeverityDot severity={a.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={severityTone(a.severity)}>{a.severity}</Pill>
                  <Pill tone={statusTone(a.status)}>{a.status.toLowerCase()}</Pill>
                  <span className="text-ink-mute text-[12px]">{a.at}</span>
                </div>
                <h3 className="text-ink mt-2 text-[15.5px] font-semibold leading-snug tracking-tight">
                  {a.title}
                </h3>
                <div className="text-ink-faded mt-1.5 text-[12.5px]">{a.source}</div>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {a.affects.map((t) => (
                    <li
                      key={t}
                      className="border-hairline bg-paper-soft text-ink-soft rounded-md border px-2 py-1 text-[11.5px]"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm">
                  Acknowledge
                </Button>
                <Button size="sm">Open</Button>
              </div>
            </div>
          </article>
        ))}
      </Reveal>

      <Panel
        className="mt-10"
        title="Watching nothing yet?"
        description="Wire a feed and Horus will surface what matters."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <FeedCard name="EU regulatory feeds" count="12 sources" />
          <FeedCard name="SEC filings" count="3 sources" />
          <FeedCard name="Custom RSS" count="0 sources" muted />
        </div>
      </Panel>
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

function SeverityDot({ severity }: { severity: 'LOW' | 'MEDIUM' | 'HIGH' }) {
  const color =
    severity === 'HIGH' ? 'bg-red-500' : severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <span className="ring-paper-soft mt-1.5 inline-flex h-2 w-2 shrink-0 rounded-full ring-4">
      <span className={`h-full w-full rounded-full ${color}`} />
    </span>
  );
}

function severityTone(s: 'LOW' | 'MEDIUM' | 'HIGH'): 'success' | 'warn' | 'danger' {
  if (s === 'HIGH') return 'danger';
  if (s === 'MEDIUM') return 'warn';
  return 'success';
}

function statusTone(s: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'): 'accent' | 'default' | 'success' {
  if (s === 'OPEN') return 'accent';
  if (s === 'RESOLVED') return 'success';
  return 'default';
}

function FeedCard({ name, count, muted }: { name: string; count: string; muted?: boolean }) {
  return (
    <div
      className={
        muted
          ? 'border-hairline-strong bg-paper-soft rounded-xl border border-dashed p-4'
          : 'border-hairline bg-paper-soft rounded-xl border p-4'
      }
    >
      <div className="text-ink text-[13px] font-medium">{name}</div>
      <div className="text-ink-faded mt-1 text-[12px]">{count}</div>
    </div>
  );
}
