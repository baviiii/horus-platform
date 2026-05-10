import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const fontSans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const fontSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const fontTechnical = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-technical',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Horus — The intelligence layer.', template: '%s · Horus' },
  description:
    'A single, unified API for retrieval, reasoning, and knowledge graphs. Multi-tenant, white-label, production-grade.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'Horus — The intelligence layer.',
    description: 'A single, unified API for retrieval, reasoning, and knowledge graphs.',
    type: 'website',
  },
  robots: {
    index: process.env.NODE_ENV === 'production',
    follow: process.env.NODE_ENV === 'production',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} ${fontSerif.variable} ${fontTechnical.variable}`}
    >
      <body className="bg-paper text-ink min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
