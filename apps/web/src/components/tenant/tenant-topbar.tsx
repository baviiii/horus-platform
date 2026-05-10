'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Coord, Pill } from '@/components/cosmic';
import { Button } from '@/components/ui/button';

const SEGMENT_LABEL: Record<string, string> = {
  '': 'Overview',
  documents: 'Documents',
  chat: 'Chat',
  graph: 'Graph',
  alerts: 'Alerts',
  settings: 'Settings',
};

export function TenantTopbar({
  tenantSlug,
  tenantName,
  user,
}: {
  tenantSlug: string;
  tenantName: string;
  user: { displayName: string; email: string; initials: string; role: string };
}) {
  const pathname = usePathname();
  const segs = pathname?.split(`/_t/${tenantSlug}`)[1]?.split('/').filter(Boolean) ?? [];
  const current = SEGMENT_LABEL[segs[0] ?? ''] ?? 'Overview';

  return (
    <header className="border-hairline bg-midnight-deep/85 sticky top-0 z-20 border-b backdrop-blur-md">
      <div className="flex items-center gap-6 px-6 py-4 md:px-10">
        <nav
          aria-label="Breadcrumb"
          className="text-2xs text-parchment-soft/65 flex flex-1 items-center gap-3 font-mono uppercase tracking-[0.22em]"
        >
          <span className="text-parchment-soft/55">Workspace</span>
          <span className="text-gold">/</span>
          <Link
            href={`/_t/${tenantSlug}`}
            className="text-parchment hover:text-gold-bright transition-colors"
          >
            {tenantName}
          </Link>
          <span className="text-gold">/</span>
          <span className="text-parchment">{current}</span>
        </nav>

        <Coord className="hidden md:inline-flex">live · channel 0x01</Coord>

        <button className="border-hairline bg-midnight-elev/40 text-2xs text-parchment-soft hover:border-gold/60 hover:text-gold hidden h-9 items-center gap-2 border px-3 font-mono uppercase tracking-[0.22em] transition-colors md:inline-flex">
          <span>⌘ K</span>
          <span className="text-parchment-soft/55">Quick observe</span>
        </button>

        <div className="flex items-center gap-3">
          <Button asChild size="sm" variant="outline">
            <Link href={`/_t/${tenantSlug}/chat`}>+ New chart</Link>
          </Button>

          <button
            className="border-hairline group flex items-center gap-3 border-l pl-4 text-left"
            aria-label="Account menu"
          >
            <div className="hidden md:block">
              <div className="text-parchment text-sm leading-tight">{user.displayName}</div>
              <div className="text-parchment-soft/55 font-mono text-[10px] uppercase tracking-[0.22em]">
                {user.role}
              </div>
            </div>
            <span className="bg-gold/15 font-display text-gold-bright ring-gold/30 group-hover:ring-gold grid size-9 place-items-center rounded-full text-sm font-medium ring-1 transition-shadow">
              {user.initials}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
