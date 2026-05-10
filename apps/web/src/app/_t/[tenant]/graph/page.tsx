import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockEntities, mockTenantStats } from '@/lib/mock-data';

export const metadata = { title: 'Knowledge graph · Horus' };

export default async function GraphPage({ params }: { params: Promise<{ tenant: string }> }) {
  await params;

  return (
    <>
      <PageHeader
        eyebrow="Knowledge graph"
        title="Entities, relationships, paths."
        description="Horus extracts named entities and the relationships between them as documents are indexed. Use the graph to find context the embeddings miss."
        actions={
          <>
            <Button variant="outline" size="sm">
              Export GraphML
            </Button>
            <Button size="sm">Run query</Button>
          </>
        }
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Entities" value="2,481" delta="+38" trend="up" />
        <StatCard label="Relationships" value="14,902" delta="+212" trend="up" />
        <StatCard
          label="Avg. traversals / query"
          value={mockTenantStats.graphTraversals.toLocaleString()}
        />
        <StatCard label="Resolution rate" value="94.2%" delta="+0.4pt" trend="up" />
      </div>

      <Reveal as="div" className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Panel
          title="Graph view"
          description="Click any node to expand its neighborhood."
          action={
            <Button variant="ghost" size="sm">
              Reset
            </Button>
          }
        >
          <div className="border-hairline bg-paper-soft relative h-[480px] overflow-hidden rounded-xl border">
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 1px 1px, hsl(var(--hairline-strong)) 1px, transparent 0)',
                backgroundSize: '24px 24px',
              }}
            />
            <svg viewBox="0 0 600 480" className="absolute inset-0 h-full w-full">
              <g stroke="hsl(var(--hairline-strong))" strokeWidth="1" fill="none" opacity="0.7">
                <line x1="300" y1="240" x2="120" y2="120" />
                <line x1="300" y1="240" x2="490" y2="100" />
                <line x1="300" y1="240" x2="500" y2="350" />
                <line x1="300" y1="240" x2="110" y2="360" />
                <line x1="300" y1="240" x2="180" y2="420" />
                <line x1="300" y1="240" x2="430" y2="420" />
                <line x1="120" y1="120" x2="490" y2="100" strokeDasharray="3 4" opacity="0.4" />
                <line x1="500" y1="350" x2="430" y2="420" strokeDasharray="3 4" opacity="0.4" />
                <line x1="110" y1="360" x2="180" y2="420" strokeDasharray="3 4" opacity="0.4" />
              </g>

              <Node x={300} y={240} r={42} label="Article 6" sub="high-risk" primary />
              <Node x={120} y={120} r={28} label="GPAI" sub="provider" />
              <Node x={490} y={100} r={32} label="EU Commission" sub="org" />
              <Node x={500} y={350} r={26} label="Annex III" sub="ref" />
              <Node x={110} y={360} r={30} label="Conformity" sub="process" />
              <Node x={180} y={420} r={24} label="CE marking" sub="concept" />
              <Node x={430} y={420} r={26} label="AI Office" sub="org" />
            </svg>

            <div className="border-hairline bg-paper/90 absolute bottom-4 left-4 flex items-center gap-3 rounded-full border px-3 py-1.5 text-[11px] backdrop-blur-md">
              <Legend color="bg-accent" label="Selected" />
              <Legend color="bg-ink" label="Concept" />
              <Legend color="bg-emerald-500" label="Org" />
              <Legend color="bg-amber-500" label="Reference" />
            </div>

            <div className="absolute right-4 top-4 flex flex-col gap-1">
              <ZoomBtn>+</ZoomBtn>
              <ZoomBtn>−</ZoomBtn>
              <ZoomBtn>⤢</ZoomBtn>
            </div>
          </div>
        </Panel>

        <Panel title="Top entities" description="By citation weight in your corpus.">
          <ul className="-mx-1 space-y-0.5">
            {mockEntities.map((e, i) => (
              <li
                key={e.name}
                className="hover:bg-paper-soft flex items-center gap-3 rounded-lg px-2 py-2 transition-colors"
              >
                <span className="num font-technical text-ink-mute w-6 shrink-0 text-[10px]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-ink truncate text-[13px] font-medium">{e.name}</div>
                  <div className="text-ink-faded mt-0.5 text-[11px]">
                    {e.type} · {e.docs} docs
                  </div>
                </div>
                <Pill tone="default">{e.mentions}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      </Reveal>
    </>
  );
}

function Node({
  x,
  y,
  r,
  label,
  sub,
  primary,
}: {
  x: number;
  y: number;
  r: number;
  label: string;
  sub: string;
  primary?: boolean;
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={primary ? 'hsl(var(--accent))' : 'hsl(var(--paper))'}
        stroke={primary ? 'hsl(var(--accent))' : 'hsl(var(--hairline-strong))'}
        strokeWidth="1.4"
      />
      <text
        x={x}
        y={y - 1}
        textAnchor="middle"
        fontSize="11.5"
        fontWeight="600"
        fill={primary ? 'hsl(var(--paper))' : 'hsl(var(--ink))'}
      >
        {label}
      </text>
      <text
        x={x}
        y={y + 12}
        textAnchor="middle"
        fontSize="9"
        fill={primary ? 'hsl(var(--paper) / 0.7)' : 'hsl(var(--ink-faded))'}
      >
        {sub}
      </text>
    </g>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="text-ink-faded flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function ZoomBtn({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="border-hairline bg-paper/90 text-ink-faded hover:text-ink grid h-7 w-7 place-items-center rounded-md border text-[12px] backdrop-blur-md transition-colors"
    >
      {children}
    </button>
  );
}
