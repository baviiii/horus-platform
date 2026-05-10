import { Soon } from '@/components/horus/soon';

export const metadata = { title: 'Contact · Horus' };

export default function ContactPage() {
  return (
    <Soon
      eyebrow="Contact"
      eta="Open now"
      title={
        <>
          Talk to a human, <span className="serif-italic text-ink-faded font-normal">today.</span>
        </>
      }
      body="The proper contact form ships with the public launch. In the meantime, founders and design partners can reach the team directly at hello@horus.ai — every message is read by a human within one working day."
      cta={[
        { href: 'mailto:hello@horus.ai', label: 'hello@horus.ai' },
        { href: '/signup', label: 'Or just start free' },
      ]}
    />
  );
}
