'use client';

import { useEffect, useRef, useState } from 'react';

type SyncState = 'loading' | 'synced' | 'unsynced' | 'syncing' | 'no-auth';

export function SyncButton() {
  const [state, setState] = useState<SyncState>('loading');
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const PULLED_KEY = 'tubeo_drive_pulled';

  // On mount: pull Drive → cookie only once per login session (sessionStorage flag).
  // sessionStorage is cleared automatically on tab/browser close (i.e. logout clears it too).
  useEffect(() => {
    if (sessionStorage.getItem(PULLED_KEY)) {
      // Already pulled this session — just check sync state
      checkSync();
      return;
    }

    fetch('/api/drive/sync', { method: 'PUT' })
      .then((r) => {
        if (r.status === 401) { setState('no-auth'); return; }
        sessionStorage.setItem(PULLED_KEY, '1');
        checkSync();
      })
      .catch(() => checkSync());
  }, []);

  async function checkSync() {
    try {
      const r = await fetch('/api/drive/sync');
      if (r.status === 401) { setState('no-auth'); return; }
      const data = await r.json();
      setState(data.synced ? 'synced' : 'unsynced');
      if (data.updatedAt) setLastSynced(data.updatedAt);
    } catch {
      setState('unsynced');
    }
  }

  async function pushSync() {
    setState('syncing');
    try {
      const r = await fetch('/api/drive/sync', { method: 'POST' });
      if (r.status === 401) { setState('no-auth'); return; }
      setLastSynced(new Date().toISOString());
      setState('synced');
    } catch {
      setState('unsynced');
    }
  }

  // Poll every 30s
  useEffect(() => {
    if (state === 'no-auth') return;
    const id = setInterval(checkSync, 30_000);
    return () => clearInterval(id);
  }, [state]);

  if (state === 'no-auth') return null;

  const isSynced = state === 'synced';
  const isSyncing = state === 'syncing' || state === 'loading';

  const label = isSyncing ? '↻' : isSynced ? '●' : '●';
  const title = isSyncing
    ? 'Syncing with Google Drive…'
    : isSynced
    ? `Synced with Drive${lastSynced ? ' · ' + new Date(lastSynced).toLocaleTimeString() : ''}`
    : 'Not synced — click to sync now';

  return (
    <button
      onClick={!isSynced && !isSyncing ? pushSync : undefined}
      title={title}
      disabled={isSyncing}
      className={[
        'chip text-lg leading-none transition-colors',
        isSyncing ? 'text-duo-ink/30 cursor-wait' : '',
        isSynced ? 'text-duo-green border-duo-green cursor-default' : '',
        !isSynced && !isSyncing ? 'text-red-500 border-red-300 hover:bg-red-50 cursor-pointer' : '',
      ].join(' ')}
    >
      <span className={isSyncing ? 'animate-spin inline-block' : ''}>{label}</span>
    </button>
  );
}
