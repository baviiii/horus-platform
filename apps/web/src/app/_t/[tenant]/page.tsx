import { getServerCaller } from '@/lib/trpc/server';

export default async function TenantOverview() {
  const trpc = await getServerCaller();
  const tenant = await trpc.tenant.current();
  const members = await trpc.tenant.members();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
        <p className="text-sm text-muted-foreground">Plan: {tenant.plan}</p>
      </div>

      <section className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-medium">Workspace members</h2>
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-3 text-sm">
              <span className="font-mono">{m.userId.slice(0, 8)}…</span>
              <span className="text-muted-foreground">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
