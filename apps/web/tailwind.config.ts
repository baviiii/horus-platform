import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1.5rem', md: '2rem', xl: '2.5rem' },
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        // shadcn-style semantic
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          bright: 'hsl(var(--accent-bright))',
          deep: 'hsl(var(--accent-deep))',
          glow: 'hsl(var(--accent-glow))',
          soft: 'hsl(var(--accent-soft))',
          tint: 'hsl(var(--accent-tint))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Horus surfaces
        paper: {
          DEFAULT: 'hsl(var(--paper))',
          soft: 'hsl(var(--paper-soft))',
          deep: 'hsl(var(--paper-deeper))',
        },
        ink: {
          DEFAULT: 'hsl(var(--ink))',
          soft: 'hsl(var(--ink-soft))',
          faded: 'hsl(var(--ink-faded))',
          mute: 'hsl(var(--ink-mute))',
        },
        hairline: {
          DEFAULT: 'hsl(var(--hairline))',
          strong: 'hsl(var(--hairline-strong))',
        },
      },
      borderRadius: {
        none: '0',
        xs: '4px',
        sm: 'calc(var(--radius) - 4px)',
        DEFAULT: 'var(--radius)',
        md: 'calc(var(--radius) + 2px)',
        lg: 'calc(var(--radius) + 6px)',
        xl: 'calc(var(--radius) + 12px)',
        '2xl': 'calc(var(--radius) + 18px)',
        '3xl': 'calc(var(--radius) + 28px)',
      },
      fontFamily: {
        sans: [
          'var(--font-sans)',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        technical: ['var(--font-technical)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
        xs: ['0.75rem', { lineHeight: '1.1rem', letterSpacing: '0.01em' }],
        sm: ['0.875rem', { lineHeight: '1.35rem' }],
        base: ['1rem', { lineHeight: '1.55rem' }],
        lg: ['1.125rem', { lineHeight: '1.7rem' }],
        xl: ['1.3125rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.018em' }],
        '3xl': ['2rem', { lineHeight: '2.4rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.75rem', { lineHeight: '3rem', letterSpacing: '-0.025em' }],
        '5xl': ['3.5rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        '6xl': ['4.5rem', { lineHeight: '1.02', letterSpacing: '-0.035em' }],
        '7xl': ['5.75rem', { lineHeight: '0.98', letterSpacing: '-0.04em' }],
        '8xl': ['7.5rem', { lineHeight: '0.94', letterSpacing: '-0.045em' }],
        '9xl': ['9.5rem', { lineHeight: '0.9', letterSpacing: '-0.05em' }],
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        blue: 'var(--shadow-blue)',
        'blue-lg': 'var(--shadow-blue-lg)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        rise: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 800ms ease-out both',
        rise: 'rise 800ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
      typography: () => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': 'hsl(var(--ink-soft))',
            '--tw-prose-headings': 'hsl(var(--ink))',
            '--tw-prose-links': 'hsl(var(--accent))',
            '--tw-prose-bold': 'hsl(var(--ink))',
            '--tw-prose-quotes': 'hsl(var(--ink))',
            '--tw-prose-quote-borders': 'hsl(var(--hairline-strong))',
            '--tw-prose-code': 'hsl(var(--ink))',
            '--tw-prose-hr': 'hsl(var(--hairline))',
          },
        },
      }),
    },
  },
  plugins: [animate, typography],
};

export default config;
