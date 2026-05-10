import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium tracking-[-0.005em]',
    'rounded-full transition-[background,color,box-shadow,transform] duration-200 ease-out',
    'focus-visible:ring-accent focus-visible:ring-offset-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        // Primary — solid ink, the Apple "buy now" affordance
        default: 'bg-ink text-paper hover:bg-ink-soft shadow-sm active:scale-[0.98]',
        // Accent — Horus blue, used sparingly
        accent: 'bg-accent hover:bg-accent-bright text-white shadow-sm active:scale-[0.98]',
        // Outline — hairline pill
        outline:
          'border-hairline-strong bg-paper text-ink hover:border-ink/40 hover:bg-paper-soft border active:scale-[0.98]',
        // Ghost — used in nav
        ghost: 'text-ink-soft hover:text-ink hover:bg-paper-soft',
        // Subtle — light fill
        subtle: 'bg-paper-soft text-ink hover:bg-paper-deep active:scale-[0.98]',
        // Link — Apple-style underlined chevron link
        link: 'text-accent rounded-none px-0 decoration-1 underline-offset-4 hover:underline',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        secondary:
          'bg-paper-soft text-ink border-hairline hover:bg-paper-deep border active:scale-[0.98]',
      },
      size: {
        sm: 'h-8 px-4 text-[13px]',
        default: 'h-10 px-5 text-sm',
        lg: 'h-12 px-7 text-[15px]',
        xl: 'h-14 px-8 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props}>
        {children}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
