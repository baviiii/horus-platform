'use client';

import * as React from 'react';

type RevealVariant = 'rise' | 'fade' | 'left' | 'right' | 'scale';

export function Reveal({
  children,
  as: Tag = 'div',
  variant = 'rise',
  delay = 0,
  className,
  once = true,
  threshold = 0.18,
}: {
  children: React.ReactNode;
  as?: keyof React.JSX.IntrinsicElements;
  variant?: RevealVariant;
  delay?: number;
  className?: string;
  once?: boolean;
  threshold?: number;
}) {
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            if (once) io.unobserve(entry.target);
          } else if (!once) {
            entry.target.classList.remove('is-in');
          }
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [once, threshold]);

  return React.createElement(
    Tag,
    {
      ref,
      'data-reveal': variant === 'rise' ? '' : variant,
      className,
      style: delay ? { transitionDelay: `${delay}ms` } : undefined,
    } as React.HTMLAttributes<HTMLElement> & { ref: React.Ref<HTMLElement> },
    children,
  );
}

/* Word-by-word bloom — splits children string into spans */
export function WordBloom({
  text,
  className,
  stagger = 60,
  delay = 0,
}: {
  text: string;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const words = text.split(/(\s+)/);

  return (
    <span
      ref={ref}
      data-reveal-words
      className={className}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {words.map((w, i) => {
        if (/^\s+$/.test(w)) return <span key={i}>{w}</span>;
        return (
          <span
            key={i}
            className="word"
            style={{ ['--i' as string]: i, transitionDelay: `${delay + (i * stagger) / 2}ms` }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
}
