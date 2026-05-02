'use client';

import { useEffect, useState } from 'react';
import { FINANCE_SYNC_STATUS_CACHE_KEY, FINANCE_SYNC_STATUS_EVENT } from '@/components/finance-events';

function readCachedReady(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cached = JSON.parse(localStorage.getItem(FINANCE_SYNC_STATUS_CACHE_KEY) || 'null') as { ready?: boolean } | null;
    return Boolean(cached?.ready);
  } catch {
    return false;
  }
}

export function useFinanceSyncReady(): boolean {
  const [ready, setReady] = useState(readCachedReady);

  useEffect(() => {
    function onSyncStatus(event: Event) {
      const detail = (event as CustomEvent<{ ready?: boolean }>).detail;
      setReady(Boolean(detail?.ready));
    }

    window.addEventListener(FINANCE_SYNC_STATUS_EVENT, onSyncStatus);
    setReady(readCachedReady());
    return () => {
      window.removeEventListener(FINANCE_SYNC_STATUS_EVENT, onSyncStatus);
    };
  }, []);

  return ready;
}
