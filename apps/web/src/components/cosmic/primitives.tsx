import * as React from 'react';
import { cn } from '@/lib/cn';

// ─────────────────────────────────────────────────────────────────
// SectionLabel — small caps editorial label with hairline + index
// ─────────────────────────────────────────────────────────────────
export function SectionLabel({
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
        'text-2xs text-gold flex items-center gap-3 font-mono uppercase tracking-[0.22em]',
        className,
      )}
    >
      {index && <span className="text-parchment-soft/60">{index}</span>}
      <span className="hairline-fade-x w-10" />
      <span className="font-medium">{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Coord — observatory-style coordinate stamp
// ─────────────────────────────────────────────────────────────────
export function Coord({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-parchment-soft/60 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em]',
        className,
      )}
    >
      <span className="bg-gold/70 size-1 rounded-full" />
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Panel — glass card with hairline border + grain
// ─────────────────────────────────────────────────────────────────
export const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { tone?: 'default' | 'elev' | 'flat' }
>(({ className, tone = 'default', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'bg-grain relative overflow-hidden',
      tone === 'flat' && 'border-hairline bg-card/40 border',
      tone === 'default' && 'panel rounded-sm',
      tone === 'elev' && 'panel-elev rounded-sm',
      className,
    )}
    {...props}
  />
));
Panel.displayName = 'Panel';

// ─────────────────────────────────────────────────────────────────
// CornerMarks — corner crop marks (printer's marks aesthetic)
// ─────────────────────────────────────────────────────────────────
export function CornerMarks({ className }: { className?: string }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'border-gold/60 pointer-events-none absolute left-1.5 top-1.5 size-3 border-l border-t',
          className,
        )}
      />
      <span
        aria-hidden
        className="border-gold/60 pointer-events-none absolute right-1.5 top-1.5 size-3 border-r border-t"
      />
      <span
        aria-hidden
        className="border-gold/60 pointer-events-none absolute bottom-1.5 left-1.5 size-3 border-b border-l"
      />
      <span
        aria-hidden
        className="border-gold/60 pointer-events-none absolute bottom-1.5 right-1.5 size-3 border-b border-r"
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Pill — small status pill / badge
// ─────────────────────────────────────────────────────────────────
export function Pill({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'gold' | 'azure' | 'destructive' | 'success';
  className?: string;
}) {
  const map = {
    default: 'bg-midnight-elev/80 text-parchment-soft border-hairline-bright/40',
    gold: 'bg-gold/15 text-gold-bright border-gold/30',
    azure: 'bg-azure/12 text-azure border-azure/30',
    destructive: 'bg-oxblood/40 text-parchment border-oxblood/60',
    success: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em]',
        map[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// MetricRing — concentric rings with central metric (astrolabe vibe)
// ─────────────────────────────────────────────────────────────────
export function MetricRing({
  value,
  label,
  unit,
  size = 132,
  progress = 0.62,
  className,
}: {
  value: string | number;
  label: string;
  unit?: string;
  size?: number;
  progress?: number;
  className?: string;
}) {
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className={cn('relative grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--hairline))"
          strokeOpacity="0.55"
          strokeWidth="0.75"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - 6}
          fill="none"
          stroke="hsl(var(--hairline))"
          strokeOpacity="0.3"
          strokeWidth="0.5"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--gold))"
          strokeOpacity="0.85"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={`${circumference * progress} ${circumference}`}
        />
      </svg>
      {/* tick marks */}
      <svg width={size} height={size} className="absolute inset-0" aria-hidden="true">
        {Array.from({ length: 36 }).map((_, i) => {
          const angle = (i * 360) / 36;
          const isMajor = i % 3 === 0;
          return (
            <line
              key={i}
              x1={size / 2}
              y1={isMajor ? 4 : 6}
              x2={size / 2}
              y2={isMajor ? 10 : 8}
              stroke="hsl(var(--gold))"
              strokeOpacity={isMajor ? 0.7 : 0.3}
              strokeWidth="0.6"
              transform={`rotate(${angle} ${size / 2} ${size / 2})`}
            />
          );
        })}
      </svg>
      <div className="text-center">
        <div className="font-display text-leaf num text-3xl font-light leading-none">{value}</div>
        {unit && (
          <div className="text-parchment-soft/55 mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em]">
            {unit}
          </div>
        )}
        <div className="text-parchment-soft/70 mt-1 max-w-[90px] font-mono text-[10px] uppercase tracking-[0.18em]">
          {label}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Field — themed input
// ─────────────────────────────────────────────────────────────────
export const Field = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }
>(({ className, label, hint, id, ...props }, ref) => {
  const inputId = id ?? React.useId();
  return (
    <label className="block space-y-2" htmlFor={inputId}>
      {label && (
        <span className="text-parchment-soft/70 block font-mono text-[10px] uppercase tracking-[0.22em]">
          {label}
        </span>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'border-hairline font-body text-parchment placeholder:text-parchment-soft/40 block w-full border-b bg-transparent px-0 py-2 text-base',
          'focus:border-gold transition-colors focus:outline-none',
          className,
        )}
        {...props}
      />
      {hint && <span className="text-parchment-soft/55 block text-[11px]">{hint}</span>}
    </label>
  );
});
Field.displayName = 'Field';

// ─────────────────────────────────────────────────────────────────
// SparkLine — micro chart in mono style
// ─────────────────────────────────────────────────────────────────
export function SparkLine({
  data,
  className,
  height = 32,
  width = 120,
}: {
  data: number[];
  className?: string;
  height?: number;
  width?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / Math.max(data.length - 1, 1);
  const points = data
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('text-gold', className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.85"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// Divider — astronomical horizon line with central glyph
// ─────────────────────────────────────────────────────────────────
export function HorizonRule({ children }: { children?: React.ReactNode }) {
  return (
    <div className="text-parchment-soft/55 flex items-center gap-4">
      <span className="hairline-fade-x flex-1" />
      {children ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.32em]">{children}</span>
      ) : (
        <span className="text-gold">✦</span>
      )}
      <span className="hairline-fade-x flex-1" />
    </div>
  );
}
