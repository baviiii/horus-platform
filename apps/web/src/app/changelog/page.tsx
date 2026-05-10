import { Soon } from '@/components/horus/soon';

export const metadata = { title: 'Changelog · Horus' };

export default function ChangelogPage() {
  return (
    <Soon
      eyebrow="Changelog"
      eta="2026.05"
      title={
        <>
          Every change,{' '}
          <span className="serif-italic text-ink-faded font-normal">timestamped.</span>
        </>
      }
      body="An append-only log of every release, deprecation, and migration — built from the same audit substrate that runs the product. The formatter is in flight; the data already exists."
      cta={[{ href: '/', label: 'Back home' }]}
    />
  );
}
