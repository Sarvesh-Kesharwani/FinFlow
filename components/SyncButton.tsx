'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FINANCE_CHANGED_EVENT, FINANCE_SYNC_STATUS_CACHE_KEY, FINANCE_SYNC_STATUS_EVENT } from '@/components/finance-events';

type SyncState = 'loading' | 'synced' | 'unsynced' | 'syncing' | 'no-auth';
type CachedSyncStatus = {
  state: SyncState;
  ready: boolean;
  lastSynced: string | null;
  checkedAt: number;
};

const PULLED_KEY = 'finance_drive_pulled';
const SYNC_STALE_MS = 2 * 60_000;
const INITIAL_VALIDATE_DELAY_MS = 900;

function readCachedSyncStatus(): CachedSyncStatus | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(localStorage.getItem(FINANCE_SYNC_STATUS_CACHE_KEY) || 'null') as CachedSyncStatus | null;
    if (!cached || typeof cached.checkedAt !== 'number') return null;
    return cached;
  } catch {
    return null;
  }
}

function isStale(cached: CachedSyncStatus | null): boolean {
  return !cached || Date.now() - cached.checkedAt > SYNC_STALE_MS;
}

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>(() => readCachedSyncStatus()?.state ?? 'loading');
  const [lastSynced, setLastSynced] = useState<string | null>(() => readCachedSyncStatus()?.lastSynced ?? null);
  const syncingRef = useRef(false);
  const checkingRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const lastCheckRef = useRef(readCachedSyncStatus()?.checkedAt ?? 0);

  function emitSyncReady(ready: boolean, nextState = state, syncedAt = lastSynced) {
    lastCheckRef.current = Date.now();
    localStorage.setItem(
      FINANCE_SYNC_STATUS_CACHE_KEY,
      JSON.stringify({
        state: nextState,
        ready,
        lastSynced: syncedAt,
        checkedAt: lastCheckRef.current,
      } satisfies CachedSyncStatus),
    );
    window.dispatchEvent(new CustomEvent(FINANCE_SYNC_STATUS_EVENT, { detail: { ready } }));
  }

  const pushSync = useCallback(
    async (background = false) => {
      if (syncingRef.current) return;
      syncingRef.current = true;

      if (!background) setState('syncing');

      try {
        const r = await fetch('/api/drive/sync', { method: 'POST' });
        if (r.status === 401) {
          setState('no-auth');
          emitSyncReady(true, 'no-auth', null);
          return;
        }
        if (!r.ok) {
          setState('unsynced');
          emitSyncReady(false, 'unsynced', null);
          return;
        }
        const data = await r.json();
        if (data.initialized || data.driveWins || data.seededFromLocal) {
          sessionStorage.setItem(PULLED_KEY, '1');
          const syncedAt = data.updatedAt || new Date().toISOString();
          setLastSynced(syncedAt);
          setState('synced');
          emitSyncReady(true, 'synced', syncedAt);
          if (data.replacedLocal) {
            router.refresh();
          }
          return;
        }
        const syncedAt = data.updatedAt || new Date().toISOString();
        setLastSynced(syncedAt);
        setState('synced');
        emitSyncReady(true, 'synced', syncedAt);
      } catch {
        setState('unsynced');
        emitSyncReady(false, 'unsynced', null);
      } finally {
        syncingRef.current = false;
      }
    },
    [router],
  );

  const checkSync = useCallback(async () => {
    if (syncingRef.current || checkingRef.current) return;
    checkingRef.current = true;

    try {
      const r = await fetch('/api/drive/sync');
      if (r.status === 401) {
        setState('no-auth');
        emitSyncReady(true, 'no-auth', null);
        return;
      }
      if (!r.ok) {
        setState('unsynced');
        emitSyncReady(false, 'unsynced', null);
        return;
      }
      const data = await r.json();
      if (!data.synced && data.driveHasData && !data.localHasData) {
        void pushSync(true);
        return;
      }
      const nextState = data.synced ? 'synced' : 'unsynced';
      const syncedAt = data.updatedAt || null;
      setState(nextState);
      setLastSynced(syncedAt);
      emitSyncReady(Boolean(data.initialized), nextState, syncedAt);
    } catch {
      setState('unsynced');
      emitSyncReady(false, 'unsynced', null);
    } finally {
      checkingRef.current = false;
    }
  }, [pushSync]);

  useEffect(() => {
    const cached = readCachedSyncStatus();
    if (cached) {
      setState(cached.state);
      setLastSynced(cached.lastSynced);
      emitSyncReady(cached.ready, cached.state, cached.lastSynced);
    }

    if (sessionStorage.getItem(PULLED_KEY)) {
      if (isStale(cached)) {
        window.setTimeout(() => void checkSync(), INITIAL_VALIDATE_DELAY_MS);
      }
      return;
    }

    fetch('/api/drive/sync', { method: 'PUT' })
      .then((r) => {
        if (r.status === 401) {
          setState('no-auth');
          emitSyncReady(true, 'no-auth', null);
          return;
        }
        if (!r.ok) {
          setState('unsynced');
          emitSyncReady(false, 'unsynced', null);
          return;
        }
        sessionStorage.setItem(PULLED_KEY, '1');
        setState('synced');
        setLastSynced(null);
        emitSyncReady(true, 'synced', null);
        window.setTimeout(() => void checkSync(), INITIAL_VALIDATE_DELAY_MS);
      })
      .catch(() => void checkSync());
  }, [checkSync]);

  useEffect(() => {
    const onFinanceChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ autoSync?: boolean }>).detail;
      setState('unsynced');
      emitSyncReady(false, 'unsynced', null);

      if (detail?.autoSync) {
        if (syncTimerRef.current) {
          window.clearTimeout(syncTimerRef.current);
        }
        syncTimerRef.current = window.setTimeout(() => {
          syncTimerRef.current = null;
          void pushSync(true);
        }, 1200);
      } else {
        void checkSync();
      }
    };

    window.addEventListener(FINANCE_CHANGED_EVENT, onFinanceChanged);
    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
      }
      window.removeEventListener(FINANCE_CHANGED_EVENT, onFinanceChanged);
    };
  }, [checkSync, pushSync]);

  useEffect(() => {
    if (state === 'no-auth') return;
    function checkIfStale() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckRef.current > SYNC_STALE_MS) void checkSync();
    }

    window.addEventListener('focus', checkIfStale);
    document.addEventListener('visibilitychange', checkIfStale);
    return () => {
      window.removeEventListener('focus', checkIfStale);
      document.removeEventListener('visibilitychange', checkIfStale);
    };
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
