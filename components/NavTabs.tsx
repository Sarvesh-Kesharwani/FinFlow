'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { href: '/',         label: 'Mixed',    emoji: '🎬' },
  { href: '/channels', label: 'Channels', emoji: '📺' },
];

export function NavTabs() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();

  return (
    <nav className="flex gap-2">
      {TABS.map((t) => {
        const active = pathname === t.href;
        const href = qs ? `${t.href}?${qs}` : t.href;
        return (
          <Link
            key={t.href}
            href={href}
            className={`btn-duo ${active ? 'bg-duo-green text-white shadow-duoGreen' : 'bg-white text-duo-ink border-2 border-duo-border shadow-card'}`}
          >
            <span aria-hidden>{t.emoji}</span>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
