import { cn } from '@/lib/cn';

/**
 * The Horus mark — an aperture-star inside a thin orbital ring.
 * Reads as both a falcon's pupil and an astrolabe rose.
 */
export function HorusGlyph({
  className,
  size = 28,
  glow = false,
}: {
  className?: string;
  size?: number;
  glow?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn('text-gold', glow && 'drop-shadow-[0_0_18px_hsla(38,80%,60%,0.55)]', className)}
    >
      <circle
        cx="32"
        cy="32"
        r="29"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="0.75"
      />
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeOpacity="0.7" strokeWidth="0.5" />
      {/* 8-point compass star */}
      <path
        d="M32 6 L33 30 L57 32 L33 33 L32 57 L31 33 L7 32 L31 30 Z"
        fill="currentColor"
        fillOpacity="0.95"
      />
      {/* diagonals */}
      <path
        d="M14 14 L31 31 M50 14 L33 31 M50 50 L33 33 M14 50 L31 33"
        stroke="currentColor"
        strokeOpacity="0.6"
        strokeWidth="0.5"
      />
      {/* central pupil */}
      <circle
        cx="32"
        cy="32"
        r="2.4"
        fill="hsl(var(--bg-deep))"
        stroke="currentColor"
        strokeWidth="0.75"
      />
    </svg>
  );
}

export function HorusWordmark({
  className,
  variant = 'default',
}: {
  className?: string;
  variant?: 'default' | 'sm';
}) {
  const txtSize = variant === 'sm' ? 'text-base' : 'text-xl';
  const glyph = variant === 'sm' ? 18 : 24;
  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <HorusGlyph size={glyph} className="self-center" />
      <span className={cn('font-display text-parchment font-semibold tracking-[0.02em]', txtSize)}>
        Horus
      </span>
    </span>
  );
}
