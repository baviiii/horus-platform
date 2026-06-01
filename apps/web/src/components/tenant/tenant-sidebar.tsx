'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HorusGlyph, Pill } from '@/components/cosmic';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '', label: 'Overview', glyph: '◐', desc: 'workspace pulse' },
  { href: '/documents', label: 'Documents', glyph: '☉', desc: 'corpus' },
  { href: '/chat', label: 'Chat', glyph: '✦', desc: 'agentic' },
  { href: '/graph', label: 'Graph', glyph: '⌖', desc: 'entities · relations' },
  { href: '/alerts', label: 'Alerts', glyph: '☾', desc: 'tracked changes' },
  { href: '/settings', label: 'Settings', glyph: '◇', desc: 'keys · branding' },
];

export function TenantSidebar({
  slug,
  tenantName,
  plan,
}: {
  slug: string;
  tenantName: string;
  plan: string;
}) {
  const pathname = usePathname();
  const base = `/t/${slug}`;

  return (
    <aside className="border-hairline bg-midnight-deep/80 fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r backdrop-blur-md lg:flex">
      {/* Tenant identity card */}
      <div className="border-hairline border-b px-6 py-7">
        <div className="flex items-start gap-3">
          <HorusGlyph size={36} glow />
          <div className="min-w-0 flex-1">
            <div className="text-parchment-soft/55 font-mono text-[10px] uppercase tracking-[0.22em]">
              Workspace
            </div>
            <div className="font-display text-parchment mt-1 truncate text-xl">{tenantName}</div>
            <div className="mt-2 flex items-center gap-2">
              <Pill tone="gold">{plan}</Pill>
              <span className="text-parchment-soft/50 font-mono text-[10px] uppercase tracking-[0.18em]">
                {slug}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-6">
        <div className="text-parchment-soft/45 px-3 pb-3 font-mono text-[10px] uppercase tracking-[0.22em]">
          Observatory
        </div>
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === '' ? pathname === base : pathname?.startsWith(href);
            return (
              <li key={item.href}>
                <Link
                  href={href}
                  className={cn(
                    'group relative flex items-center gap-3 px-3 py-2.5 transition-colors',
                    active
                      ? 'bg-gold/10 text-parchment'
                      : 'text-parchment-soft hover:bg-midnight-elev/60 hover:text-parchment',
                  )}
                >
                  {active && (
                    <span className="bg-gold absolute inset-y-2 left-0 w-0.5 shadow-[0_0_8px_hsla(38,80%,65%,0.7)]" />
                  )}
                  <span
                    className={cn(
                      'font-display grid size-7 place-items-center text-lg transition-colors',
                      active ? 'text-gold-bright' : 'text-gold/60 group-hover:text-gold-bright',
                    )}
                  >
                    {item.glyph}
                  </span>
                  <span className="flex-1">
                    <span className="block text-base">{item.label}</span>
                    <span className="text-parchment-soft/50 block font-mono text-[10px] uppercase tracking-[0.18em]">
                      {item.desc}
                    </span>
                  </span>
                  {active && <span className="text-gold-bright">→</span>}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="border-hairline mt-8 border-t pt-6">
          <div className="text-parchment-soft/45 px-3 pb-3 font-mono text-[10px] uppercase tracking-[0.22em]">
            Platform
          </div>
          <ul className="space-y-0.5">
            <SecondaryLink href="/docs" label="Documentation" glyph="📜" />
            <SecondaryLink href="/changelog" label="Changelog" glyph="✦" />
            <SecondaryLink href="https://status.horus.ai" label="Status" glyph="●" external />
          </ul>
        </div>
      </nav>

      <div className="border-hairline border-t px-6 py-4">
        <div className="border-hairline-bright/30 bg-midnight-elev/40 rounded-sm border px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-gold font-mono text-[10px] uppercase tracking-[0.22em]">
              Usage · this cycle
            </span>
            <span className="text-parchment-soft/65 num font-mono text-[10px]">62%</span>
          </div>
          <div className="bg-midnight-deep mt-2 h-1 overflow-hidden">
            <div className="from-gold to-gold-bright h-full w-[62%] bg-gradient-to-r" />
          </div>
          <div className="text-parchment-soft/55 num mt-2 font-mono text-[10px] tracking-[0.1em]">
            41,209 / 67,000 RAG queries
          </div>
        </div>
      </div>
    </aside>
  );
}

function SecondaryLink({
  href,
  label,
  glyph,
  external = false,
}: {
  href: string;
  label: string;
  glyph: string;
  external?: boolean;
}) {
  const className =
    'group flex items-center gap-3 px-3 py-2 text-sm text-parchment-soft transition-colors hover:bg-midnight-elev/60 hover:text-parchment';
  const inner = (
    <>
      <span className="text-gold/60 group-hover:text-gold grid size-6 place-items-center text-xs">
        {glyph}
      </span>
      <span className="flex-1">{label}</span>
      <span className="text-parchment-soft/40 group-hover:text-gold">→</span>
    </>
  );
  return (
    <li>
      {external ? (
        <a className={className} href={href} target="_blank" rel="noreferrer">
          {inner}
        </a>
      ) : (
        <Link className={className} href={href}>
          {inner}
        </Link>
      )}
    </li>
  );
}
