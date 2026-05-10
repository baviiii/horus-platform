import { Soon } from '@/components/horus/soon';

export const metadata = { title: 'Privacy · Horus' };

export default function PrivacyPage() {
  return (
    <Soon
      eyebrow="Privacy"
      eta="2026.05"
      title={
        <>
          What we keep,{' '}
          <span className="serif-italic text-ink-faded font-normal">what we don't.</span>
        </>
      }
      body="The full plain-English privacy policy is being reviewed by counsel. Short version: tenant data is isolated per workspace, never used to train shared models, and exportable or deletable on request within 30 days."
      cta={[{ href: '/contact', label: 'Questions? Ask the team' }]}
    />
  );
}
