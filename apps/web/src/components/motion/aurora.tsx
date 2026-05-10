'use client';

import * as React from 'react';

/**
 * Cursor-tracking blue aurora. Wrap a section in this to make the
 * background subtly track the user. RAF-throttled for 60fps.
 */
export function Aurora({
  children,
  className = '',
  intensity = 1,
}: {
  children?: React.ReactNode;
  className?: string;
  intensity?: number;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const targetRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    const target = targetRef.current;
    if (!wrap || !target) return;

    let raf = 0;
    let pendingX = 50;
    let pendingY = 30;
    let currentX = 50;
    let currentY = 30;

    const update = () => {
      // Lerp toward pending — smoother than raw mouse
      currentX += (pendingX - currentX) * 0.12;
      currentY += (pendingY - currentY) * 0.12;
      target.style.setProperty('--mx', `${currentX}%`);
      target.style.setProperty('--my', `${currentY}%`);
      if (Math.abs(pendingX - currentX) > 0.05 || Math.abs(pendingY - currentY) > 0.05) {
        raf = requestAnimationFrame(update);
      } else {
        raf = 0;
      }
    };

    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      pendingX = ((e.clientX - rect.left) / rect.width) * 100;
      pendingY = ((e.clientY - rect.top) / rect.height) * 100;
      if (!raf) raf = requestAnimationFrame(update);
    };

    wrap.addEventListener('pointermove', onMove);
    return () => {
      wrap.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div ref={targetRef} aria-hidden className="aurora" style={{ opacity: intensity }} />
      {children}
    </div>
  );
}
