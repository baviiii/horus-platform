import { Soon } from '@/components/horus/soon';

export const metadata = { title: 'About · Horus' };

export default function AboutPage() {
  return (
    <Soon
      eyebrow="About"
      eta="2026.06"
      title={
        <>
          Built by people who{' '}
          <span className="serif-italic text-ink-faded font-normal">read everything.</span>
        </>
      }
      body="We're writing the about page properly — who's building Horus, why we believe an intelligence layer belongs in the substrate of every product, and how the platform is funded and governed."
      cta={[
        { href: '/contact', label: 'Get in touch' },
        { href: '/', label: 'Back home' },
      ]}
    />
  );
}
