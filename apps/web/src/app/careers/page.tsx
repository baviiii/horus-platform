import { Soon } from '@/components/horus/soon';

export const metadata = { title: 'Careers · Horus' };

export default function CareersPage() {
  return (
    <Soon
      eyebrow="Careers"
      eta="Rolling · 2026"
      title={
        <>
          Hiring people who{' '}
          <span className="serif-italic text-ink-faded font-normal">build the whole thing.</span>
        </>
      }
      body="We hire generalists who can hold the entire stack in their head, and specialists who can go deep on retrieval, graph, agentic systems, and design. Open roles are being scoped — write to careers@horus.ai with a sketch of what you'd build."
      cta={[
        { href: 'mailto:careers@horus.ai', label: 'Email careers@horus.ai' },
        { href: '/', label: 'Back home' },
      ]}
    />
  );
}
