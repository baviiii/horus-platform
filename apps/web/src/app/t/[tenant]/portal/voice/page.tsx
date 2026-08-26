import { prisma } from '@horus/db';
import { PageHeader, Panel, Pill } from '@/components/app/shell';
import { requireTenantMember } from '@/lib/tenant-context';

export const metadata = { title: 'Portal voice · Horus' };
export const dynamic = 'force-dynamic';

export default async function PortalVoice({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ agent?: string }>;
}) {
  const { tenant: slug } = await params;
  const { agent: agentSlug } = await searchParams;
  const { tenant } = await requireTenantMember(slug);

  const agent = agentSlug
    ? await prisma.agent.findUnique({
        where: { tenantId_slug: { tenantId: tenant.id, slug: agentSlug } },
      })
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Voice"
        title={agent ? `Talk to ${agent.name}.` : 'Voice assistants.'}
        description="Voice runs over WebRTC once a voice provider connection is configured for this agent."
      />
      <Panel title="Voice surface">
        <div className="py-12 text-center">
          <Pill tone="warn">coming next</Pill>
          <p className="text-ink mt-3 text-[15px] font-medium">
            Voice is configured per agent, then switched on.
          </p>
          <p className="text-ink-faded mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed">
            When the tenant connects a voice provider (LiveKit / Vapi / Azure Voice Live) and sets
            this agent's <code className="text-ink text-[12px]">voiceConfig</code>, the microphone
            appears here. Until then, use chat.
          </p>
        </div>
      </Panel>
    </>
  );
}
