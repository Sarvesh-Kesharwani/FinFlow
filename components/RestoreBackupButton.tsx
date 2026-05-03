'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FINANCE_CHANGED_EVENT } from '@/components/finance-events';

type BackupInfo = { exists: boolean; backupAt: string | null; sourceUpdatedAt: string | null };

export function RestoreBackupButton() {
  const router = useRouter();
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/drive/restore', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        if (data.ok) {
          setInfo({
            exists: Boolean(data.exists),
            backupAt: data.backupAt ?? null,
            sourceUpdatedAt: data.sourceUpdatedAt ?? null,
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function restore() {
    if (busy) return;
    if (!confirm('Restore finance data from the last daily backup? This will overwrite the current Drive state.')) {
      return;
    }
    setBusy(true);
    setError('');
    setDone('');
    try {
      const r = await fetch('/api/drive/restore', { method: 'POST' });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error || 'Restore failed');
        return;
      }
      setDone('Restored. Reloading…');
      window.dispatchEvent(new CustomEvent(FINANCE_CHANGED_EVENT, { detail: { autoSync: false } }));
      router.refresh();
    } catch {
      setError('Restore failed');
    } finally {
      setBusy(false);
    }
  }

  const label = info?.exists && info.backupAt
    ? `Backup from ${new Date(info.backupAt).toLocaleString()}`
    : info && !info.exists
      ? 'No backup yet — first daily snapshot saves automatically.'
      : 'Checking backup…';

  return (
    <section className="card-panel space-y-3">
      <h2 className="section-title">Daily backup</h2>
      <p className="text-sm font-semibold text-duored-muted">
        Your Drive state is snapshotted once per day. Restore overwrites the current state with the latest backup.
      </p>
      <p className="text-sm font-bold text-duored-ink">{label}</p>
      <button
        type="button"
        className="btn-duored"
        onClick={restore}
        disabled={busy || !info?.exists}
      >
        {busy ? 'Restoring…' : 'Restore from last backup'}
      </button>
      {error && <p className="text-sm font-bold text-red-600">{error}</p>}
      {done && <p className="text-sm font-bold text-green-600">{done}</p>}
    </section>
  );
}
