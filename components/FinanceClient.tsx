'use client';

import { type Dispatch, type ReactNode, type SetStateAction, useMemo, useState, useTransition } from 'react';
import { CsvImportButton } from '@/components/CsvImportButton';
import { summarizeFinance } from '@/lib/finance-math';
import {
  EXPENSE_CADENCE_OPTIONS,
  EXPENSE_CATEGORIES,
  MAINTENANCE_SUBCATEGORIES,
  type BuyListItem,
  type ExpenseBucket,
  type ExpenseCadence,
  type ExpenseCategory,
  type ExpenseEntry,
  type FinanceStore,
} from '@/lib/finance-types';

const FINANCE_CHANGED_EVENT = 'finance-state-changed';
const CUSTOM_FREQ_PREFIX = 'custom-frequency:';

type ExpenseFormMode = 'one-time' | 'repetitive';

type ExpenseFormState = {
  title: string;
  amount: string;
  mode: ExpenseFormMode;
  frequency: '' | ExpenseCadence;
  customFrequency: string;
  category: ExpenseCategory;
  subCategory: string;
};

function createExpenseForm(): ExpenseFormState {
  return {
    title: '',
    amount: '',
    mode: 'one-time',
    frequency: '',
    customFrequency: '',
    category: 'maintenance',
    subCategory: '',
  };
}

type FilterPeriod = 'all' | 'day' | 'week' | 'month' | 'year';

type FilterState = {
  period: FilterPeriod;
  reference: string; // YYYY-MM-DD
};

function createFilter(): FilterState {
  return { period: 'all', reference: new Date().toISOString().slice(0, 10) };
}

function startOfWeek(date: Date): Date {
  const out = new Date(date);
  const day = out.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // Monday-based
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - diff);
  return out;
}

function matchesFilter(spentOn: string, filter: FilterState): boolean {
  if (filter.period === 'all') return true;
  const ref = new Date(filter.reference);
  if (Number.isNaN(ref.getTime())) return true;
  const at = new Date(spentOn);
  if (Number.isNaN(at.getTime())) return false;

  if (filter.period === 'day') {
    return (
      at.getFullYear() === ref.getFullYear() &&
      at.getMonth() === ref.getMonth() &&
      at.getDate() === ref.getDate()
    );
  }
  if (filter.period === 'week') {
    const start = startOfWeek(ref);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return at >= start && at < end;
  }
  if (filter.period === 'month') {
    return at.getFullYear() === ref.getFullYear() && at.getMonth() === ref.getMonth();
  }
  if (filter.period === 'year') {
    return at.getFullYear() === ref.getFullYear();
  }
  return true;
}

function categoryLabel(value: ExpenseCategory): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function subCategoryLabel(value: string): string {
  return MAINTENANCE_SUBCATEGORIES.find((s) => s.value === value)?.label ?? value;
}

function formatMoney(amount: number, currency = 'INR'): string {
  const normalized = currency.toUpperCase();
  const locale = normalized === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: normalized,
    maximumFractionDigits: 0,
  }).format(amount);
}

function parseCustomFrequency(notes?: string): string {
  if (!notes) return '';
  const normalized = notes.trim();
  if (!normalized.toLowerCase().startsWith(CUSTOM_FREQ_PREFIX)) return '';
  return normalized.slice(CUSTOM_FREQ_PREFIX.length).trim();
}

