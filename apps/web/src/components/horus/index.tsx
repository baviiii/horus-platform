import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/* =============================================================================
 * Wordmark — the Horus glyph + name. Crisp, mathematical, unfussy.
 * The glyph: an abstract eye built from a square + a single arc. Looks like a
 * monogram, not a logo design contest entry.
 * ========================================================================== */

export function HorusGlyph({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="horus-glyph-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--accent-deep))" />
          <stop offset="55%" stopColor="hsl(var(--accent))" />
          <stop offset="100%" stopColor="hsl(var(--accent-glow))" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#horus-glyph-grad)" />
      <path d="M8 17 Q 16 9 24 17 Q 16 23 8 17 Z" fill="hsl(var(--paper))" opacity="0.96" />
      <circle cx="16" cy="17" r="2.6" fill="hsl(var(--accent-deep))" />
      <circle cx="16.7" cy="16.3" r="0.8" fill="hsl(var(--paper))" />
    </svg>
  );
}

export function Wordmark({
  className,
  size = 'default',
  invert = false,
}: {
  className?: string;
  size?: 'sm' | 'default' | 'lg';
  invert?: boolean;
}) {
  const dim = size === 'sm' ? 22 : size === 'lg' ? 32 : 26;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 font-semibold tracking-[-0.02em]',
        size === 'sm' ? 'text-[15px]' : size === 'lg' ? 'text-xl' : 'text-base',
        invert ? 'text-paper' : 'text-ink',
        className,
      )}
    >
      <HorusGlyph size={dim} className={invert ? 'invert' : ''} />
      <span>Horus</span>
    </span>
  );
}

/* =============================================================================
 * Eyebrow — small uppercase label. The visual rhythm marker.
 * ========================================================================== */

export function Eyebrow({
  children,
  dot = true,
  className,
}: {
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-technical inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]',
        'text-accent',
        className,
      )}
    >
      {dot && (
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="bg-accent animate-pulse-soft absolute inset-0 rounded-full" />
          <span className="bg-accent absolute inset-0 rounded-full" />
        </span>
      )}
      {children}
    </span>
  );
}

/* =============================================================================
 * Container — Apple-style max-width with consistent gutters.
 * ========================================================================== */

export function Container({
  className,
  children,
  size = 'default',
}: {
  className?: string;
  children: React.ReactNode;
  size?: 'narrow' | 'default' | 'wide';
}) {
  return (
    <div
      className={cn(
        'mx-auto px-6 md:px-8',
        size === 'narrow' && 'max-w-3xl',
        size === 'default' && 'max-w-6xl',
        size === 'wide' && 'max-w-[1280px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* =============================================================================
 * Section — vertical rhythm + optional theme inversion.
 * ========================================================================== */

export function Section({
  children,
  className,
  invert = false,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  invert?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      data-anchor={id ? '' : undefined}
      className={cn(
        'section relative',
        invert ? 'bg-ink text-paper' : 'bg-paper text-ink',
        className,
      )}
    >
      {children}
    </section>
  );
}

/* =============================================================================
 * Nav — frosted, sticky, minimal. The most important component.
 * ========================================================================== */

const navLinks = [
  { href: '/#product', label: 'Product' },
  { href: '/#capabilities', label: 'Capabilities' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
];

export function MarketingNav({ pathname = '/' }: { pathname?: string }) {
  return (
    <header className="glass sticky top-0 z-50">
      <Container size="wide" className="flex h-14 items-center justify-between">
        <Link
          href="/"
          className="group inline-flex items-center gap-2.5 transition-all duration-300 hover:gap-3"
        >
          <Wordmark size="sm" />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'group relative rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                pathname === l.href ? 'text-ink' : 'text-ink-faded hover:text-ink',
              )}
            >
              <span className="relative z-10">{l.label}</span>
              <span className="bg-accent/0 group-hover:bg-accent/8 absolute inset-0 rounded-full transition-all duration-300" />
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="text-ink-faded hover:text-ink hidden rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="bg-ink text-paper group relative inline-flex h-8 items-center overflow-hidden rounded-full px-4 text-[13px] font-medium transition-all duration-300 hover:shadow-[0_8px_20px_-6px_hsl(var(--accent)/0.45)]"
          >
            <span className="from-accent-deep via-accent to-accent-glow absolute inset-0 -translate-x-full bg-gradient-to-r transition-transform duration-500 group-hover:translate-x-0" />
            <span className="relative">Get started</span>
          </Link>
        </div>
      </Container>
    </header>
  );
}

/* =============================================================================
 * Footer — quiet, structured, never busy.
 * ========================================================================== */

const footerCols = [
  {
    title: 'Product',
    links: [
      { href: '/#capabilities', label: 'Capabilities' },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/docs', label: 'Documentation' },
      { href: '/changelog', label: 'Changelog' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/careers', label: 'Careers' },
      { href: '/contact', label: 'Contact' },
      { href: '/security', label: 'Security' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-hairline bg-paper border-t">
      <Container size="wide" className="py-16">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Wordmark size="sm" />
            <p className="text-ink-faded mt-4 max-w-xs text-sm leading-relaxed">
              The intelligence layer for ambitious software teams.
            </p>
          </div>
          {footerCols.map((col) => (
            <div key={col.title}>
              <div className="eyebrow mb-4">{col.title}</div>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-ink-soft hover:text-ink text-sm transition-colors"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-hairline text-ink-faded mt-16 flex flex-col items-start justify-between gap-3 border-t pt-8 text-xs sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Horus, Inc.</span>
          <span className="font-technical tracking-wider">
            Built for systems that need to think.
          </span>
        </div>
      </Container>
    </footer>
  );
}

/* =============================================================================
 * Card primitives
 * ========================================================================== */

export function Card({
  className,
  children,
  hoverable = false,
}: {
  className?: string;
  children: React.ReactNode;
  hoverable?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-hairline bg-paper rounded-3xl border p-8',
        hoverable &&
          'hover:border-hairline-strong transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* =============================================================================
 * KPI / metric block
 * ========================================================================== */

export function Metric({
  value,
  label,
  suffix,
}: {
  value: string;
  label: string;
  suffix?: string;
}) {
  return (
    <div>
      <div className="num text-ink text-5xl font-medium tracking-tight md:text-6xl">
        {value}
        {suffix && (
          <span className="text-ink-faded text-2xl font-normal md:text-3xl">{suffix}</span>
        )}
      </div>
      <div className="text-ink-faded mt-2 text-sm">{label}</div>
    </div>
  );
}
