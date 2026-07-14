import { AppShell, type NavGroup } from '@/components/app/shell';
import { prisma } from '@horus/db';
import { requireTenantMember } from '@/lib/tenant-context';

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const { tenant, user } = await requireTenantMember(slug);

  const branding = ((tenant.config as Record<string, unknown>)?.branding ?? {}) as {
    name?: string;
  };
  const tenantName = branding.name || tenant.name;

  const openAlerts = await prisma.alert.count({
    where: { tenantId: tenant.id, status: 'OPEN' },
  });

  const groups: NavGroup[] = [
    {
      items: [
        { href: `/t/${slug}`, label: 'Overview', icon: <IconHome /> },
        { href: `/t/${slug}/chat`, label: 'Chat', icon: <IconChat /> },
        { href: `/t/${slug}/documents`, label: 'Documents', icon: <IconDoc /> },
        { href: `/t/${slug}/graph`, label: 'Knowledge graph', icon: <IconGraph /> },
        { href: `/t/${slug}/connections`, label: 'Connections', icon: <IconPlug /> },
        {
          href: `/t/${slug}/alerts`,
          label: 'Alerts',
          icon: <IconBell />,
          ...(openAlerts > 0 && { badge: String(openAlerts) }),
        },
      ],
    },
    {
      title: 'Workspace',
      items: [
        { href: `/t/${slug}/settings`, label: 'Settings', icon: <IconCog /> },
        { href: `/t/${slug}/settings/members`, label: 'Members', icon: <IconPeople /> },
        { href: `/t/${slug}/settings/keys`, label: 'API keys', icon: <IconKey /> },
        { href: `/t/${slug}/settings/billing`, label: 'Billing', icon: <IconBill /> },
      ],
    },
  ];

  return (
    <AppShell
      brand={{ name: tenantName, href: `/t/${slug}`, tag: tenant.plan }}
      groups={groups}
      user={{
        name: user.displayName,
        email: user.email,
        initials: user.initials,
      }}
      context={
        <nav className="text-ink-faded flex items-center gap-1.5 text-[13px]">
          <span className="text-ink-mute">Workspace</span>
          <span className="text-ink-mute">/</span>
          <span className="text-ink font-medium">{tenantName}</span>
        </nav>
      }
    >
      {children}
    </AppShell>
  );
}

/* ─── icons (1.4 stroke, 16px) ─────────────────────────────────── */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      {children}
    </svg>
  );
}
function IconHome() {
  return (
    <Icon>
      <path
        d="M2.5 7L8 3l5.5 4v6a1 1 0 01-1 1h-9a1 1 0 01-1-1V7z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
function IconChat() {
  return (
    <Icon>
      <path
        d="M3 4h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2v-2H3a1 1 0 01-1-1V5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
function IconDoc() {
  return (
    <Icon>
      <path
        d="M4 2h5l3 3v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </Icon>
  );
}
function IconGraph() {
  return (
    <Icon>
      <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 5.2l2 5.2M11 5.2l-2 5.2M5.5 4h5" stroke="currentColor" strokeWidth="1.4" />
    </Icon>
  );
}
function IconPlug() {
  return (
    <Icon>
      <path
        d="M5.5 2v3M10.5 2v3M4 5h8v3a4 4 0 01-8 0V5zM8 12v2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
function IconBell() {
  return (
    <Icon>
      <path
        d="M4 6.5a4 4 0 118 0v2l1.4 2.5H2.6L4 8.5v-2zM6 12a2 2 0 004 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
function IconCog() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
function IconPeople() {
  return (
    <Icon>
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 14a4 4 0 018 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9.5 11.5a3 3 0 014.5 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
function IconKey() {
  return (
    <Icon>
      <circle cx="5" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M7 9.5L13 3.5M11 5l1.5 1.5M9.5 6.5L11 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
function IconBill() {
  return (
    <Icon>
      <rect
        x="2.5"
        y="3.5"
        width="11"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M2.5 7h11M5 10h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </Icon>
  );
}
