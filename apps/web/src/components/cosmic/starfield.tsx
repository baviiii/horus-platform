import { cn } from '@/lib/cn';

/**
 * Three layers of stars at different parallax speeds + a few "named" stars
 * positioned absolutely. Pure CSS, no JS, no canvas.
 */
export function StarField({
  className,
  density = 'normal',
}: {
  className?: string;
  density?: 'normal' | 'dense' | 'sparse';
}) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {/* base star layer */}
      <div
        className={cn('absolute inset-0', density === 'dense' ? 'bg-stars-dense' : 'bg-stars')}
      />
      {/* drifting overlay */}
      <div className="bg-stars animate-drift absolute inset-0 opacity-60" />
      {/* twinkling lone stars */}
      <span className="bg-parchment/90 animate-twinkle absolute left-[12%] top-[18%] size-[3px] rounded-full" />
      <span className="bg-gold-bright animate-twinkle absolute left-[78%] top-[34%] size-[2px] rounded-full [animation-delay:0.6s]" />
      <span className="bg-parchment animate-twinkle absolute left-[42%] top-[68%] size-[2.5px] rounded-full [animation-delay:1.4s]" />
      <span className="bg-gold animate-twinkle absolute left-[88%] top-[80%] size-[2px] rounded-full [animation-delay:2.1s]" />
      <span className="bg-parchment-soft animate-twinkle-slow absolute left-[28%] top-[88%] size-[2px] rounded-full" />
      <span className="bg-gold/80 animate-twinkle-slow absolute left-[60%] top-[12%] size-[2px] rounded-full [animation-delay:1.2s]" />
      {/* one bright nova */}
      <span className="absolute left-[18%] top-[42%]">
        <span className="bg-gold-bright absolute inset-0 size-[6px] rounded-full shadow-[0_0_18px_4px_hsla(38,80%,65%,0.7)]" />
        <span className="bg-gold-bright/30 animate-pulse-ring absolute -inset-2 size-[22px] rounded-full" />
      </span>
    </div>
  );
}
