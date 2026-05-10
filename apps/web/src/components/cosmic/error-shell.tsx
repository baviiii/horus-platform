'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  StarField,
  HorusWordmark,
  Panel,
  CornerMarks,
  SectionLabel,
  Coord,
  HorizonRule,
} from '@/components/cosmic';

export interface ErrorShellProps {
  /** What broke, in human terms. */
  title?: string;
  /** Slightly longer explanation. */
  message?: string;
  /** The Error object, for digest + dev display. */
  error?: Error & { digest?: string };
  /** Reset callback wired up by the error.tsx boundary. */
  reset?: () => void;
  /** Tone — root catches everything, segment errors are scoped. */
  scope?: 'root' | 'tenant' | 'admin';
  /** Suggested actions to render in the footer. */
  actions?: React.ReactNode;
  /** Extra coordinate stamp shown top-right. */
  coord?: string;
}

/**
 * Universal error fallback rendered by every error.tsx in the tree.
 * Looks intentional, not panicked — like a marginalia note in an old chart.
 */
export function ErrorShell({
  title = 'A signal was lost in transit',
  message = 'The instruments returned an unexpected reading. Our observers have been notified, and the path back is restored below.',
  error,
  reset,
  scope = 'root',
  actions,
  coord,
}: ErrorShellProps) {
  const scopeLabel =
    scope === 'tenant' ? 'Workspace fault' : scope === 'admin' ? 'Admin fault' : 'Platform fault';
  const code = error?.digest ?? 'horus-fault';

  return (
    <main className="relative isolate min-h-screen overflow-hidden">
      <StarField />
      {/* Faint chart grid */}
      <div className="bg-grid-faded pointer-events-none absolute inset-0">
        <div className="bg-grid-coarse absolute inset-0 opacity-40" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <HorusWordmark variant="sm" />
          </Link>
          <Coord>{coord ?? `lat 00°00′ · lon ∞ · ${code.slice(0, 8)}`}</Coord>
        </header>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="animate-reveal w-full">
            <div className="mb-8 flex items-center gap-4">
              <span className="text-2xs text-oxblood/80 font-mono uppercase tracking-[0.32em]">
                {scopeLabel}
              </span>
              <span className="hairline-fade-x flex-1" />
              <span className="text-2xs text-parchment-soft/55 font-mono uppercase tracking-[0.32em]">
                Code · {code}
              </span>
            </div>

            <h1 className="font-display text-parchment text-5xl font-light italic leading-[1.05] md:text-6xl">
              {title}.
            </h1>

            <p className="text-parchment-soft/80 mt-6 max-w-xl text-lg">{message}</p>

            <Panel tone="elev" className="relative mt-10 px-6 py-5">
              <CornerMarks />
              <SectionLabel index="01" className="mb-3">
                What happened
              </SectionLabel>
              <p className="text-parchment-soft/75 font-mono text-xs leading-relaxed">
                {error?.message ?? 'Unknown — the upstream call returned no message.'}
              </p>
              {error?.stack && process.env.NODE_ENV === 'development' && (
                <pre className="border-hairline text-parchment-soft/55 mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words border-t pt-3 font-mono text-[10px] leading-relaxed">
                  {error.stack}
                </pre>
              )}
            </Panel>

            <div className="mt-10">
              <HorizonRule>Possible orbits</HorizonRule>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {reset && (
                <Button variant="default" size="lg" onClick={() => reset()}>
                  Recalibrate
                </Button>
              )}
              <Button asChild variant="outline" size="lg">
                <Link href="/">Return home</Link>
              </Button>
              {actions}
              <Button asChild variant="ghost" size="lg">
                <a href="mailto:support@horus.ai?subject=Fault%20report">Report to ops</a>
              </Button>
            </div>
          </div>
        </div>

        <footer className="border-hairline text-parchment-soft/50 border-t pt-6 font-mono text-[10px] uppercase tracking-[0.2em]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Horus observatory · fault catalogue</span>
            <span>{new Date().toUTCString()}</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
