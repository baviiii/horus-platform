import Link from 'next/link';
import {
  StarField,
  HorusWordmark,
  Coord,
  SectionLabel,
  Panel,
  CornerMarks,
  Pill,
  HorizonRule,
  ConstellationOrbit,
} from '@/components/cosmic';
import { Button } from '@/components/ui/button';

/**
 * Soon — themed placeholder for routes that exist for the navigation flow
 * but whose content is still in-flight. Keeps every link from 404-ing while
 * being honest about what's not yet shipped.
 */
export function Soon({
  scope,
  title,
  body,
  eta = 'on the next pass',
  index = '◐',
}: {
  scope: string;
  title: React.ReactNode;
  body: string;
  eta?: string;
  index?: string;
}) {
  return (
    <div className="bg-midnight-deep relative min-h-screen overflow-hidden">
      <StarField className="opacity-40" />
      <div className="bg-grid-faded pointer-events-none absolute inset-0">
        <div className="bg-grid-coarse absolute inset-0 opacity-15" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1280px] flex-col px-6 py-6 md:px-10">
        <header className="border-hairline mb-12 flex items-center justify-between border-b pb-6">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <HorusWordmark />
          </Link>
          <Coord>{scope} · in flight</Coord>
          <Pill tone="gold">draft · 2026.05</Pill>
        </header>

        <main className="grid flex-1 grid-cols-12 items-center gap-10">
          <section className="col-span-12 lg:col-span-7">
            <SectionLabel index={index}>{scope}</SectionLabel>
            <h1 className="font-display text-parchment mt-6 text-5xl font-light leading-[0.95] md:text-6xl">
              {title}
            </h1>
            <p className="font-body text-parchment-soft/75 mt-8 max-w-xl text-base leading-relaxed">
              {body}
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href="/">← Return to landing</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/signup">Open the console</Link>
              </Button>
            </div>

            <div className="border-hairline bg-hairline mt-12 grid grid-cols-2 gap-px overflow-hidden border sm:max-w-md">
              <Stat label="status" value="drafting" />
              <Stat label="eta" value={eta} />
            </div>
          </section>

          <Panel
            tone="elev"
            className="relative col-span-12 hidden aspect-square lg:col-span-5 lg:block"
          >
            <CornerMarks />
            <div className="absolute inset-0 grid place-items-center">
              <ConstellationOrbit />
              <span className="font-display text-gold-bright/30 absolute text-7xl">{index}</span>
            </div>
          </Panel>
        </main>

        <footer className="border-hairline mt-16 border-t pt-6">
          <HorizonRule>
            {scope} · ships {eta}
          </HorizonRule>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-midnight px-4 py-3">
      <div className="text-parchment-soft/55 font-mono text-[10px] uppercase tracking-[0.22em]">
        {label}
      </div>
      <div className="font-display text-parchment mt-1 text-base">{value}</div>
    </div>
  );
}
