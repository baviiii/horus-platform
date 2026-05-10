'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/tenants', label: 'Tenants' },
  { href: '/admin/usage', label: 'Usage' },
  { href: '/admin/audit', label: 'Audit' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="border-hairline bg-midnight-elev/40 flex items-center gap-1 border p-1">
      {NAV.map((item) => {
        const active =
          item.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'text-2xs px-4 py-2 font-mono uppercase tracking-[0.22em] transition-colors',
              active
                ? 'bg-gold/20 text-gold-bright shadow-[inset_0_-1px_0_hsla(38,80%,65%,0.6)]'
                : 'text-parchment-soft hover:text-gold',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
