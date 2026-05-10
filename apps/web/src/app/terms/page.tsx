import { Soon } from '@/components/horus/soon';

export const metadata = { title: 'Terms · Horus' };

export default function TermsPage() {
  return (
    <Soon
      eyebrow="Terms"
      eta="2026.06"
      title={
        <>
          The contract,{' '}
          <span className="serif-italic text-ink-faded font-normal">in plain words.</span>
        </>
      }
      body="MSA, AUP, and DPA are being finalized for SOC 2 Type II readiness. Design partners operate under a short-form letter agreement until the public terms ship."
      cta={[{ href: '/contact', label: 'Talk to legal' }]}
    />
  );
}
