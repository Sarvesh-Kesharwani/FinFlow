'use client';

import { useState, useTransition } from 'react';
import { FINANCE_CHANGED_EVENT } from '@/components/finance-events';
import { useFinanceSyncReady } from '@/components/useFinanceSyncReady';

async function setIncome(monthlyIncome: number): Promise<void> {
  const res = await fetch('/api/finance/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'set_income', monthlyIncome }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save');
  window.dispatchEvent(new CustomEvent(FINANCE_CHANGED_EVENT, { detail: { autoSync: true } }));
}

export function IncomeForm({ initialIncome }: { initialIncome: number }) {
  const [value, setValue] = useState(String(initialIncome || ''));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const syncReady = useFinanceSyncReady();

  function save() {
    if (!syncReady) {
      setError('Google Drive sync is still loading. Changes are locked until sync completes.');
      return;
    }
    setError('');
    setSaved(false);
    startTransition(() => {
      setIncome(Number(value || '0'))
        .then(() => setSaved(true))
        .catch((e) => setError((e as Error).message));
    });
  }

  return (
    <section className="card-panel">
      <h2 className="section-title">Monthly income</h2>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          value={value}
          disabled={!syncReady}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          placeholder="e.g. 80000"
        />
        <button className="btn-duored" disabled={isPending || !syncReady} onClick={save} type="button">
          Save income
        </button>
      </div>
      {!syncReady && <p className="mt-2 text-sm font-bold text-amber-700">Waiting for Google Drive sync before edits.</p>}
      {error && <p className="mt-2 text-sm font-bold text-red-600">{error}</p>}
      {saved && <p className="mt-2 text-sm font-bold text-green-600">Saved!</p>}
    </section>
  );
}
