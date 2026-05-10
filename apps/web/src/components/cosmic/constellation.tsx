import { cn } from '@/lib/cn';

/**
 * Decorative constellation diagrams for hero / page accents.
 * Each is a scalable SVG with thin gold strokes + small star nodes.
 */
export function ConstellationFalcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 360"
      className={cn('text-gold/70', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="star-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* hairline lattice underlay */}
      <g stroke="currentColor" strokeWidth="0.4" strokeOpacity="0.18">
        <path d="M0 90 L480 90 M0 180 L480 180 M0 270 L480 270" />
        <path d="M120 0 L120 360 M240 0 L240 360 M360 0 L360 360" />
      </g>
      {/* falcon-shaped path of stars */}
      <g stroke="currentColor" strokeOpacity="0.85" strokeWidth="0.85" strokeLinecap="round">
        <path d="M60 240 L120 200 L180 170 L260 150 L330 130 L400 90" />
        <path d="M180 170 L210 220 L260 250 L300 270" />
        <path d="M260 150 L280 110 L330 130" />
        <path d="M260 250 L240 300" />
        <path d="M260 250 L320 290" />
        <path d="M120 200 L80 170" />
      </g>
      {/* star nodes — sized + glowing */}
      {[
        [60, 240, 3.5],
        [120, 200, 2.5],
        [180, 170, 4],
        [260, 150, 5],
        [330, 130, 3.2],
        [400, 90, 4.2],
        [210, 220, 2],
        [260, 250, 3],
        [300, 270, 2.5],
        [280, 110, 2.6],
        [240, 300, 2.2],
        [320, 290, 2.4],
        [80, 170, 2],
      ].map(([x, y, r], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={(r as number) * 3} fill="url(#star-glow)" />
          <circle cx={x} cy={y} r={r} fill="currentColor" />
        </g>
      ))}
      {/* labelled coords */}
      <g
        fontFamily="var(--font-mono)"
        fontSize="7"
        fill="currentColor"
        fillOpacity="0.55"
        letterSpacing="0.08em"
      >
        <text x={266} y={144}>
          α HOR · 02°41′
        </text>
        <text x={186} y={164}>
          β HOR · 47°22′
        </text>
        <text x={406} y={88}>
          γ HOR
        </text>
        <text x={66} y={234}>
          δ HOR
        </text>
      </g>
    </svg>
  );
}

export function ConstellationOrbit({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      className={cn('text-gold/55', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="0.5">
        <ellipse cx="200" cy="200" rx="180" ry="80" strokeOpacity="0.4" />
        <ellipse cx="200" cy="200" rx="160" ry="160" strokeOpacity="0.3" />
        <ellipse
          cx="200"
          cy="200"
          rx="80"
          ry="180"
          strokeOpacity="0.4"
          transform="rotate(30 200 200)"
        />
      </g>
      <circle cx="200" cy="200" r="6" fill="currentColor" />
      <circle cx="380" cy="200" r="3" fill="currentColor" fillOpacity="0.9" />
      <circle cx="40" cy="240" r="2.5" fill="currentColor" fillOpacity="0.7" />
      <circle cx="312" cy="86" r="3" fill="currentColor" fillOpacity="0.8" />
      <text
        x={200}
        y={210}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="6"
        fill="hsl(var(--bg-deep))"
      >
        ☉
      </text>
    </svg>
  );
}

export function ConstellationLines({
  className,
  variant = 'a',
}: {
  className?: string;
  variant?: 'a' | 'b' | 'c';
}) {
  if (variant === 'b') {
    return (
      <svg
        viewBox="0 0 600 200"
        className={cn('text-gold/45', className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <g stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" strokeOpacity="0.7">
          <path d="M40 140 L120 80 L220 100 L320 50 L420 90 L520 60" />
          <path d="M120 80 L160 30" />
          <path d="M320 50 L380 20" />
          <path d="M220 100 L240 160" />
        </g>
        {[
          [40, 140, 2.5],
          [120, 80, 3.5],
          [220, 100, 2.8],
          [320, 50, 4],
          [420, 90, 2.5],
          [520, 60, 3],
          [160, 30, 2],
          [380, 20, 2.2],
          [240, 160, 2],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="currentColor" />
        ))}
      </svg>
    );
  }
  if (variant === 'c') {
    return (
      <svg
        viewBox="0 0 200 200"
        className={cn('text-gold/55', className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <g stroke="currentColor" strokeWidth="0.5" strokeOpacity="0.6">
          <path d="M30 60 L80 100 L70 160 M80 100 L150 80 L170 140 M150 80 L130 30" />
        </g>
        {[
          [30, 60, 2.5],
          [80, 100, 3.5],
          [70, 160, 2.5],
          [150, 80, 3.2],
          [170, 140, 2.6],
          [130, 30, 2.2],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="currentColor" />
        ))}
      </svg>
    );
  }
  return <ConstellationFalcon className={className} />;
}
