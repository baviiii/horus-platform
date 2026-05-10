import * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Field-journal primitives. Warm parchment paper, dark ink, hand-drawn
 * illustrations, taped polaroids, ink stamps and scribbled marginalia.
 *
 * Used by the public marketing pages. Strictly self-contained — no cosmic
 * tokens here.
 */

// ─────────────────────────────────────────────────────────────────
// EyeOfHorus — sketchy, hand-inked rendition of the wedjat
// ─────────────────────────────────────────────────────────────────
export function EyeOfHorus({
  className,
  withAnnotations = false,
}: {
  className?: string;
  withAnnotations?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 480 320"
      className={cn('text-ink', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="6" />
          <feDisplacementMap in="SourceGraphic" scale="1.6" />
        </filter>
      </defs>

      <g
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        filter="url(#rough)"
      >
        {/* upper lid */}
        <path d="M40 168 C 110 96, 240 80, 360 124 C 400 138, 426 156, 444 172" />
        {/* second eyebrow stroke (a touch above) */}
        <path d="M70 144 C 140 96, 240 92, 320 110" strokeOpacity="0.55" strokeWidth="2.4" />
        {/* lower lid */}
        <path d="M44 172 C 130 220, 250 230, 360 198 C 400 188, 422 178, 442 174" />
        {/* almond — close it */}
        <path d="M442 174 C 446 174, 446 168, 444 172" />

        {/* iris circle */}
        <circle cx="244" cy="174" r="34" />
        {/* pupil */}
        <circle cx="244" cy="174" r="11" fill="currentColor" />
        {/* iris highlight */}
        <circle cx="234" cy="166" r="3" fill="#f3ead6" stroke="none" />

        {/* the curling flourish under the eye */}
        <path d="M150 220 C 170 250, 200 254, 220 232" />
        {/* the descending teardrop */}
        <path d="M222 218 C 220 248, 220 280, 230 300" />
        {/* the curling tail at the right */}
        <path d="M340 200 C 360 220, 380 240, 396 264 C 410 286, 420 302, 408 312 C 394 314, 380 296, 376 280" />
      </g>

      {/* eyelashes — short loose strokes */}
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7">
        <line x1="120" y1="116" x2="116" y2="100" />
        <line x1="160" y1="104" x2="158" y2="86" />
        <line x1="208" y1="98" x2="208" y2="78" />
        <line x1="252" y1="98" x2="256" y2="78" />
        <line x1="296" y1="104" x2="302" y2="86" />
      </g>

      {withAnnotations && (
        <g fontFamily="var(--font-hand), Caveat, cursive" fontSize="22" fill="#b8552c">
          {/* annotation lines */}
          <g stroke="#b8552c" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.7">
            <path d="M244 174 L 380 60" />
            <path d="M244 174 L 110 270" strokeDasharray="3 4" />
            <path d="M444 172 L 470 130" />
          </g>
          <text x="386" y="56" fontWeight="600">
            this watches
          </text>
          <text x="386" y="80" fontWeight="600">
            your docs.
          </text>
          <text x="20" y="288" fontWeight="600">
            +citations
          </text>
          <text x="20" y="310">
            (yes, real ones)
          </text>
          <text x="406" y="124">
            retrieval
          </text>
        </g>
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// InkStamp — rotated rubber-stamp text ("FILED", "SEEN", "URGENT")
// ─────────────────────────────────────────────────────────────────
export function InkStamp({
  children,
  color = 'rust',
  rotate = -8,
  className,
  size = 'md',
}: {
  children: React.ReactNode;
  color?: 'rust' | 'moss' | 'wash' | 'ink';
  rotate?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const colorMap = {
    rust: '#b8552c',
    moss: '#4d6a3a',
    wash: '#1f3344',
    ink: '#1a1410',
  };
  const sizeMap = {
    sm: { padX: 8, padY: 4, fs: 10, border: 1.5 },
    md: { padX: 12, padY: 6, fs: 11, border: 2 },
    lg: { padX: 18, padY: 9, fs: 14, border: 2.5 },
  };
  const c = colorMap[color];
  const s = sizeMap[size];
  return (
    <span
      className={cn('inline-block font-mono uppercase', className)}
      style={{
        color: c,
        border: `${s.border}px solid ${c}`,
        borderRadius: 4,
        padding: `${s.padY}px ${s.padX}px`,
        letterSpacing: '0.18em',
        fontSize: s.fs,
        fontWeight: 700,
        opacity: 0.78,
        transform: `rotate(${rotate}deg)`,
        background: 'transparent',
        boxShadow: `inset 0 0 0 1px ${c}33`,
      }}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// TapedNote — a card with washi-tape corners, slight rotation
// ─────────────────────────────────────────────────────────────────
export function TapedNote({
  children,
  className,
  rotate = -1.5,
  tone = 'paper',
  tape = 'gold',
}: {
  children: React.ReactNode;
  className?: string;
  rotate?: number;
  tone?: 'paper' | 'cream' | 'aged';
  tape?: 'gold' | 'blue' | 'none';
}) {
  const bg = tone === 'cream' ? 'bg-paper-cream' : tone === 'aged' ? 'bg-paper-aged' : 'bg-paper';
  return (
    <div
      className={cn(
        'relative p-7 shadow-[0_14px_30px_-18px_rgba(26,20,16,0.5),0_3px_6px_-2px_rgba(26,20,16,0.18)]',
        bg,
        className,
      )}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {tape !== 'none' && (
        <>
          <span
            className={cn('tape', tape === 'blue' && 'tape-blue')}
            style={{ top: -10, left: 18, transform: 'rotate(-7deg)' }}
            aria-hidden
          />
          <span
            className={cn('tape', tape === 'blue' && 'tape-blue')}
            style={{ top: -10, right: 18, transform: 'rotate(6deg)' }}
            aria-hidden
          />
        </>
      )}
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Polaroid — taped photo card with caption
// ─────────────────────────────────────────────────────────────────
export function Polaroid({
  caption,
  rotate = -3,
  className,
  children,
}: {
  caption?: string;
  rotate?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'bg-paper-cream relative p-3 shadow-[0_18px_40px_-20px_rgba(26,20,16,0.55),0_4px_8px_-2px_rgba(26,20,16,0.18)]',
        className,
      )}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <span
        className="tape"
        style={{ top: -12, left: '50%', transform: 'translateX(-50%) rotate(-2deg)' }}
        aria-hidden
      />
      <div className="bg-paper-aged aspect-square overflow-hidden">{children}</div>
      {caption && (
        <div className="font-hand text-ink mt-3 px-1 pb-1 text-center text-2xl leading-none">
          {caption}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ScribbleArrow — wobbly arrow for marginal annotations
// ─────────────────────────────────────────────────────────────────
export function ScribbleArrow({
  className,
  direction = 'right',
}: {
  className?: string;
  direction?: 'right' | 'left' | 'down' | 'up' | 'down-right' | 'down-left';
}) {
  const map: Record<string, string> = {
    right: 'M6 30 C 50 18, 110 38, 170 26 M 152 14 L 174 26 L 156 40',
    left: 'M174 30 C 130 18, 70 38, 10 26 M 28 14 L 6 26 L 24 40',
    down: 'M30 6 C 18 50, 38 110, 26 170 M 14 152 L 26 174 L 40 156',
    up: 'M30 174 C 18 130, 38 70, 26 10 M 14 28 L 26 6 L 40 24',
    'down-right': 'M10 10 C 50 30, 90 50, 150 90 M 138 78 L 156 96 L 144 116',
    'down-left': 'M170 10 C 130 30, 90 50, 30 90 M 42 78 L 24 96 L 36 116',
  };
  return (
    <svg
      viewBox="0 0 180 180"
      className={cn('text-rust', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d={map[direction]} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// MarginNote — handwritten note in red ink
// ─────────────────────────────────────────────────────────────────
export function MarginNote({
  children,
  rotate = -4,
  color = 'rust',
  className,
  size = 'md',
}: {
  children: React.ReactNode;
  rotate?: number;
  color?: 'rust' | 'wash' | 'ink';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const colorMap = { rust: 'text-rust', wash: 'text-wash', ink: 'text-ink' };
  const sizeMap = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl' };
  return (
    <span
      className={cn(
        'font-hand inline-block leading-tight',
        colorMap[color],
        sizeMap[size],
        className,
      )}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Wordmark — hand-set masthead-style "Horus"
// ─────────────────────────────────────────────────────────────────
export function JournalWordmark({ className, sub }: { className?: string; sub?: boolean }) {
  return (
    <span className={cn('inline-flex flex-col items-start leading-none', className)}>
      <span className="font-display text-ink text-3xl font-medium tracking-tight">
        Horus<span className="text-rust">.</span>
      </span>
      {sub && <span className="font-hand text-rust mt-0.5 text-base">a field journal</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// PaperShell — full-screen warm paper background with grain + stains
// ─────────────────────────────────────────────────────────────────
export function PaperShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        'paper-bg paper-grain paper-stains relative isolate min-h-screen overflow-hidden',
        className,
      )}
    >
      {/* deckle-edge: a subtle inner shadow vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          boxShadow:
            'inset 0 0 120px rgba(94, 42, 20, 0.18), inset 0 0 40px rgba(26, 20, 16, 0.08)',
        }}
      />
      {children}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────
// SectionKicker — a kicker label for journal-style headers
// ─────────────────────────────────────────────────────────────────
export function Kicker({
  children,
  index,
  className,
}: {
  children: React.ReactNode;
  index?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-2xs text-rust flex items-center gap-3 font-mono uppercase tracking-[0.22em]',
        className,
      )}
    >
      {index && <span className="text-ink-faded">№ {index}</span>}
      <span className="bg-rust/60 h-px w-8" />
      <span className="font-semibold">{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// PaperButton — flat ink button (with optional rust fill)
// ─────────────────────────────────────────────────────────────────
export const PaperButton = React.forwardRef<
  HTMLAnchorElement | HTMLButtonElement,
  React.HTMLAttributes<HTMLElement> & {
    href?: string;
    variant?: 'fill' | 'outline' | 'link';
    size?: 'sm' | 'md' | 'lg';
    as?: 'a' | 'button';
    type?: 'submit' | 'button' | 'reset';
    disabled?: boolean;
  }
>(function PaperButton(
  { className, variant = 'fill', size = 'md', as = 'a', children, ...props },
  ref,
) {
  const sizes = {
    sm: 'px-4 py-2 text-sm',
    md: 'px-6 py-3 text-base',
    lg: 'px-8 py-4 text-lg',
  };
  const variants = {
    fill: 'bg-ink text-paper hover:bg-rust hover:text-paper-cream',
    outline: 'border-2 border-ink text-ink hover:border-rust hover:text-rust',
    link: 'text-rust underline-offset-4 hover:underline',
  };
  const Comp: any = as === 'button' ? 'button' : 'a';
  return (
    <Comp
      ref={ref as any}
      className={cn(
        'font-display inline-flex items-center justify-center font-medium tracking-tight transition-colors',
        sizes[size],
        variants[variant],
        className,
      )}
      {...(props as any)}
    >
      {children}
    </Comp>
  );
});
