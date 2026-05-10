import { cn } from '@/lib/cn';

/**
 * DuneHorizon — silhouetted layered dune ridges for the bottom of hero sections.
 * Renders an SVG that fades into the page background. Stacks three ridges of
 * decreasing opacity, with a faint terracotta haze rising from the ridgeline.
 */
export function DuneHorizon({
  className,
  variant = 'wide',
}: {
  className?: string;
  variant?: 'wide' | 'compact' | 'arc';
}) {
  if (variant === 'compact') {
    return (
      <svg
        viewBox="0 0 1200 240"
        preserveAspectRatio="none"
        className={cn('block w-full', className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="dune-c-1" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--ember))" stopOpacity="0.5" />
            <stop offset="100%" stopColor="hsl(var(--dune))" stopOpacity="1" />
          </linearGradient>
          <linearGradient id="dune-c-2" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--sienna))" stopOpacity="0.7" />
            <stop offset="100%" stopColor="hsl(var(--bg-deep))" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          d="M0 140 C 220 70, 460 130, 640 100 C 820 70, 980 140, 1200 90 L 1200 240 L 0 240 Z"
          fill="url(#dune-c-1)"
          opacity="0.55"
        />
        <path
          d="M0 180 C 240 130, 480 200, 700 160 C 920 120, 1080 200, 1200 170 L 1200 240 L 0 240 Z"
          fill="url(#dune-c-2)"
        />
      </svg>
    );
  }

  if (variant === 'arc') {
    return (
      <svg
        viewBox="0 0 800 400"
        className={cn('block', className)}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="arc-glow" cx="50%" cy="100%" r="80%">
            <stop offset="0%" stopColor="hsl(var(--ember))" stopOpacity="0.45" />
            <stop offset="60%" stopColor="hsl(var(--sienna))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--bg-deep))" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="arc-dune" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--dune-edge))" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(var(--bg-deep))" stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* horizon glow */}
        <circle cx="400" cy="400" r="380" fill="url(#arc-glow)" />
        {/* background dunes */}
        <path
          d="M0 320 C 180 260, 360 320, 540 280 C 660 250, 740 290, 800 270 L 800 400 L 0 400 Z"
          fill="hsl(var(--dune-edge))"
          opacity="0.55"
        />
        {/* foreground dune */}
        <path
          d="M0 360 C 200 300, 380 360, 560 330 C 700 310, 760 350, 800 340 L 800 400 L 0 400 Z"
          fill="url(#arc-dune)"
        />
        {/* a few sand grains catching light */}
        <g fill="hsl(var(--sand))" fillOpacity="0.65">
          <circle cx="160" cy="358" r="0.8" />
          <circle cx="280" cy="332" r="0.9" />
          <circle cx="430" cy="350" r="0.7" />
          <circle cx="610" cy="348" r="1" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 1600 360"
      preserveAspectRatio="none"
      className={cn('block w-full', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="dune-1" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--ember))" stopOpacity="0.45" />
          <stop offset="40%" stopColor="hsl(var(--sienna))" stopOpacity="0.55" />
          <stop offset="100%" stopColor="hsl(var(--dune))" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="dune-2" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--sienna))" stopOpacity="0.6" />
          <stop offset="100%" stopColor="hsl(var(--bg-deep))" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="dune-3" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--dune-edge))" stopOpacity="1" />
          <stop offset="100%" stopColor="hsl(var(--bg-deep))" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="haze" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--ember))" stopOpacity="0" />
          <stop offset="60%" stopColor="hsl(var(--ember))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="hsl(var(--ember))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* warm haze rising from ridgeline */}
      <rect x="0" y="40" width="1600" height="180" fill="url(#haze)" />
      {/* far ridge */}
      <path
        d="M0 200 C 220 130, 420 190, 620 160 C 820 130, 1040 200, 1240 170 C 1400 150, 1500 200, 1600 180 L 1600 360 L 0 360 Z"
        fill="url(#dune-1)"
        opacity="0.55"
      />
      {/* mid ridge */}
      <path
        d="M0 250 C 200 180, 440 250, 660 220 C 880 200, 1080 270, 1280 240 C 1440 220, 1540 260, 1600 240 L 1600 360 L 0 360 Z"
        fill="url(#dune-2)"
      />
      {/* near ridge */}
      <path
        d="M0 300 C 240 240, 520 320, 760 280 C 980 250, 1180 320, 1380 300 C 1500 290, 1560 310, 1600 300 L 1600 360 L 0 360 Z"
        fill="url(#dune-3)"
      />
      {/* sand grains catching the moonlight */}
      <g fill="hsl(var(--sand))">
        <circle cx="180" cy="248" r="0.9" opacity="0.75" />
        <circle cx="340" cy="232" r="0.7" opacity="0.6" />
        <circle cx="520" cy="266" r="0.8" opacity="0.7" />
        <circle cx="780" cy="248" r="1" opacity="0.85" />
        <circle cx="940" cy="282" r="0.8" opacity="0.7" />
        <circle cx="1180" cy="270" r="0.9" opacity="0.75" />
        <circle cx="1380" cy="296" r="0.7" opacity="0.65" />
      </g>
    </svg>
  );
}

/**
 * Compass — a small bearing rosette in copper. Sits next to coords like a
 * navigator's stamp.
 */
export function CompassRose({ className, size = 56 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={cn('text-gold/85', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="44" stroke="currentColor" strokeOpacity="0.55" strokeWidth="0.6" />
      <circle
        cx="50"
        cy="50"
        r="34"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="0.4"
        strokeDasharray="2 3"
      />
      {/* cardinals */}
      <g stroke="currentColor" strokeWidth="0.6">
        <line x1="50" y1="6" x2="50" y2="94" strokeOpacity="0.6" />
        <line x1="6" y1="50" x2="94" y2="50" strokeOpacity="0.4" />
      </g>
      {/* arrow */}
      <path d="M50 12 L56 50 L50 46 L44 50 Z" fill="hsl(var(--ember))" fillOpacity="0.95" />
      <path d="M50 88 L56 50 L50 54 L44 50 Z" fill="currentColor" fillOpacity="0.4" />
      {/* labels */}
      <g
        fontFamily="var(--font-mono)"
        fontSize="6"
        fill="currentColor"
        fillOpacity="0.7"
        textAnchor="middle"
      >
        <text x="50" y="5">
          N
        </text>
        <text x="50" y="98">
          S
        </text>
        <text x="3" y="52">
          W
        </text>
        <text x="97" y="52">
          E
        </text>
      </g>
      <circle cx="50" cy="50" r="2" fill="hsl(var(--ember))" />
    </svg>
  );
}
