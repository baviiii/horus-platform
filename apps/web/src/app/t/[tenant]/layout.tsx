import { AppShell, type NavGroup, type TenantMembership } from '@/components/app/shell';
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

  const [openAlerts, overdueIncidents, myMemberships, incidentsModule] = await Promise.all([
    prisma.alert.count({
      where: { tenantId: tenant.id, status: 'OPEN' },
    }),
    prisma.incident.count({
      where: {
        tenantId: tenant.id,
        status: { in: ['DRAFT', 'IN_REVIEW'] },
        notifyDueAt: { lt: new Date() },
      },
    }),
    prisma.tenantMember.findMany({
      where: { userId: user.id, tenant: { isActive: true } },
      include: { tenant: { select: { slug: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    // Incident reporting is a vertical (NDIS), not part of every workspace.
    prisma.tenantModule.findUnique({
      where: { tenantId_moduleKey: { tenantId: tenant.id, moduleKey: 'incidents' } },
      select: { id: true },
    }),
  ]);

  const memberships: TenantMembership[] = myMemberships.map((m) => ({
    slug: m.tenant.slug,
    name: m.tenant.name,
    role: m.role,
  }));

  const groups: NavGroup[] = [
    {
      items: [
        { href: `/t/${slug}`, label: 'Overview', icon: <IconHome /> },
        { href: `/t/${slug}/chat`, label: 'Chat', icon: <IconChat /> },
      ],
    },
    {
      title: 'Customer portal',
      items: [
        { href: `/t/${slug}/knowledge`, label: 'Knowledge', icon: <IconLibrary /> },
        { href: `/t/${slug}/agents`, label: 'Agents', icon: <IconBot /> },
        { href: `/t/${slug}/automations`, label: 'Automations', icon: <IconZap /> },
        { href: `/t/${slug}/usage`, label: 'Usage', icon: <IconGauge /> },
        { href: `/t/${slug}/portal`, label: 'End-user portal', icon: <IconGlobe /> },
      ],
    },
    {
      title: 'Intelligence',
      items: [
        { href: `/t/${slug}/documents`, label: 'Documents', icon: <IconDoc /> },
        { href: `/t/${slug}/intelligence`, label: 'Intelligence', icon: <IconIntel /> },
        { href: `/t/${slug}/graph`, label: 'Knowledge graph', icon: <IconGraph /> },
        ...(incidentsModule
          ? [
              {
                href: `/t/${slug}/incidents`,
                label: 'Incidents',
                icon: <IconIncident />,
                ...(overdueIncidents > 0 && { badge: String(overdueIncidents) }),
              },
            ]
          : []),
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
      items: [{ href: `/t/${slug}/settings`, label: 'Settings', icon: <IconCog /> }],
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
      memberships={memberships}
      activeSlug={slug}
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
function IconIntel() {
  return (
    <Icon>
      <path
        d="M6 13h4M6.5 11a4 4 0 111 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 2.5V1.5M13 8h1M2 8h1M11.5 4.5l.7-.7M3.8 3.8l.7.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
function IconIncident() {
  return (
    <Icon>
      <path
        d="M8 2.5L14 13H2L8 2.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
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
function IconLibrary() {
  return (
    <Icon>
      <path
        d="M3 3.5h3.5a2 2 0 012 2v8a1.5 1.5 0 00-1.5-1.5H3zM13 3.5H9.5a2 2 0 00-2 2v8a1.5 1.5 0 011.5-1.5H13z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
function IconBot() {
  return (
    <Icon>
      <rect x="3.5" y="5.5" width="9" height="7" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 2.5v3M6 9h.5M9.5 9h.5M5.5 15v-2M10.5 15v-2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
function IconZap() {
  return (
    <Icon>
      <path
        d="M8.5 1.5L2.5 9h4l-1 5.5L11.5 7h-4l1-5.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
function IconGauge() {
  return (
    <Icon>
      <path
        d="M2.5 12.5a5.5 5.5 0 1111 0M8 12.5l2.8-3.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}
function IconGlobe() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2.5 8h11M8 2.5c-1.5 1.5-2 3.4-2 5.5s.5 4 2 5.5M8 2.5c1.5 1.5 2 3.4 2 5.5s-.5 4-2 5.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
