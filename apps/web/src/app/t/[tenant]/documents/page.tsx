import { PageHeader, Panel, Pill, StatCard } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { mockDocuments, mockTenantStats } from '@/lib/mock-data';

export const metadata = { title: 'Documents · Horus' };

export default async function DocumentsPage({ params }: { params: Promise<{ tenant: string }> }) {
  await params;

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Sources, indexed and searchable."
        description="Upload PDFs, regulations, memos, transcripts. Horus chunks, embeds, and graphs them — usually in under a minute."
        actions={
          <>
            <Button variant="outline" size="sm">
              Connect drive
            </Button>
            <Button size="sm">Upload</Button>
          </>
        }
      />

      <div className="reveal-stagger grid gap-4 md:grid-cols-4">
        <StatCard label="Documents" value={mockTenantStats.documents.toLocaleString()} />
        <StatCard
          label="Pages"
          value={mockTenantStats.pages.toLocaleString()}
          delta="+1.2k"
          trend="up"
        />
        <StatCard
          label="Storage"
          value={`${mockTenantStats.storageGb} GB`}
          delta={`of ${mockTenantStats.storageLimitGb} GB`}
        />
        <StatCard label="Indexed today" value="12" delta="2 processing" trend="flat" />
      </div>

      <div className="reveal-stagger mt-8 flex flex-wrap items-center gap-2 text-[12px]">
        <FilterChip active>All</FilterChip>
        <FilterChip>Regulations</FilterChip>
        <FilterChip>Frameworks</FilterChip>
        <FilterChip>Memos</FilterChip>
        <FilterChip>Processing</FilterChip>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            placeholder="Search title, entity, citation…"
            className="border-hairline bg-paper text-ink placeholder:text-ink-mute focus:border-accent h-8 w-64 rounded-full border px-3.5 text-[12.5px] focus:outline-none"
          />
        </div>
      </div>

      <Reveal as="div">
        <Panel className="mt-4">
          <div className="-mx-6 -my-6 overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-[13px]">
              <thead>
                <tr className="border-hairline text-ink-mute border-b text-[10px] font-semibold uppercase tracking-[0.16em]">
                  <th className="px-6 py-3">Title</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3 text-right">Pages</th>
                  <th className="px-3 py-3 text-right">Chunks</th>
                  <th className="px-3 py-3 text-right">Citations</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Uploader</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {mockDocuments.map((d) => (
                  <tr
                    key={d.id}
                    className="border-hairline/60 hover:bg-paper-soft border-b transition-colors last:border-b-0"
                  >
                    <td className="px-6 py-3.5">
                      <div className="text-ink font-medium">{d.title}</div>
                      <div className="font-technical text-ink-mute mt-0.5 text-[11px]">{d.id}</div>
                    </td>
                    <td className="text-ink-faded px-3 py-3.5">{d.type}</td>
                    <td className="num text-ink-soft px-3 py-3.5 text-right tabular-nums">
                      {d.pages}
                    </td>
                    <td className="num text-ink-soft px-3 py-3.5 text-right tabular-nums">
                      {d.chunks.toLocaleString()}
                    </td>
                    <td className="num text-ink-soft px-3 py-3.5 text-right tabular-nums">
                      {d.citations}
                    </td>
                    <td className="px-3 py-3.5">
                      <Pill tone={statusTone(d.status)}>{d.status.toLowerCase()}</Pill>
                    </td>
                    <td className="text-ink-faded px-3 py-3.5">{d.uploader}</td>
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
        <span>Showing 7 of {mockTenantStats.documents.toLocaleString()}</span>
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

function statusTone(s: 'INDEXED' | 'PROCESSING' | 'FAILED'): 'success' | 'accent' | 'danger' {
  if (s === 'INDEXED') return 'success';
  if (s === 'PROCESSING') return 'accent';
  return 'danger';
}
