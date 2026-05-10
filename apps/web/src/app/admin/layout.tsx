import { AppShell, type NavGroup } from '@/components/app/shell';
import { mockUser } from '@/lib/mock-data';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const groups: NavGroup[] = [
    {
      items: [
        { href: '/admin', label: 'Overview', icon: <IconHome /> },
        { href: '/admin/tenants', label: 'Tenants', icon: <IconBuilding /> },
        { href: '/admin/usage', label: 'Usage & billing', icon: <IconChart /> },
        { href: '/admin/audit', label: 'Audit log', icon: <IconScroll /> },
      ],
    },
  ];

  return (
    <AppShell
      brand={{ name: 'Horus', href: '/admin', tag: 'Platform admin' }}
      groups={groups}
      user={{
        name: mockUser.displayName,
        email: mockUser.email,
        initials: mockUser.initials,
      }}
      context={
        <nav className="text-ink-faded flex items-center gap-1.5 text-[13px]">
          <span className="text-ink-mute">Platform</span>
          <span className="text-ink-mute">/</span>
          <span className="text-ink font-medium">Admin console</span>
        </nav>
      }
    >
      {children}
    </AppShell>
  );
}

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
function IconBuilding() {
  return (
    <Icon>
      <rect x="3" y="2" width="10" height="12" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.5 4.5h1m3 0h1m-5 3h1m3 0h1m-5 3h1m3 0h1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
function IconChart() {
  return (
    <Icon>
      <path
        d="M2.5 13.5h11M4.5 11V7M7.5 11V4M10.5 11V8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
function IconScroll() {
  return (
    <Icon>
      <path
        d="M3 3h7l3 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 7h5M5.5 9.5h5M5.5 12h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Icon>
  );
}
