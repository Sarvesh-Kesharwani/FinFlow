'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FINANCE_CHANGED_EVENT } from '@/components/FinanceClient';

type SyncState = 'loading' | 'synced' | 'unsynced' | 'syncing' | 'no-auth';

const PULLED_KEY = 'finance_drive_pulled';

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>('loading');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const syncingRef = useRef(false);
  const checkingRef = useRef(false);

  const checkSync = useCallback(async () => {
    if (syncingRef.current || checkingRef.current) return;
    checkingRef.current = true;

    try {
      const r = await fetch('/api/drive/sync');
      if (r.status === 401) {
        setState('no-auth');
        return;
      }
      if (!r.ok) {
        setState('unsynced');
        return;
      }
      const data = await r.json();
      setState(data.synced ? 'synced' : 'unsynced');
      setLastSynced(data.updatedAt || null);
    } catch {
      setState('unsynced');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const pushSync = useCallback(
    async (background = false) => {
      if (syncingRef.current) return;
      syncingRef.current = true;

      if (!background) setState('syncing');

      try {
        const r = await fetch('/api/drive/sync', { method: 'POST' });
        if (r.status === 401) {
          setState('no-auth');
          return;
        }
        if (!r.ok) {
          setState('unsynced');
          return;
        }
        const data = await r.json();
        if (data.initialized || data.driveWins || data.seededFromLocal) {
          sessionStorage.setItem(PULLED_KEY, '1');
          setLastSynced(data.updatedAt || new Date().toISOString());
          setState('synced');
          if (data.replacedLocal || data.seededFromLocal) {
            router.refresh();
          }
          return;
        }
        setLastSynced(data.updatedAt || new Date().toISOString());
        setState('synced');
      } catch {
        setState('unsynced');
      } finally {
        syncingRef.current = false;
      }
    },
    [router],
  );

  useEffect(() => {
    if (sessionStorage.getItem(PULLED_KEY)) {
      void checkSync();
      return;
    }

    fetch('/api/drive/sync', { method: 'PUT' })
      .then((r) => {
        if (r.status === 401) {
          setState('no-auth');
          return;
        }
        if (!r.ok) {
          setState('unsynced');
          return;
        }
        sessionStorage.setItem(PULLED_KEY, '1');
        void checkSync();
        router.refresh();
      })
      .catch(() => void checkSync());
  }, [checkSync, router]);

  useEffect(() => {
    const onFinanceChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ autoSync?: boolean }>).detail;
      setLastSynced(null);
      setState('unsynced');

      if (detail?.autoSync) {
        void pushSync(true);
      } else {
        void checkSync();
      }
    };

    window.addEventListener(FINANCE_CHANGED_EVENT, onFinanceChanged);
    return () => window.removeEventListener(FINANCE_CHANGED_EVENT, onFinanceChanged);
  }, [checkSync, pushSync]);

  useEffect(() => {
    if (state === 'no-auth') return;
    const id = setInterval(() => void checkSync(), 30_000);
    return () => clearInterval(id);
  }, [checkSync, state]);

  if (state === 'no-auth') return null;

  const isSynced = state === 'synced';
  const isSyncing = state === 'syncing' || state === 'loading';
  const icon = isSyncing ? '↻' : '●';
  const title = isSyncing
    ? 'Syncing with Google Drive...'
    : isSynced
      ? `Synced with Drive${lastSynced ? ' · ' + new Date(lastSynced).toLocaleTimeString() : ''}`
      : 'Not synced - click to sync now';

  return (
    <button
      onClick={!isSynced && !isSyncing ? () => void pushSync() : undefined}
      title={title}
      disabled={isSyncing}
      className={[
        'chip text-lg leading-none transition-colors',
        isSyncing ? 'cursor-wait text-duored-ink/35' : '',
        isSynced ? 'cursor-default border-emerald-300 text-emerald-600' : '',
        !isSynced && !isSyncing ? 'cursor-pointer border-red-300 text-red-500 hover:bg-red-50' : '',
      ].join(' ')}
    >
      <span className={isSyncing ? 'inline-block animate-spin' : ''}>{icon}</span>
    </button>
  );
}
