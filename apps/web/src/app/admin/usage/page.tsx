import { PageHeader, Panel, SparkLine, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockPlatform, mockSpark } from '@/lib/mock-data';

export const metadata = { title: 'Usage & billing · Admin · Horus' };

export default function UsagePage() {
  const arpt = mockPlatform.mrrUsd / mockPlatform.activeTenants;

  return (
    <>
      <PageHeader
        eyebrow="Platform · Usage & billing"
        title="Where the meter spins."
        description="Revenue, usage, infrastructure spend. Roll-up across every tenant on every plan."
        actions={
          <>
            <Button variant="outline" size="sm">
              Stripe dashboard
            </Button>
            <Button size="sm">Export period</Button>
          </>
        }
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard
          label="MRR"
          value={`$${(mockPlatform.mrrUsd / 1000).toFixed(1)}k`}
          delta="+6.3%"
          trend="up"
        />
        <StatCard
          label="ARR"
          value={`$${(mockPlatform.arrUsd / 1_000_000).toFixed(2)}M`}
          delta="+18.4%"
          trend="up"
        />
        <StatCard label="ARPT" value={`$${arpt.toFixed(0)}`} delta="+$42" trend="up" />
        <StatCard
          label="Net churn · 30d"
          value={`${(mockPlatform.churn30d * 100).toFixed(1)}%`}
          delta="−0.4pt"
          trend="up"
        />
      </div>

      <Reveal as="div" className="mt-8 grid gap-6 lg:grid-cols-12">
        <Panel
          title="Revenue · last 30 days"
          description="Net new MRR after expansion and contraction."
          className="lg:col-span-7"
        >
          <div className="flex items-end gap-3">
            <div>
              <div className="num text-ink text-4xl font-semibold tracking-tight">$184,220</div>
              <div className="text-ink-faded mt-1 text-[12.5px]">+$10,920 net new this period</div>
            </div>
            <div className="ml-auto flex items-center gap-1 text-[11px]">
              <RangeBtn>7d</RangeBtn>
              <RangeBtn active>30d</RangeBtn>
              <RangeBtn>90d</RangeBtn>
              <RangeBtn>YTD</RangeBtn>
            </div>
          </div>
          <div className="mt-6 h-44">
            <SparkLine data={mockSpark.embeddings} width={680} height={170} className="w-full" />
          </div>
        </Panel>

        <Panel title="Plan distribution" className="lg:col-span-5">
          <ul className="space-y-4">
            <PlanRow name="SCALE" tenants={28} mrr={108_400} pct={0.59} color="bg-accent" />
            <PlanRow name="PRO" tenants={71} mrr={61_200} pct={0.33} color="bg-ink" />
            <PlanRow name="STARTER" tenants={33} mrr={14_620} pct={0.08} color="bg-ink-faded" />
          </ul>
          <div className="border-hairline text-ink-faded mt-6 border-t pt-5 text-[12.5px]">
            Free: 14 workspaces · evaluation phase
          </div>
        </Panel>

        <Panel
          title="Compute & infrastructure"
          description="Estimated daily cost across providers."
          className="lg:col-span-12"
        >
          <div className="grid gap-6 md:grid-cols-4">
            <CostTile label="Inference" value="$1,402" delta="+$120" />
            <CostTile label="Embeddings" value="$284" delta="+$8" />
            <CostTile label="Vector DB" value="$192" delta="−$4" trend="down" />
            <CostTile label="Storage" value="$78" delta="+$2" />
          </div>
          <div className="bg-hairline mt-6 h-px" />
          <div className="mt-5 grid gap-4 text-[12.5px] md:grid-cols-3">
            <Row k="Gross margin (90d)" v="71.4%" />
            <Row k="Margin trend" v="↑ 1.2pt vs prior period" />
            <Row k="Burn-multiple" v="0.8x" />
          </div>
        </Panel>
      </Reveal>
    </>
  );
}

function RangeBtn({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={
        active
          ? 'bg-ink font-technical text-paper rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em]'
          : 'font-technical text-ink-faded hover:bg-paper-soft hover:text-ink rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors'
      }
    >
      {children}
    </button>
  );
}

function PlanRow({
  name,
  tenants,
  mrr,
  pct,
  color,
}: {
  name: string;
  tenants: number;
  mrr: number;
  pct: number;
  color: string;
}) {
  return (
    <li>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-ink font-medium">{name}</span>
        <span className="num font-technical text-ink-faded text-[11.5px]">
          {tenants} tenants · ${mrr.toLocaleString()}
        </span>
      </div>
      <div className="bg-paper-soft mt-1.5 h-1.5 overflow-hidden rounded-full">
        <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="text-ink-mute mt-1 text-right text-[11px]">
        {(pct * 100).toFixed(0)}% of MRR
      </div>
    </li>
  );
}

function CostTile({
  label,
  value,
  delta,
  trend,
}: {
  label: string;
  value: string;
  delta: string;
  trend?: 'up' | 'down';
}) {
  return (
    <div className="border-hairline bg-paper-soft rounded-xl border p-4">
      <div className="text-ink-faded text-[12px] font-medium">{label}</div>
      <div className="num text-ink mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      <div
        className={
          trend === 'down'
            ? 'font-technical mt-1 text-[11px] text-emerald-500'
            : 'font-technical text-ink-faded mt-1 text-[11px]'
        }
      >
        {delta}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-hairline bg-paper-soft flex items-center justify-between rounded-lg border px-3 py-2.5">
      <span className="text-ink-faded">{k}</span>
      <span className="num text-ink font-medium">{v}</span>
    </div>
  );
}
