'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FeatureRequestMenu } from '@/components/FeatureRequestMenu';

const TABS = [
  { href: '/', label: 'Dashboard', emoji: '💰' },
  { href: '/wishlist', label: 'To Buy', emoji: '🛍️' },
  { href: '/reports', label: 'Reports', emoji: '📈' },
];

export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2">
      <FeatureRequestMenu />
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              'btn-duo',
              active
                ? 'bg-duored-main text-white shadow-duored'
                : 'bg-white text-duored-ink border-2 border-duored-border shadow-card',
            ].join(' ')}
          >
            <span aria-hidden>{tab.emoji}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
