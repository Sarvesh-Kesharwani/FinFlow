'use client';

import { useMemo, useState, useTransition } from 'react';
import { summarizeFinance } from '@/lib/finance-math';
import {
  EXPENSE_CADENCE_OPTIONS,
  EXPENSE_CATEGORIES,
  type BuyListItem,
  type ExpenseCadence,
  type ExpenseCategory,
  type ExpenseEntry,
  type FinanceStore,
} from '@/lib/finance-types';

const FINANCE_CHANGED_EVENT = 'finance-state-changed';

function formatMoney(amount: number, currency = 'INR'): string {
  const normalized = currency.toUpperCase();
  const locale = normalized === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: normalized,
    maximumFractionDigits: 0,
  }).format(amount);
}

type FinanceOp =
  | { op: 'set_income'; monthlyIncome: number }
  | {
      op: 'add_expense';
      title: string;
      amount: number;
      category: ExpenseCategory;
      frequency?: ExpenseCadence;
      cadence?: ExpenseCadence;
      spentOn: string;
      notes?: string;
    }
  | { op: 'remove_expense'; expenseId: string }
  | { op: 'add_buy_item'; url: string; notes?: string }
  | { op: 'remove_buy_item'; itemId: string }
  | { op: 'move_buy_item'; itemId: string; direction: 'up' | 'down' };

async function mutateFinance(payload: FinanceOp): Promise<FinanceStore> {
  const res = await fetch('/api/finance/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Failed to save');
  }
  window.dispatchEvent(new CustomEvent(FINANCE_CHANGED_EVENT, { detail: { autoSync: true } }));
  return data.state as FinanceStore;
}

function StatCard({ label, value, tone = 'rose' }: { label: string; value: string; tone?: 'rose' | 'amber' | 'green' }) {
  return (
    <div className={`card-3d ${tone === 'amber' ? 'card-amber' : tone === 'green' ? 'card-green' : 'card-rose'}`}>
      <p className="text-xs uppercase tracking-[0.18em] opacity-75">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
    </div>
  );
}

