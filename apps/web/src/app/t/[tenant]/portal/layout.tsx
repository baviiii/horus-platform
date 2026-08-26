import { requireTenantMember } from '@/lib/tenant-context';

/**
 * End-user portal layout — intentionally bare. The staff shell (sidebar nav,
 * workspace context) is replaced with a minimal chrome: this is the surface
 * the tenant's *customers* see, not the tenant's operators.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  await requireTenantMember(slug); // still tenant-gated; public embed comes next phase

  return (
    <div className="bg-canvas min-h-screen">
      <header className="border-hairline bg-paper/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3.5">
          <div className="text-ink text-[13.5px] font-semibold">Customer portal</div>
          <a href={`/t/${slug}`} className="text-ink-faded text-[12px] hover:underline">
            ← back to workspace
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
    </div>
  );
}
