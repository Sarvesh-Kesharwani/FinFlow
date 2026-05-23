'use client';

import { useEffect, useState, useTransition } from 'react';
import { FinanceClient, type FinanceMode } from '@/components/FinanceClient';
import { FINANCE_WORKSPACE_TAB_EVENT } from '@/components/finance-events';
import type { FinanceStore } from '@/lib/finance-types';

const WORKSPACE_TAB_KEY = 'finance_workspace_tab';
const MODES = new Set<FinanceMode>(['dashboard', 'wishlist', 'priority-picks', 'reports']);
const TO_BUY_HELP = 'Add links from Amazon, Flipkart, Myntra, TechnoSport, and more, then rank by priority.';

function isFinanceMode(value: string | null | undefined): value is FinanceMode {
  return Boolean(value && MODES.has(value as FinanceMode));
}

function modeFromLocation(): FinanceMode {
  if (typeof window === 'undefined') return 'dashboard';
  const fromQuery = new URLSearchParams(window.location.search).get('tab');
  if (isFinanceMode(fromQuery)) return fromQuery;
  const cached = localStorage.getItem(WORKSPACE_TAB_KEY);
  return isFinanceMode(cached) ? cached : 'dashboard';
}

export function FinanceWorkspace({ initialState, initialMode }: { initialState: FinanceStore; initialMode: FinanceMode }) {
  const [mode, setMode] = useState<FinanceMode>(initialMode);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const next = modeFromLocation();
    setMode(next);
    localStorage.setItem(WORKSPACE_TAB_KEY, next);

    function applyMode(nextMode: FinanceMode) {
      startTransition(() => {
        setMode(nextMode);
        localStorage.setItem(WORKSPACE_TAB_KEY, nextMode);
      });
    }

    function onTab(event: Event) {
      const nextMode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
      if (isFinanceMode(nextMode)) applyMode(nextMode);
    }

    function onPopState() {
      applyMode(modeFromLocation());
    }

    window.addEventListener(FINANCE_WORKSPACE_TAB_EVENT, onTab);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener(FINANCE_WORKSPACE_TAB_EVENT, onTab);
      window.removeEventListener('popstate', onPopState);
    };
  }, [startTransition]);

  return (
    <div className="space-y-4">
      {mode === 'wishlist' && (
        <section>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-extrabold text-duored-deep">To Buy List</h1>
            <span className="group relative inline-flex">
              <button
                type="button"
                aria-label={TO_BUY_HELP}
                title={TO_BUY_HELP}
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-duored-border bg-white text-xs font-black text-duored-muted shadow-card"
              >
                i
              </button>
              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-xl border-2 border-duored-border bg-white px-3 py-2 text-sm font-bold text-duored-muted opacity-0 shadow-roseCard transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {TO_BUY_HELP}
              </span>
            </span>
          </div>
        </section>
      )}
      {mode === 'priority-picks' && (
        <section className="space-y-1">
          <h1 className="text-3xl font-extrabold text-duored-deep">Priority Picks</h1>
          <p className="font-semibold text-duored-muted">
            Drag items between To Buy and SquidGame Winner Items, then reorder each list by priority.
          </p>
        </section>
      )}
      <FinanceClient initialState={initialState} mode={mode} />
    </div>
  );
}
