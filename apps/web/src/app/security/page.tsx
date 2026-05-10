import { Soon } from '@/components/horus/soon';

export const metadata = { title: 'Security · Horus' };

export default function SecurityPage() {
  return (
    <Soon
      eyebrow="Security"
      eta="2026.07"
      title={
        <>
          Defense, built into{' '}
          <span className="serif-italic text-ink-faded font-normal">the substrate.</span>
        </>
      }
      body="Tenant isolation at the database, queue, and storage layer. End-to-end encryption in transit and at rest. Append-only audit log with cryptographic chaining. SOC 2 Type II is in progress; the full security page lands with the auditor's report."
      cta={[
        { href: 'mailto:security@horus.ai', label: 'security@horus.ai' },
        { href: '/contact', label: 'Talk to us' },
      ]}
    />
  );
}
