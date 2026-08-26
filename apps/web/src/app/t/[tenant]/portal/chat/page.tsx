import { prisma } from '@horus/db';
import { PageHeader } from '@/components/app/shell';
import { requireTenantMember } from '@/lib/tenant-context';
import { PortalChatClient } from './portal-chat-client';

export const metadata = { title: 'Portal chat · Horus' };
export const dynamic = 'force-dynamic';

export default async function PortalChat({
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
  if (agentSlug && (!agent || agent.status !== 'ACTIVE')) {
    return (
      <div className="py-20 text-center">
        <p className="text-ink text-[15px] font-medium">Assistant unavailable.</p>
        <p className="text-ink-faded mt-1.5 text-[13px]">
          This link may have expired — head back to the portal to pick another.
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={agent ? agent.name : 'Chat'}
        title={agent ? `Talk to ${agent.name}.` : 'Ask anything.'}
        description={
          agent?.persona ?? "Grounded in the tenant's knowledge base. Citations appear inline."
        }
      />
      <PortalChatClient slug={slug} agent={agent?.slug ?? null} agentName={agent?.name ?? null} />
    </>
  );
}
