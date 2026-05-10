import { cn } from '@/lib/cn';

/**
 * Skeleton — a hairline-bordered placeholder that shimmers in gold.
 * Use these to compose loading states that match the observatory aesthetic
 * (no gray boxes; the night sky never goes flat).
 */
export function Skeleton({ className, shimmer = true }: { className?: string; shimmer?: boolean }) {
  return (
    <div
      className={cn(
        'bg-midnight-elev/40 ring-hairline/60 relative overflow-hidden ring-1 ring-inset',
        className,
      )}
      aria-hidden
    >
      {shimmer && <span className="animate-shimmer absolute inset-0" />}
    </div>
  );
}

/**
 * SkeletonText — a stack of shimmering line placeholders with descending widths.
 * lines: how many rows. last-line is always shortest for natural rag.
 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['w-full', 'w-11/12', 'w-10/12', 'w-9/12', 'w-3/4', 'w-2/3'];
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', widths[i % widths.length])} />
      ))}
    </div>
  );
}

/**
 * Telemetry — a single radar-like pulsing dot. Tiny, precise.
 * Used in loading headers to signal a live fetch.
 */
export function Telemetry({ label = 'Receiving telemetry' }: { label?: string }) {
  return (
    <span className="text-2xs text-gold/80 inline-flex items-center gap-3 font-mono uppercase tracking-[0.22em]">
      <span className="relative grid size-2 place-items-center">
        <span className="bg-gold-bright size-2 rounded-full" />
        <span className="animate-pulse-ring bg-gold-bright/60 absolute inset-0 size-2 rounded-full" />
      </span>
      {label}
    </span>
  );
}

/**
 * LoadingScope — a reusable scaffold for full-page loading states.
 * Pulls together a section label, headline placeholder, and a body region
 * the caller fills in. Keeps every loading page coherent.
 */
export function LoadingScope({
  scope,
  title,
  children,
}: {
  scope: string;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-4">
          <div className="text-2xs text-gold flex items-center gap-3 font-mono uppercase tracking-[0.32em]">
            <span className="text-gold/80 text-base">◐</span>
            {scope}
            <span className="hairline-fade-x ml-2 w-24" />
          </div>
          {title ? (
            <h2 className="font-display text-parchment-soft/60 text-3xl font-light md:text-4xl">
              {title}
            </h2>
          ) : (
            <Skeleton className="h-10 w-[28rem] max-w-[80vw]" />
          )}
        </div>
        <Telemetry />
      </header>

      {children}
    </div>
  );
}
