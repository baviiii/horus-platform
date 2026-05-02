import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { prisma } from '@horus/db';

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant || !tenant.isActive) notFound();

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/_t/${slug}`)}`);

  const member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
  });
  if (!member) redirect('/');

  const branding = (tenant.config as { branding?: { name?: string; primaryColor?: string } } | null)
    ?.branding ?? {};

  return (
    <div
      className="min-h-screen"
      style={
        branding.primaryColor
          ? ({ '--primary': hexToHsl(branding.primaryColor) } as React.CSSProperties)
          : undefined
      }
    >
      <header className="border-b">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-2 font-medium">
            <span className="font-mono text-sm text-muted-foreground">{branding.name ?? tenant.name}</span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <a href={`/_t/${slug}`}>Overview</a>
            <a href={`/_t/${slug}/documents`}>Documents</a>
            <a href={`/_t/${slug}/chat`}>Chat</a>
            <a href={`/_t/${slug}/graph`}>Graph</a>
            <a href={`/_t/${slug}/settings`}>Settings</a>
          </nav>
        </div>
      </header>
      <main className="container py-8">{children}</main>
    </div>
  );
}

function hexToHsl(hex: string): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