function ExpenseRow({ item, onRemove }: { item: ExpenseEntry; onRemove: (id: string) => void }) {
  return (
    <li className="lift-card">
      <div className="min-w-0">
        <p className="truncate font-extrabold text-duored-ink">{item.title}</p>
        <p className="text-xs text-duored-muted">
          {item.category} · {item.cadence} · {new Date(item.spentOn).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <p className="font-extrabold text-duored-deep">{formatMoney(item.amount)}</p>
        <button className="chip-danger" onClick={() => onRemove(item.id)} type="button">
          Remove
        </button>
      </div>
    </li>
  );
}

function BuyRow({
  item,
  index,
  length,
  affordable,
  onMove,
  onRemove,
}: {
  item: BuyListItem;
  index: number;
  length: number;
  affordable: boolean;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onRemove: (id: string) => void;
}) {
  return (
    <li className={`lift-card ${affordable ? 'ring-2 ring-emerald-300' : ''}`}>
      <div className="min-w-0">
        <p className="truncate font-extrabold text-duored-ink">{item.title}</p>
        <p className="mt-1 text-xs font-semibold text-duored-muted">
          Source: {item.sourcePlatform || 'Online Store'}
        </p>
        <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-duored-link underline">
          {item.url}
        </a>
        {item.notes && <p className="mt-1 text-xs text-duored-muted">{item.notes}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="chip-price">{formatMoney(item.price, item.currency || 'INR')}</span>
        <button className="chip-soft" onClick={() => onMove(item.id, 'up')} disabled={index === 0} type="button">
          ↑
        </button>
        <button className="chip-soft" onClick={() => onMove(item.id, 'down')} disabled={index === length - 1} type="button">
          ↓
        </button>
        <button className="chip-danger" onClick={() => onRemove(item.id)} type="button">
          Remove
        </button>
      </div>
    </li>
  );
}

export function FinanceClient({ initialState, mode }: { initialState: FinanceStore; mode: 'dashboard' | 'wishlist' }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const summary = useMemo(() => summarizeFinance(state), [state]);
  const affordableSet = useMemo(() => new Set(summary.affordableItemIds), [summary.affordableItemIds]);

  const [expenseForm, setExpenseForm] = useState({
    title: '',
    amount: '',
    category: 'purchases' as ExpenseCategory,
    frequency: '' as '' | ExpenseCadence,
    spentOn: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [buyForm, setBuyForm] = useState({ url: '', notes: '' });
  const [incomeInput, setIncomeInput] = useState(String(state.monthlyIncome || ''));

  function runMutation(payload: FinanceOp) {
    setError('');
    startTransition(() => {
      mutateFinance(payload)
        .then((next) => setState(next))
        .catch((e) => setError((e as Error).message));
    });
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Monthly Income" value={formatMoney(state.monthlyIncome)} tone="green" />
        <StatCard label="Expected / Month" value={formatMoney(summary.monthlyExpectedExpenses)} tone="amber" />
        <StatCard label="Spent This Month" value={formatMoney(summary.currentMonthSpent)} tone="rose" />
        <StatCard label="Can Buy This Month" value={`${summary.canBuyCountThisMonth} items`} tone="green" />
      </section>

      {error && <p className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p>}

      <section className="card-panel">
        <h2 className="section-title">Monthly income</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="text-input"
            type="number"
            min="0"
            step="0.01"
            value={incomeInput}
            onChange={(e) => setIncomeInput(e.target.value)}
            placeholder="e.g. 80000"
          />
          <button
            className="btn-duored"
            disabled={isPending}
            onClick={() => runMutation({ op: 'set_income', monthlyIncome: Number(incomeInput || '0') })}
            type="button"
          >
            Save income
          </button>
        </div>
      </section>

      {mode === 'dashboard' && (
        <>
          <section className="card-panel">
            <h2 className="section-title">Add an expense</h2>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="text-input"
                value={expenseForm.title}
                onChange={(e) => setExpenseForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="Bread / Gym / Internet Bill / Car Fuel"
              />
              <input
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm((s) => ({ ...s, amount: e.target.value }))}
                placeholder="Amount"
              />
              <select
                className="text-input"
                value={expenseForm.category}
                onChange={(e) => setExpenseForm((s) => ({ ...s, category: e.target.value as ExpenseCategory }))}
              >
                {EXPENSE_CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                className="text-input"
                value={expenseForm.frequency}
                onChange={(e) => setExpenseForm((s) => ({ ...s, frequency: e.target.value as '' | ExpenseCadence }))}
              >
                <option value="">One-time (default)</option>
                {EXPENSE_CADENCE_OPTIONS.filter((item) => item.value !== 'one-time').map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <input
                className="text-input"
                type="date"
                value={expenseForm.spentOn}
                onChange={(e) => setExpenseForm((s) => ({ ...s, spentOn: e.target.value }))}
              />
              <input
                className="text-input"
                value={expenseForm.notes}
                onChange={(e) => setExpenseForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>
            <button
              className="btn-duored mt-3"
              disabled={isPending}
              onClick={() => {
                runMutation({
                  op: 'add_expense',
                  title: expenseForm.title,
                  amount: Number(expenseForm.amount || '0'),
                  category: expenseForm.category,
                  frequency: expenseForm.frequency || undefined,
                  spentOn: expenseForm.spentOn,
                  notes: expenseForm.notes,
                });
                setExpenseForm((s) => ({ ...s, title: '', amount: '', notes: '', frequency: '' }));
              }}
              type="button"
            >
              Add expense
            </button>
          </section>

          <section className="card-panel">
            <h2 className="section-title">Expense list</h2>
            {state.expenses.length === 0 ? (
              <p className="font-semibold text-duored-muted">No expenses yet. Add your first one above.</p>
            ) : (
              <ul className="space-y-2">
                {state.expenses.map((entry) => (
                  <ExpenseRow key={entry.id} item={entry} onRemove={(expenseId) => runMutation({ op: 'remove_expense', expenseId })} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {mode === 'wishlist' && (
        <>
          <section className="card-panel">
            <h2 className="section-title">Add to buy-list</h2>
            <p className="mb-2 text-sm font-semibold text-duored-muted">
              Paste only the product link. Name, price, and source platform are extracted automatically.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="text-input md:col-span-2"
                value={buyForm.url}
                onChange={(e) => setBuyForm((s) => ({ ...s, url: e.target.value }))}
                placeholder="Paste product link from Amazon / Flipkart / Myntra / etc."
              />
              <input
                className="text-input md:col-span-2"
                value={buyForm.notes}
                onChange={(e) => setBuyForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Optional note"
              />
            </div>
            <button
              className="btn-duored mt-3"
              disabled={isPending}
              onClick={() => {
                runMutation({
                  op: 'add_buy_item',
                  url: buyForm.url,
                  notes: buyForm.notes,
                });
                setBuyForm({ url: '', notes: '' });
              }}
              type="button"
            >
              Add item from link
            </button>
          </section>

          <section className="card-panel">
            <h2 className="section-title">Priority buy list</h2>
            <p className="mb-3 text-sm font-semibold text-duored-muted">
              Top items have higher priority. Green-outline rows are affordable this month based on your remaining income.
            </p>
            {state.buyList.length === 0 ? (
              <p className="font-semibold text-duored-muted">No items yet. Add your first product link above.</p>
            ) : (
              <ol className="space-y-2">
                {state.buyList.map((item, index) => (
                  <BuyRow
                    key={item.id}
                    item={item}
                    index={index}
                    length={state.buyList.length}
                    affordable={affordableSet.has(item.id)}
                    onMove={(itemId, direction) => runMutation({ op: 'move_buy_item', itemId, direction })}
                    onRemove={(itemId) => runMutation({ op: 'remove_buy_item', itemId })}
                  />
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export { FINANCE_CHANGED_EVENT };