function formatExpenseTitle(title: string): string {
  return title
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

type FinanceOp =
  | {
      op: 'add_expense';
      title: string;
      amount: number;
      bucket: ExpenseBucket;
      category: ExpenseCategory;
      subCategory?: string;
      frequency?: ExpenseCadence;
      cadence?: ExpenseCadence;
      spentOn: string;
      notes?: string;
    }
  | { op: 'remove_expense'; expenseId: string }
  | { op: 'bulk_add_expenses'; expenses: unknown[] }
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

function ExpenseRow({
  item,
  onRemove,
  showFrequency,
}: {
  item: ExpenseEntry;
  onRemove: (id: string) => void;
  showFrequency: boolean;
}) {
  const customFrequency = parseCustomFrequency(item.notes);
  const frequencyLabel =
    item.cadence === 'custom' && customFrequency ? `Custom (${customFrequency})` : item.cadence;

  return (
    <li className="lift-card">
      <div className="min-w-0">
        <p className="truncate font-extrabold text-duored-ink">{formatExpenseTitle(item.title)}</p>
        <div className="text-xs text-duored-muted">
          {showFrequency && <p>Freq: {frequencyLabel}</p>}
          <p>{new Date(item.spentOn).toLocaleDateString()}</p>
          <p>
            {categoryLabel(item.category)}
            {item.category === 'maintenance' && item.subCategory
              ? ` › ${subCategoryLabel(item.subCategory)}`
              : ''}
          </p>
        </div>
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
        <p className="mt-1 text-xs font-semibold text-duored-muted">Source: {item.sourcePlatform || 'Online Store'}</p>
        <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-duored-link underline">
          {item.url}
        </a>
        {item.notes && <p className="mt-1 text-xs text-duored-muted">{item.notes}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="chip-price">{formatMoney(item.price, item.currency || 'INR')}</span>
        <button className="chip-soft" onClick={() => onMove(item.id, 'up')} disabled={index === 0} type="button">
          Up
        </button>
        <button className="chip-soft" onClick={() => onMove(item.id, 'down')} disabled={index === length - 1} type="button">
          Down
        </button>
        <button className="chip-danger" onClick={() => onRemove(item.id)} type="button">
          Remove
        </button>
      </div>
    </li>
  );
}

function ExpenseGroupedList({
  expenses,
  filter,
  showFrequency,
  onRemove,
}: {
  expenses: ExpenseEntry[];
  filter: FilterState;
  showFrequency: boolean;
  onRemove: (id: string) => void;
}) {
  const filtered = useMemo(
    () => expenses.filter((e) => matchesFilter(e.spentOn, filter)),
    [expenses, filter],
  );

  const grouped = useMemo(() => {
    const byCategory = new Map<ExpenseCategory, ExpenseEntry[]>();
    for (const entry of filtered) {
      const list = byCategory.get(entry.category);
      if (list) list.push(entry);
      else byCategory.set(entry.category, [entry]);
    }
    const order: ExpenseCategory[] = EXPENSE_CATEGORIES.map((c) => c.value);
    return order
      .map((cat) => ({ category: cat, items: byCategory.get(cat) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  if (filtered.length === 0) {
    return <p className="font-semibold text-duored-muted">No expenses match this filter.</p>;
  }

  return (
    <div className="space-y-4">
      {grouped.map(({ category, items }) => {
        const total = items.reduce((sum, e) => sum + e.amount, 0);
        return (
          <div key={category} className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-extrabold uppercase tracking-[0.12em] text-duored-deep">
                {categoryLabel(category)} ({items.length})
              </h4>
              <span className="text-xs font-bold text-duored-muted">{formatMoney(total)}</span>
            </div>
            {category === 'maintenance' ? (
              <MaintenanceSubGroups items={items} showFrequency={showFrequency} onRemove={onRemove} />
            ) : (
              <ul className="space-y-2">
                {items.map((entry) => (
                  <ExpenseRow
                    key={entry.id}
                    item={entry}
                    onRemove={onRemove}
                    showFrequency={showFrequency}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MaintenanceSubGroups({
  items,
  showFrequency,
  onRemove,
}: {
  items: ExpenseEntry[];
  showFrequency: boolean;
  onRemove: (id: string) => void;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, ExpenseEntry[]>();
    for (const entry of items) {
      const key = entry.subCategory || '_unset';
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    const ordered: Array<{ key: string; label: string; items: ExpenseEntry[] }> = [];
    for (const sub of MAINTENANCE_SUBCATEGORIES) {
      const list = map.get(sub.value);
      if (list && list.length) ordered.push({ key: sub.value, label: sub.label, items: list });
    }
    const unset = map.get('_unset');
    if (unset && unset.length) ordered.push({ key: '_unset', label: 'Uncategorized', items: unset });
    return ordered;
  }, [items]);

  return (
    <div className="space-y-2 pl-2">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-duored-muted">
            ↳ {bucket.label} ({bucket.items.length})
          </p>
          <ul className="space-y-2">
            {bucket.items.map((entry) => (
              <ExpenseRow
                key={entry.id}
                item={entry}
                onRemove={onRemove}
                showFrequency={showFrequency}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ExpenseEditor({
  bucket,
  title,
  infoText,
  form,
  setForm,
  expenses,
  isPending,
  customFrequencyOptions,
  onAddExpense,
  onRemoveExpense,
  filter,
  setFilter,
  headerAction,
}: {
  bucket: ExpenseBucket;
  title: string;
  infoText?: string;
  form: ExpenseFormState;
  setForm: Dispatch<SetStateAction<ExpenseFormState>>;
  expenses: ExpenseEntry[];
  isPending: boolean;
  customFrequencyOptions: string[];
  onAddExpense: () => void;
  onRemoveExpense: (expenseId: string) => void;
  filter: FilterState;
  setFilter: Dispatch<SetStateAction<FilterState>>;
  headerAction?: ReactNode;
}) {
  const supportsFrequency = bucket === 'predicted';

  return (
    <section className="card-panel">
      <div className="flex items-center gap-2">
        <h2 className="section-title">{title}</h2>
        {infoText && (
          <button className="chip-soft h-6 w-6 p-0 text-center font-extrabold" type="button" title={infoText} aria-label={infoText}>
            i
          </button>
        )}
        {headerAction && <div className="ml-auto">{headerAction}</div>}
      </div>

      <h3 className="mb-2 mt-1 text-sm font-bold uppercase tracking-[0.16em] text-duored-muted">add_expense</h3>
      <div className="grid gap-2 md:grid-cols-2">
        <input
          className="text-input"
          value={form.title}
          onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
          placeholder="Expense name"
        />
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          value={form.amount}
          onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
          placeholder="Price"
        />
        <select
          className="text-input"
          value={form.category}
          onChange={(e) =>
            setForm((s) => ({
              ...s,
              category: e.target.value as ExpenseCategory,
              subCategory: e.target.value === 'maintenance' ? s.subCategory : '',
            }))
          }
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {form.category === 'maintenance' && (
          <select
            className="text-input"
            value={form.subCategory}
            onChange={(e) => setForm((s) => ({ ...s, subCategory: e.target.value }))}
          >
            <option value="">Subcategory (optional)</option>
            {MAINTENANCE_SUBCATEGORIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {supportsFrequency && (
          <>
            <select
              className="text-input"
              value={form.frequency}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  mode: 'repetitive',
                  frequency: e.target.value as '' | ExpenseCadence,
                }))
              }
            >
              <option value="">Frequency of purchase</option>
              {EXPENSE_CADENCE_OPTIONS.filter((item) => item.value !== 'one-time').map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            {form.frequency === 'custom' ? (
              <input
                className="text-input"
                value={form.customFrequency}
                onChange={(e) => setForm((s) => ({ ...s, customFrequency: e.target.value }))}
                placeholder="Custom frequency (for example: every 45 days)"
                list={`custom-frequency-${bucket}`}
              />
            ) : (
              <div className="text-xs font-semibold text-duored-muted">
                Frequency is reusable when you choose custom and save a label.
              </div>
            )}
          </>
        )}
      </div>

      <button className="btn-duored mt-3" disabled={isPending} onClick={onAddExpense} type="button">
        Add expense
      </button>

      <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-[0.16em] text-duored-muted">expense_list</h3>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-duored-muted">Filter</span>
        <select
          className="text-input"
          value={filter.period}
          onChange={(e) => setFilter((s) => ({ ...s, period: e.target.value as FilterPeriod }))}
        >
          <option value="all">All time</option>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
        </select>
        {filter.period !== 'all' && (
          <input
            type="date"
            className="text-input"
            value={filter.reference}
            onChange={(e) => setFilter((s) => ({ ...s, reference: e.target.value }))}
          />
        )}
      </div>

      <ExpenseGroupedList
        expenses={expenses}
        filter={filter}
        showFrequency={supportsFrequency}
        onRemove={onRemoveExpense}
      />

      <datalist id={`custom-frequency-${bucket}`}>
        {customFrequencyOptions.map((option) => (
          <option key={`${bucket}-${option}`} value={option} />
        ))}
      </datalist>
    </section>
  );
}

export function FinanceClient({ initialState, mode }: { initialState: FinanceStore; mode: 'dashboard' | 'wishlist' }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const summary = useMemo(() => summarizeFinance(state), [state]);
  const affordableSet = useMemo(() => new Set(summary.affordableItemIds), [summary.affordableItemIds]);

  const [predictedForm, setPredictedForm] = useState(createExpenseForm);
  const [actualForm, setActualForm] = useState(createExpenseForm);
  const [predictedFilter, setPredictedFilter] = useState<FilterState>(createFilter);
  const [actualFilter, setActualFilter] = useState<FilterState>(createFilter);
  const [buyForm, setBuyForm] = useState({ url: '', notes: '' });
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const predictedExpenses = useMemo(
    () => state.expenses.filter((entry) => entry.bucket === 'predicted'),
    [state.expenses],
  );
  const actualExpenses = useMemo(
    () => state.expenses.filter((entry) => entry.bucket !== 'predicted'),
    [state.expenses],
  );

  const customFrequencyOptions = useMemo(() => {
    const values = new Set<string>();
    for (const entry of state.expenses) {
      if (entry.cadence !== 'custom') continue;
      const value = parseCustomFrequency(entry.notes);
      if (value) values.add(value);
    }
    return Array.from(values);
  }, [state.expenses]);

  function runMutation(payload: FinanceOp) {
    setError('');
    startTransition(() => {
      mutateFinance(payload)
        .then((next) => setState(next))
        .catch((e) => setError((e as Error).message));
    });
  }

  function addExpense(bucket: ExpenseBucket, form: ExpenseFormState, setForm: Dispatch<SetStateAction<ExpenseFormState>>) {
    if (!form.title.trim()) {
      setError('Expense name is required');
      return;
    }

    const amount = Number(form.amount || '0');
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Expense price must be greater than 0');
      return;
    }

    if (bucket === 'predicted' && !form.frequency) {
      setError('Select a frequency for predicted expenses');
      return;
    }

    if (bucket === 'predicted' && form.frequency === 'custom' && !form.customFrequency.trim()) {
      setError('Add a custom frequency label so you can reuse it');
      return;
    }

    const cadence: ExpenseCadence =
      bucket === 'actual' ? 'one-time' : (form.frequency as ExpenseCadence);
    const notes = cadence === 'custom' ? `${CUSTOM_FREQ_PREFIX}${form.customFrequency.trim()}` : undefined;

    const subCategory =
      form.category === 'maintenance' && form.subCategory ? form.subCategory : undefined;

    runMutation({
      op: 'add_expense',
      title: form.title,
      amount,
      bucket,
      category: form.category,
      subCategory,
      frequency: cadence,
      spentOn: new Date().toISOString().slice(0, 10),
      notes,
    });

    setForm(createExpenseForm);
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p>}

      {mode === 'dashboard' && (
        <>
          <ExpenseEditor
            bucket="predicted"
            title="Predicted"
            infoText="Use this for planned periodic expenses, including long-gap items like yearly car insurance."
            form={predictedForm}
            setForm={setPredictedForm}
            expenses={predictedExpenses}
            isPending={isPending}
            customFrequencyOptions={customFrequencyOptions}
            onAddExpense={() => addExpense('predicted', predictedForm, setPredictedForm)}
            onRemoveExpense={(expenseId) => runMutation({ op: 'remove_expense', expenseId })}
            filter={predictedFilter}
            setFilter={setPredictedFilter}
          />
          <ExpenseEditor
            bucket="actual"
            title="Actuals"
            infoText="Use this for real spending logs: periodic expenses plus one-timers."
            form={actualForm}
            setForm={setActualForm}
            expenses={actualExpenses}
            isPending={isPending}
            customFrequencyOptions={customFrequencyOptions}
            onAddExpense={() => addExpense('actual', actualForm, setActualForm)}
            onRemoveExpense={(expenseId) => runMutation({ op: 'remove_expense', expenseId })}
            filter={actualFilter}
            setFilter={setActualFilter}
            headerAction={
              <CsvImportButton
                isPending={isPending}
                status={importStatus}
                onParsed={(expenses) => {
                  if (expenses.length === 0) { setImportStatus('No valid expenses found.'); return; }
                  setImportStatus(null);
                  runMutation({ op: 'bulk_add_expenses', expenses });
                  setImportStatus(`${expenses.length} imported`);
                }}
              />
            }
          />
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
