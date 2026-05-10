'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Wordmark } from '@/components/horus';

/* =============================================================================
 * AppShell — sidebar + topbar layout used by tenant + admin consoles.
 * Clean, dense, dark-by-default. Apple Console + Linear inspired.
 * ========================================================================== */

export type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
};

export type NavGroup = {
  title?: string;
  items: NavItem[];
};

export function AppShell({
  children,
  brand,
  groups,
  user,
  context,
  invert = true,
}: {
  children: React.ReactNode;
  brand: { name: string; href: string; tag?: string };
  groups: NavGroup[];
  user: { name: string; email: string; initials: string };
  context?: React.ReactNode;
  invert?: boolean;
}) {
  return (
    <div className={cn('relative min-h-screen', invert && 'dark')}>
      <div className="bg-paper text-ink min-h-screen">
        <Sidebar brand={brand} groups={groups} user={user} />
        <div className="lg:pl-[244px]">
          <Topbar brand={brand} context={context} />
          <main className="px-6 py-8 md:px-10 md:py-10">{children}</main>
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  brand,
  groups,
  user,
}: {
  brand: { name: string; href: string; tag?: string };
  groups: NavGroup[];
  user: { name: string; email: string; initials: string };
}) {
  const pathname = usePathname();
  return (
    <aside className="border-hairline bg-paper-soft fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col border-r lg:flex">
      <div className="px-5 pb-5 pt-6">
        <Link
          href={brand.href}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <Wordmark size="sm" />
        </Link>
        {brand.tag && (
          <div className="bg-paper text-ink-faded ring-hairline mt-3 inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[11px] font-medium ring-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {brand.tag}
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.title && (
              <div className="text-ink-mute mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em]">
                {group.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== brand.href && pathname?.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium transition-all duration-300',
                        active
                          ? 'bg-paper text-ink ring-accent/20 shadow-sm ring-1'
                          : 'text-ink-faded hover:bg-paper hover:text-ink',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'bg-accent absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full transition-all duration-300',
                          active
                            ? 'opacity-100 shadow-[0_0_8px_hsl(var(--accent)/0.6)]'
                            : 'opacity-0',
                        )}
                      />
                      <span
                        className={cn(
                          'inline-flex h-4 w-4 shrink-0 items-center justify-center transition-colors',
                          active ? 'text-accent' : 'text-ink-mute group-hover:text-accent',
                        )}
                      >
                        {item.icon}
                      </span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge && (
                        <span className="bg-accent/15 text-accent rounded-full px-1.5 text-[10px] font-semibold">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-hairline border-t p-3">
        <div className="hover:bg-paper flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors">
          <span className="bg-accent/15 text-accent grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold">
            {user.initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-ink truncate text-[13px] font-medium">{user.name}</div>
            <div className="text-ink-faded truncate text-[11px]">{user.email}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-ink-faded">
            <path
              d="M3 5l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </aside>
  );
}

function Topbar({
  brand,
  context,
}: {
  brand: { name: string; href: string };
  context?: React.ReactNode;
}) {
  return (
    <header className="glass sticky top-0 z-20 flex h-14 items-center justify-between gap-4 px-6 md:px-10">
      <div className="flex items-center gap-3">{context}</div>
      <div className="flex items-center gap-2">
        <SearchTrigger />
        <IconButton aria-label="Notifications">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6.5a4 4 0 118 0v2l1.4 2.5H2.6L4 8.5v-2zM6 12a2 2 0 004 0"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
      </div>
    </header>
  );
}

function SearchTrigger() {
  return (
    <button
      type="button"
      className="border-hairline bg-paper text-ink-faded hover:border-hairline-strong hover:text-ink hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors md:flex"
    >
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <span>Search</span>
      <span className="border-hairline bg-paper-deep text-ink-faded ml-2 rounded border px-1.5 py-0.5 text-[10px] font-medium">
        ⌘K
      </span>
    </button>
  );
}

function IconButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="text-ink-faded hover:bg-paper-soft hover:text-ink grid h-8 w-8 place-items-center rounded-full transition-colors"
      {...props}
    >
      {children}
    </button>
  );
}

/* =============================================================================
 * Page primitives — pulled out so consumer pages stay small.
 * ========================================================================== */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div>
        {eyebrow && (
          <div className="eyebrow mb-3">
            <span className="bg-accent h-1 w-1 rounded-full" />
            {eyebrow}
          </div>
        )}
        <h1 className="text-ink text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="text-ink-faded mt-2 max-w-2xl text-[15px] leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  delta,
  trend,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
}) {
  const trendColor =
    trend === 'up' ? 'text-emerald-500' : trend === 'down' ? 'text-red-500' : 'text-ink-faded';
  return (
    <div className="border-hairline bg-paper hover:border-accent/40 hover:shadow-blue group relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-0.5">
      <div className="from-accent/0 to-accent/0 pointer-events-none absolute -inset-px -z-10 rounded-2xl bg-gradient-to-br via-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="text-ink-faded text-[12px] font-medium">{label}</div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="num text-ink text-3xl font-semibold tracking-tight">{value}</div>
        {delta && (
          <span className={cn('font-technical text-[11px] font-medium', trendColor)}>{delta}</span>
        )}
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'border-hairline bg-paper hover:border-hairline-strong rounded-2xl border transition-colors duration-300',
        className,
      )}
    >
      {(title || action) && (
        <div className="border-hairline flex items-center justify-between gap-4 border-b px-6 py-4">
          <div>
            {title && (
              <h2 className="text-ink text-[15px] font-semibold tracking-tight">{title}</h2>
            )}
            {description && <p className="text-ink-faded mt-0.5 text-[13px]">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-6">{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'success' | 'warn' | 'danger' | 'accent';
}) {
  const tones = {
    default: 'bg-paper-soft text-ink-soft border-hairline',
    success: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    warn: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    danger: 'bg-red-500/10 text-red-600 border-red-500/20',
    accent: 'bg-accent/10 text-accent border-accent/20',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function SparkLine({
  data,
  width = 96,
  height = 28,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data?.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = width / Math.max(data.length - 1, 1);
  const id = React.useId();
  const points = data.map((v, i) => `${i * step},${height - ((v - min) / span) * height}`);
  const line = points.join(' ');
  const area = `${points.join(' ')} ${width},${height} 0,${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('spark-draw', className)}
    >
      <defs>
        <linearGradient id={`sl-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--accent-deep))" />
          <stop offset="100%" stopColor="hsl(var(--accent-glow))" />
        </linearGradient>
        <linearGradient id={`sa-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#sa-${id})`} points={area} />
      <polyline
        fill="none"
        stroke={`url(#sl-${id})`}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={line}
      />
    </svg>
  );
}
