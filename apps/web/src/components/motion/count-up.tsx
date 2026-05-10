'use client';

import * as React from 'react';

/**
 * Counts up from 0 to `to` once it enters the viewport.
 * Apple uses these on its environmental-impact pages.
 */
export function CountUp({
  to,
  duration = 1600,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: {
  to: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [value, setValue] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let started = false;

    const run = (start: number) => {
      const tick = (t: number) => {
        const elapsed = t - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out-quint
        const eased = 1 - Math.pow(1 - progress, 5);
        setValue(eased * to);
        if (progress < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started) {
            started = true;
            run(performance.now());
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.4 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
