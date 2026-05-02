import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { prisma } from '@horus/db';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/admin');

  // Platform admins are owners of the `platform` tenant.
  const platform = await prisma.tenant.findUnique({ where: { slug: 'platform' } });
  if (!platform) redirect('/');

  const member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId: platform.id, userId: user.id } },
  });

  if (!member || member.role !== 'OWNER') redirect('/');

  return (
    <div className="container py-8">
      <header className="mb-8 flex items-center justify-between border-b pb-4">
        <h1 className="text-xl font-semibold">Horus Platform Admin</h1>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <a href="/admin">Overview</a>
          <a href="/admin/tenants">Tenants</a>
          <a href="/admin/usage">Usage</a>
          <a href="/admin/audit">Audit</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
