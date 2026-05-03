'use client';

import { useEffect, useRef, useState } from 'react';
import { FINANCE_CHANGED_EVENT } from '@/components/finance-events';

type FeatureRequestEntry = {
  id: string;
  description: string;
  createdAt: string;
};

export function FeatureRequestMenu() {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<FeatureRequestEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  async function loadRequests() {
    try {
      const res = await fetch('/api/finance/state', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      setRequests(data.state.requests ?? []);
    } catch {
      // keep current UI state
    }
  }

  useEffect(() => {
    loadRequests();
    function onFinanceChanged() {
      void loadRequests();
    }
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener(FINANCE_CHANGED_EVENT, onFinanceChanged as EventListener);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener(FINANCE_CHANGED_EVENT, onFinanceChanged as EventListener);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  async function mutate(payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/finance/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Failed to update requests');
        return;
      }
      setRequests(data.state.requests ?? []);
      window.dispatchEvent(new CustomEvent(FINANCE_CHANGED_EVENT, { detail: { autoSync: true } }));
    } catch {
      setError('Failed to update requests');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="btn-duo bg-white text-duored-ink border-2 border-duored-border shadow-card"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden>📝</span>
        <span>Requests</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-[24rem] rounded-3xl border-2 border-duored-border bg-white p-4 shadow-roseCard">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold uppercase tracking-[0.12em] text-duored-deep">Feature / Bug Requests</h3>
            <button className="chip-soft" type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="mt-3 space-y-2">
            <input
              className="text-input w-full"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a request description"
            />
            <button
              className="btn-duored w-full"
              disabled={busy}
              type="button"
              onClick={async () => {
                const description = draft.trim();
                if (!description) {
                  setError('Request description is required');
                  return;
                }
                await mutate({ op: 'add_request', description });
                setDraft('');
              }}
            >
              Add request
            </button>
            {error && <p className="text-xs font-bold text-red-600">{error}</p>}
          </div>

          <div className="mt-4 max-h-80 space-y-2 overflow-auto pr-1">
            {requests.length === 0 ? (
              <p className="text-sm font-semibold text-duored-muted">No requests yet.</p>
            ) : (
              requests.map((request) => (
                <div key={request.id} className="rounded-2xl border border-duored-soft/80 bg-duored-soft/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-duored-ink">{request.description}</p>
                    <button
                      className="chip-danger px-2 py-0.5 text-xs"
                      type="button"
                      disabled={busy}
                      onClick={() => void mutate({ op: 'remove_request', requestId: request.id })}
                    >
                      X
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] font-semibold text-duored-muted">
                    {new Date(request.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
