'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FeatureRequestMenu } from '@/components/FeatureRequestMenu';
import { FINANCE_WORKSPACE_TAB_EVENT } from '@/components/finance-events';

const TABS = [
  { mode: 'dashboard', href: '/', label: 'Dashboard', emoji: '$' },
  { mode: 'wishlist', href: '/?tab=wishlist', label: 'To Buy', emoji: 'B' },
  { mode: 'mobile-recharge', href: '/mobile-recharge', label: 'Mobile Recharge', shortLabel: 'Recharge', emoji: 'M' },
  { mode: 'priority-picks', href: '/?tab=priority-picks', label: 'Priority Picks', emoji: 'P' },
  { mode: 'reports', href: '/?tab=reports', label: 'Reports', emoji: 'R' },
] as const;

const ROUTE_TO_MODE: Record<string, (typeof TABS)[number]['mode']> = {
  '/': 'dashboard',
  '/wishlist': 'wishlist',
  '/mobile-recharge': 'mobile-recharge',
  '/priority-picks': 'priority-picks',
  '/reports': 'reports',
};

function isWorkspaceMode(value: string | null): value is (typeof TABS)[number]['mode'] {
  return TABS.some((tab) => tab.mode === value);
}

export function NavTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryTab = searchParams.get('tab');
  const routeMode = pathname === '/' && isWorkspaceMode(queryTab) ? queryTab : ROUTE_TO_MODE[pathname] ?? 'dashboard';
  const [optimisticMode, setOptimisticMode] = useState(routeMode);
  const activeMode = pathname === '/' ? optimisticMode : routeMode;

  useEffect(() => {
    setOptimisticMode(routeMode);
  }, [routeMode]);

  return (
    <nav className="flex flex-wrap gap-2">
      <FeatureRequestMenu />
      {TABS.map((tab) => {
        const active = activeMode === tab.mode;
        return (
          <Link
            key={tab.mode}
            href={tab.href}
            onClick={(event) => {
              if (pathname !== '/' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setOptimisticMode(tab.mode);
              window.history.pushState(null, '', tab.href);
              localStorage.setItem('finance_workspace_tab', tab.mode);
              window.dispatchEvent(new CustomEvent(FINANCE_WORKSPACE_TAB_EVENT, { detail: { mode: tab.mode } }));
            }}
            className={[
              'btn-duo',
              active
                ? 'bg-duored-main text-white shadow-duored'
                : 'bg-white text-duored-ink border-2 border-duored-border shadow-card',
              'px-3 text-xs sm:px-4 sm:text-sm',
            ].join(' ')}
          >
            <span aria-hidden>{tab.emoji}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{'shortLabel' in tab ? tab.shortLabel : tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
