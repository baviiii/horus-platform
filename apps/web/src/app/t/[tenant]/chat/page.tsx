import { prisma } from '@horus/db';
import { PageHeader } from '@/components/app/shell';
import { Reveal } from '@/components/motion';
import { requireTenantMember } from '@/lib/tenant-context';
import { TenantChatClient } from './chat-client';

export const metadata = { title: 'Chat · Horus' };
export const dynamic = 'force-dynamic';

export default async function ChatPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await requireTenantMember(slug);

  const sessions = await prisma.chatSession.findMany({
    where: { tenantId: tenant.id },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: { _count: { select: { messages: true } } },
  });

  return (
    <>
      <PageHeader
        eyebrow="Chat"
        title="The workspace agent."
        description="Grounded in this workspace's knowledge, with its connected tool servers attached. Every conversation is saved here."
      />
      <Reveal as="div">
        <TenantChatClient
          slug={slug}
          initialSessions={sessions.map((s) => ({
            id: s.id,
            title: s.title ?? 'Untitled conversation',
            updatedAt: s.updatedAt.toISOString(),
            msgs: s._count.messages,
          }))}
        />
      </Reveal>
    </>
  );
}
