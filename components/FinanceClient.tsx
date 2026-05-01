'use client';

import { type Dispatch, type PointerEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { ItemAvatar } from '@/components/ItemAvatar';
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

type FilterPeriod = 'all' | 'day' | 'week' | 'month' | 'year';

type ActualFilter = {
  kind: 'actual';
  period: FilterPeriod;
  reference: string;
};

type PredictedFilter = {
  kind: 'predicted';
  cadence: ExpenseCadence | 'all';
};

type FilterState = ActualFilter | PredictedFilter;

type ClearDialogState = {
  bucket: ExpenseBucket;
  challenge: string;
  label: string;
} | null;

type ExpenseDragState = {
  item: ExpenseEntry;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type ExpenseDragStart = Omit<ExpenseDragState, 'item'> & {
  item: ExpenseEntry;
};

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
      imageUrl?: string;
    }
  | {
      op: 'edit_expense';
      expenseId: string;
      title: string;
      amount: number;
      bucket: ExpenseBucket;
      category: ExpenseCategory;
      subCategory?: string;
      frequency?: ExpenseCadence;
      cadence?: ExpenseCadence;
      spentOn: string;
      notes?: string;
      imageUrl?: string;
    }
  | { op: 'remove_expense'; expenseId: string }
  | { op: 'move_expense'; expenseId: string; category: ExpenseCategory }
  | { op: 'clear_expenses'; bucket: ExpenseBucket }
  | { op: 'bulk_add_expenses'; expenses: unknown[] }
  | { op: 'add_buy_item'; url: string; notes?: string }
  | { op: 'remove_buy_item'; itemId: string }
  | { op: 'move_buy_item'; itemId: string; direction: 'up' | 'down' }
  | { op: 'reorder_buy_item'; itemId: string; targetIndex: number }
  | { op: 'mark_buy_item_bought'; itemId: string; category?: ExpenseCategory; subCategory?: string }
  | { op: 'remove_need_item'; itemId: string }
  | { op: 'move_need_item'; itemId: string; direction: 'up' | 'down' }
  | { op: 'mark_need_item_bought'; itemId: string; category?: ExpenseCategory; subCategory?: string }
  | { op: 'move_to_need_list'; itemId: string }
  | { op: 'move_to_buy_list'; itemId: string };

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

function createExpenseFormFromEntry(entry: ExpenseEntry): ExpenseFormState {
  return {
    title: entry.title,
    amount: String(entry.amount),
    mode: entry.cadence === 'one-time' ? 'one-time' : 'repetitive',
    frequency: entry.bucket === 'predicted' ? entry.cadence : '',
    customFrequency: entry.cadence === 'custom' ? parseCustomFrequency(entry.notes) : '',
    category: entry.category,
    subCategory: entry.subCategory ?? '',
  };
}

function createActualFilter(): ActualFilter {
  return { kind: 'actual', period: 'all', reference: new Date().toISOString().slice(0, 10) };
}

function createPredictedFilter(): PredictedFilter {
  return { kind: 'predicted', cadence: 'all' };
}

function randomChallenge(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function startOfWeek(date: Date): Date {
  const out = new Date(date);
  const day = out.getDay();
  const diff = (day + 6) % 7;
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - diff);
  return out;
}

function matchesFilter(entry: ExpenseEntry, filter: FilterState): boolean {
  if (filter.kind === 'predicted') {
    if (filter.cadence === 'all') return true;
    return entry.cadence === filter.cadence;
  }

  if (filter.period === 'all') return true;
  const ref = new Date(filter.reference);
  if (Number.isNaN(ref.getTime())) return true;
  const at = new Date(entry.spentOn);
  if (Number.isNaN(at.getTime())) return false;

  if (filter.period === 'day') {
    return at.getFullYear() === ref.getFullYear() && at.getMonth() === ref.getMonth() && at.getDate() === ref.getDate();
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
  return EXPENSE_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}

function isExpenseCategory(value: string | null): value is ExpenseCategory {
  return EXPENSE_CATEGORIES.some((category) => category.value === value);
}

function subCategoryLabel(value: string): string {
  return MAINTENANCE_SUBCATEGORIES.find((category) => category.value === value)?.label ?? value;
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

function getFrequencyLabel(item: ExpenseEntry): string {
  const customFrequency = parseCustomFrequency(item.notes);
  return item.cadence === 'custom' && customFrequency ? `Custom (${customFrequency})` : item.cadence;
}

function getVisibleExpenseNotes(item: ExpenseEntry): string | null {
  if (!item.notes) return null;
  if (item.notes.toLowerCase().startsWith(CUSTOM_FREQ_PREFIX)) return null;
  return item.notes;
}

function getReturnLabel(item: BuyListItem): string {
  if (!item.returnable) return 'Not returnable';
  const days = item.returnDays ? `${item.returnDays} day${item.returnDays === 1 ? '' : 's'}` : 'returnable';
  return item.lastReturnableOn ? `Returnable: ${days}, last date ${item.lastReturnableOn}` : `Returnable: ${days}`;
}

function platformFromProductUrl(value: string): string {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('amazon')) return 'Amazon';
    if (host.includes('flipkart')) return 'Flipkart';
    if (host.includes('myntra')) return 'Myntra';
    if (host.includes('ajio')) return 'Ajio';
    if (host.includes('meesho')) return 'Meesho';
    if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube';
    return host.split('.')[0] || 'Online Store';
  } catch {
    return 'Online Store';
  }
}

function titleFromProductUrl(value: string): string {
  try {
    const url = new URL(value);
    const segments = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment).replace(/[-_]+/g, ' ').trim())
      .filter(Boolean);
    const dpIndex = segments.findIndex((segment) => segment.toLowerCase() === 'dp');
    if (dpIndex > 0) return segments[dpIndex - 1];
    const productIndex = segments.findIndex((segment) => segment.toLowerCase() === 'p');
    if (productIndex > 0) return segments[productIndex - 1];
    return segments.at(-1)?.replace(/\.[a-z0-9]+$/i, '').trim() || 'Product';
  } catch {
    return 'Product';
  }
}

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

function SummaryCards({
  summary,
}: {
  summary: ReturnType<typeof summarizeFinance>;
}) {
  const cards = [
    { label: 'Expected / Month', value: formatMoney(summary.monthlyExpectedExpenses), tone: 'card-rose' },
    { label: 'Spent This Month', value: formatMoney(summary.currentMonthSpent), tone: 'card-amber' },
    { label: 'Avg Monthly Expense', value: formatMoney(summary.avgMonthlyExpense), tone: 'card-green' },
    { label: 'Remaining', value: formatMoney(summary.currentMonthRemaining), tone: 'card-rose' },
    { label: 'Can Buy', value: String(summary.canBuyCountThisMonth), tone: 'card-amber' },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className={`card-3d ${card.tone}`}>
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-white/80">{card.label}</p>
          <p className="mt-2 text-2xl font-black">{card.value}</p>
        </div>
      ))}
    </section>
  );
}

function ClearExpenseDialog({
  dialog,
  value,
  setValue,
  onCancel,
  onConfirm,
  isPending,
}: {
  dialog: NonNullable<ClearDialogState>;
  value: string;
  setValue: Dispatch<SetStateAction<string>>;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const matches = value.trim().toUpperCase() === dialog.challenge;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-3xl border-2 border-duored-border bg-white p-5 shadow-roseCard">
        <h3 className="text-lg font-extrabold text-duored-deep">Clear {dialog.label}</h3>
        <p className="mt-2 text-sm font-semibold text-duored-muted">
          Type <span className="rounded-md bg-duored-soft px-2 py-1 font-black text-duored-deep">{dialog.challenge}</span> to clear this full expense list.
        </p>
        <input
          className="text-input mt-4 w-full"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Enter the random string"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="chip-soft" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="chip-danger" type="button" disabled={!matches || isPending} onClick={onConfirm}>
            Clear list
          </button>
        </div>
      </div>
    </div>
  );
}

function ExpenseRow({
  item,
  onRemove,
  onEdit,
  showFrequency,
  isDragging,
  onPointerDragStart,
}: {
  item: ExpenseEntry;
  onRemove: (id: string) => void;
  onEdit: (item: ExpenseEntry) => void;
  showFrequency: boolean;
  isDragging: boolean;
  onPointerDragStart: (drag: ExpenseDragStart) => void;
}) {
  const frequencyLabel = getFrequencyLabel(item);
  const visibleNotes = getVisibleExpenseNotes(item);

  function startPointerDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const card = event.currentTarget.closest('li');
    const rect = card?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onPointerDragStart({
      item,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  return (
    <li className={`lift-card flex-col items-start sm:flex-row ${isDragging ? 'expense-card-dragging' : ''}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ItemAvatar title={item.title} imageUrl={item.imageUrl} />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-duored-ink">{formatExpenseTitle(item.title)}</p>
          <div className="text-xs text-duored-muted">
            {showFrequency && <p>Freq: {frequencyLabel}</p>}
            <p>{new Date(item.spentOn).toLocaleDateString()}</p>
            <p>
              {categoryLabel(item.category)}
              {item.category === 'maintenance' && item.subCategory ? ` > ${subCategoryLabel(item.subCategory)}` : ''}
            </p>
            {visibleNotes && <p className="mt-1 break-words">{visibleNotes}</p>}
            {item.sourceUrl && (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-duored-link underline">
                Product link{item.sourcePlatform ? ` (${item.sourcePlatform})` : ''}
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <p className="font-extrabold text-duored-deep">{formatMoney(item.amount)}</p>
        <button className="chip-soft expense-drag-handle" onPointerDown={startPointerDrag} type="button" aria-label={`Move ${item.title}`}>
          Move
        </button>
        <button className="chip-soft" onClick={() => onEdit(item)} type="button">
          Edit
        </button>
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
  isDragging,
  hideReorderButtons,
  dropPosition,
  onMove,
  onRemove,
  onBought,
  onDragStart,
  onDragEnd,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
}: {
  item: BuyListItem;
  index: number;
  length: number;
  affordable: boolean;
  isDragging: boolean;
  hideReorderButtons?: boolean;
  dropPosition?: 'before' | 'after' | null;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onRemove: (id: string) => void;
  onBought: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onItemDragOver?: (index: number, position: 'before' | 'after') => void;
  onItemDragLeave?: () => void;
  onItemDrop?: (index: number, position: 'before' | 'after') => void;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', item.id); } catch {}
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onItemDragOver ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        onItemDragOver(index, position);
      } : undefined}
      onDragLeave={onItemDragLeave ? (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onItemDragLeave();
      } : undefined}
      onDrop={onItemDrop ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const position: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        onItemDrop(index, position);
      } : undefined}
      className={`lift-card flex-col items-start sm:flex-row select-none transition-all duration-200 cursor-grab active:cursor-grabbing relative
        ${affordable ? 'ring-2 ring-emerald-300' : ''}
        ${isDragging ? 'opacity-30 scale-[0.97] shadow-none pointer-events-none' : 'opacity-100 scale-100'}
        ${dropPosition === 'before' ? 'before:absolute before:left-0 before:right-0 before:-top-1 before:h-1 before:rounded-full before:bg-indigo-500 before:shadow-[0_0_12px_rgba(99,102,241,0.7)] before:animate-pulse' : ''}
        ${dropPosition === 'after' ? 'after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-1 after:rounded-full after:bg-indigo-500 after:shadow-[0_0_12px_rgba(99,102,241,0.7)] after:animate-pulse' : ''}
      `}
    >
      <div className="mr-2 self-center text-duored-muted/50 text-lg shrink-0 hidden sm:block" aria-hidden>⠿</div>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ItemAvatar title={item.title} imageUrl={item.imageUrl} />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-duored-ink">{item.title}</p>
          <p className="mt-1 text-xs font-semibold text-duored-muted">Source: {item.sourcePlatform || 'Online Store'}</p>
          <a href={item.url} target="_blank" rel="noreferrer" draggable={false} className="block truncate text-xs text-duored-link underline">
            {item.url}
          </a>
          <p className="mt-1 text-xs font-bold text-duored-muted">{getReturnLabel(item)}</p>
          {item.notes && <p className="mt-1 text-xs text-duored-muted">{item.notes}</p>}
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <span className="chip-price">{formatMoney(item.price, item.currency || 'INR')}</span>
        <button className="btn-duored px-3 py-1 text-xs" onClick={() => onBought(item.id)} type="button">
          Mark Bought
        </button>
        {!hideReorderButtons && (
          <>
            <button className="chip-soft" onClick={() => onMove(item.id, 'up')} disabled={index === 0} type="button">
              Up
            </button>
            <button className="chip-soft" onClick={() => onMove(item.id, 'down')} disabled={index === length - 1} type="button">
              Down
            </button>
          </>
        )}
        <button className="chip-danger" onClick={() => onRemove(item.id)} type="button">
          Remove
        </button>
      </div>
    </li>
  );
}

function ExpenseListItem({
  item,
  showFrequency,
  isEditing,
  editForm,
  setEditForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRemove,
  draggedExpenseId,
  onPointerDragStart,
}: {
  item: ExpenseEntry;
  showFrequency: boolean;
  isEditing: boolean;
  editForm: ExpenseFormState | null;
  setEditForm: Dispatch<SetStateAction<ExpenseFormState | null>>;
  onStartEdit: (item: ExpenseEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (expenseId: string) => void;
  onRemove: (id: string) => void;
  draggedExpenseId: string | null;
  onPointerDragStart: (drag: ExpenseDragStart) => void;
}) {
  if (isEditing && editForm) {
    return (
      <li className="lift-card space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          <input
            className="text-input"
            value={editForm.title}
            onChange={(event) => setEditForm((state) => (state ? { ...state, title: event.target.value } : state))}
            placeholder="Expense name"
          />
          <input
            className="text-input"
            type="number"
            min="0"
            step="0.01"
            value={editForm.amount}
            onChange={(event) => setEditForm((state) => (state ? { ...state, amount: event.target.value } : state))}
            placeholder="Price"
          />
          <select
            className="text-input"
            value={editForm.category}
            onChange={(event) =>
              setEditForm((state) =>
                state
                  ? {
                      ...state,
                      category: event.target.value as ExpenseCategory,
                      subCategory: event.target.value === 'maintenance' ? state.subCategory : '',
                    }
                  : state,
              )
            }
          >
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
          {editForm.category === 'maintenance' && (
            <select
              className="text-input"
              value={editForm.subCategory}
              onChange={(event) => setEditForm((state) => (state ? { ...state, subCategory: event.target.value } : state))}
            >
              <option value="">Subcategory (optional)</option>
              {MAINTENANCE_SUBCATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          )}
          {showFrequency && (
            <>
              <select
                className="text-input"
                value={editForm.frequency}
                onChange={(event) =>
                  setEditForm((state) =>
                    state
                      ? {
                          ...state,
                          mode: 'repetitive',
                          frequency: event.target.value as '' | ExpenseCadence,
                        }
                      : state,
                  )
                }
              >
                <option value="">Frequency of purchase</option>
                {EXPENSE_CADENCE_OPTIONS.filter((option) => option.value !== 'one-time').map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {editForm.frequency === 'custom' ? (
                <input
                  className="text-input"
                  value={editForm.customFrequency}
                  onChange={(event) => setEditForm((state) => (state ? { ...state, customFrequency: event.target.value } : state))}
                  placeholder="Custom frequency (for example: every 45 days)"
                />
              ) : (
                <div className="text-xs font-semibold text-duored-muted">
                  Keep a reusable label when this purchase cadence is custom.
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-duored-muted">
            {showFrequency ? 'Edit planned expense details.' : 'Edit the logged expense details.'}
          </p>
          <div className="flex items-center gap-2">
            <button className="chip-soft" onClick={onCancelEdit} type="button">
              Cancel
            </button>
            <button className="btn-duored" onClick={() => onSaveEdit(item.id)} type="button">
              Save
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <ExpenseRow
      item={item}
      onEdit={onStartEdit}
      onRemove={onRemove}
      showFrequency={showFrequency}
      isDragging={draggedExpenseId === item.id}
      onPointerDragStart={onPointerDragStart}
    />
  );
}

function MaintenanceSubGroups({
  items,
  showFrequency,
  editingExpenseId,
  editForm,
  setEditForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRemove,
  draggedExpenseId,
  onPointerDragStart,
}: {
  items: ExpenseEntry[];
  showFrequency: boolean;
  editingExpenseId: string | null;
  editForm: ExpenseFormState | null;
  setEditForm: Dispatch<SetStateAction<ExpenseFormState | null>>;
  onStartEdit: (item: ExpenseEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (expenseId: string) => void;
  onRemove: (id: string) => void;
  draggedExpenseId: string | null;
  onPointerDragStart: (drag: ExpenseDragStart) => void;
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
    for (const subCategory of MAINTENANCE_SUBCATEGORIES) {
      const list = map.get(subCategory.value);
      if (list && list.length) ordered.push({ key: subCategory.value, label: subCategory.label, items: list });
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
            - {bucket.label} ({bucket.items.length})
          </p>
          <ul className="space-y-2">
            {bucket.items.map((entry) => (
              <ExpenseListItem
                key={entry.id}
                item={entry}
                showFrequency={showFrequency}
                isEditing={editingExpenseId === entry.id}
                editForm={editForm}
                setEditForm={setEditForm}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onSaveEdit={onSaveEdit}
                onRemove={onRemove}
                draggedExpenseId={draggedExpenseId}
                onPointerDragStart={onPointerDragStart}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ExpenseGroupedList({
  expenses,
  filter,
  showFrequency,
  editingExpenseId,
  editForm,
  setEditForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRemove,
  draggedExpenseId,
  dragOverCategory,
  onPointerDragStart,
}: {
  expenses: ExpenseEntry[];
  filter: FilterState;
  showFrequency: boolean;
  editingExpenseId: string | null;
  editForm: ExpenseFormState | null;
  setEditForm: Dispatch<SetStateAction<ExpenseFormState | null>>;
  onStartEdit: (item: ExpenseEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (expenseId: string) => void;
  onRemove: (id: string) => void;
  draggedExpenseId: string | null;
  dragOverCategory: ExpenseCategory | null;
  onPointerDragStart: (drag: ExpenseDragStart) => void;
}) {
  const filtered = useMemo(() => expenses.filter((entry) => matchesFilter(entry, filter)), [expenses, filter]);
  const grouped = useMemo(() => {
    const byCategory = new Map<ExpenseCategory, ExpenseEntry[]>();
    for (const entry of filtered) {
      const list = byCategory.get(entry.category);
      if (list) list.push(entry);
      else byCategory.set(entry.category, [entry]);
    }
    return EXPENSE_CATEGORIES.map((category) => ({
      category: category.value,
      items: byCategory.get(category.value) ?? [],
    }));
  }, [filtered]);

  if (filtered.length === 0) {
    return <p className="font-semibold text-duored-muted">No expenses match this filter.</p>;
  }

  function renderCategoryBlock(category: ExpenseCategory, items: ExpenseEntry[]) {
    const isSavings = category === 'savings';
    const total = items.reduce((sum, entry) => sum + entry.amount, 0);
    const isDropActive = draggedExpenseId !== null && dragOverCategory === category;

    return (
      <div
        key={category}
        data-expense-category={category}
        className={[
          'space-y-2 rounded-2xl border bg-white/60 p-3 transition-colors',
          isDropActive ? 'border-duored-main bg-duored-soft/40' : 'border-duored-soft/70',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-extrabold uppercase tracking-[0.12em] text-duored-deep">
              {categoryLabel(category)} ({items.length})
            </h4>
            {isSavings && (
              <button
                className="chip-soft h-6 w-6 p-0 text-center font-extrabold"
                type="button"
                title="Transfer to saving acct/ purchase of gold"
                aria-label="Transfer to saving acct/ purchase of gold"
              >
                i
              </button>
            )}
          </div>
          <span className="text-xs font-bold text-duored-muted">{formatMoney(total)}</span>
        </div>

        {items.length === 0 ? (
          <p className="text-sm font-semibold text-duored-muted">Drop an expense here.</p>
        ) : category === 'maintenance' ? (
          <MaintenanceSubGroups
            items={items}
            showFrequency={showFrequency}
            editingExpenseId={editingExpenseId}
            editForm={editForm}
            setEditForm={setEditForm}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSaveEdit={onSaveEdit}
            onRemove={onRemove}
            draggedExpenseId={draggedExpenseId}
            onPointerDragStart={onPointerDragStart}
          />
        ) : (
          <ul className="space-y-2">
            {items.map((entry) => (
              <ExpenseListItem
                key={entry.id}
                item={entry}
                showFrequency={showFrequency}
                isEditing={editingExpenseId === entry.id}
                editForm={editForm}
                setEditForm={setEditForm}
                onStartEdit={onStartEdit}
                onCancelEdit={onCancelEdit}
                onSaveEdit={onSaveEdit}
                onRemove={onRemove}
                draggedExpenseId={draggedExpenseId}
                onPointerDragStart={onPointerDragStart}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (filter.kind === 'actual') {
    return <div className="grid gap-4 lg:grid-cols-3">{grouped.map(({ category, items }) => renderCategoryBlock(category, items))}</div>;
  }

  return <div className="space-y-4">{grouped.map(({ category, items }) => renderCategoryBlock(category, items))}</div>;
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
  editingExpenseId,
  editForm,
  setEditForm,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRemoveExpense,
  onRequestClear,
  filter,
  setFilter,
  headerAction,
  draggedExpenseId,
  dragOverCategory,
  onPointerDragStart,
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
  editingExpenseId: string | null;
  editForm: ExpenseFormState | null;
  setEditForm: Dispatch<SetStateAction<ExpenseFormState | null>>;
  onStartEdit: (item: ExpenseEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (expenseId: string) => void;
  onRemoveExpense: (expenseId: string) => void;
  onRequestClear: () => void;
  filter: FilterState;
  setFilter: Dispatch<SetStateAction<FilterState>>;
  headerAction?: ReactNode;
  draggedExpenseId: string | null;
  dragOverCategory: ExpenseCategory | null;
  onPointerDragStart: (drag: ExpenseDragStart) => void;
}) {
  const supportsFrequency = bucket === 'predicted';

  return (
    <section className="card-panel w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title mb-0">{title}</h2>
        {infoText && (
          <button className="chip-soft h-6 w-6 p-0 text-center font-extrabold" type="button" title={infoText} aria-label={infoText}>
            i
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {headerAction}
          <button className="chip-danger" type="button" onClick={onRequestClear}>
            Clear list
          </button>
        </div>
      </div>

      <h3 className="mb-2 mt-4 text-sm font-bold uppercase tracking-[0.16em] text-duored-muted">add_expense</h3>
      <div className="grid gap-2 md:grid-cols-2">
        <input
          className="text-input"
          value={form.title}
          onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))}
          placeholder="Expense name"
        />
        <input
          className="text-input"
          type="number"
          min="0"
          step="0.01"
          value={form.amount}
          onChange={(event) => setForm((state) => ({ ...state, amount: event.target.value }))}
          placeholder="Price"
        />
        <select
          className="text-input"
          value={form.category}
          onChange={(event) =>
            setForm((state) => ({
              ...state,
              category: event.target.value as ExpenseCategory,
              subCategory: event.target.value === 'maintenance' ? state.subCategory : '',
            }))
          }
        >
          {EXPENSE_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
        {form.category === 'maintenance' && (
          <select
            className="text-input"
            value={form.subCategory}
            onChange={(event) => setForm((state) => ({ ...state, subCategory: event.target.value }))}
          >
            <option value="">Subcategory (optional)</option>
            {MAINTENANCE_SUBCATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        )}
        {supportsFrequency && (
          <>
            <select
              className="text-input"
              value={form.frequency}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  mode: 'repetitive',
                  frequency: event.target.value as '' | ExpenseCadence,
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
                onChange={(event) => setForm((state) => ({ ...state, customFrequency: event.target.value }))}
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
        {filter.kind === 'predicted' ? (
          <select
            className="text-input"
            value={filter.cadence}
            onChange={(event) => setFilter({ kind: 'predicted', cadence: event.target.value as ExpenseCadence | 'all' })}
          >
            <option value="all">All frequencies</option>
            {EXPENSE_CADENCE_OPTIONS.filter((item) => item.value !== 'one-time').map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select
              className="text-input"
              value={filter.period}
              onChange={(event) =>
                setFilter({
                  kind: 'actual',
                  period: event.target.value as FilterPeriod,
                  reference: filter.reference,
                })
              }
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
                onChange={(event) => setFilter({ kind: 'actual', period: filter.period, reference: event.target.value })}
              />
            )}
          </>
        )}
      </div>

      <ExpenseGroupedList
        expenses={expenses}
        filter={filter}
        showFrequency={supportsFrequency}
        editingExpenseId={editingExpenseId}
        editForm={editForm}
        setEditForm={setEditForm}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onSaveEdit={onSaveEdit}
        onRemove={onRemoveExpense}
        draggedExpenseId={draggedExpenseId}
        dragOverCategory={dragOverCategory}
        onPointerDragStart={onPointerDragStart}
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
  const [isPending, setIsPending] = useState(false);
  const summary = useMemo(() => summarizeFinance(state), [state]);
  const affordableSet = useMemo(() => new Set(summary.affordableItemIds), [summary.affordableItemIds]);

  const [predictedForm, setPredictedForm] = useState(createExpenseForm);
  const [actualForm, setActualForm] = useState(createExpenseForm);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingExpenseForm, setEditingExpenseForm] = useState<ExpenseFormState | null>(null);
  const [predictedFilter, setPredictedFilter] = useState<FilterState>(createPredictedFilter);
  const [actualFilter, setActualFilter] = useState<FilterState>(createActualFilter);
  const [buyForm, setBuyForm] = useState({ url: '', notes: '' });
  const [wishlistDrag, setWishlistDrag] = useState<{ itemId: string; fromList: 'need' | 'buy' } | null>(null);
  const [wishlistDropTarget, setWishlistDropTarget] = useState<'need' | 'buy' | null>(null);
  const [buyDropIndicator, setBuyDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [draggedExpenseId, setDraggedExpenseId] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<ExpenseCategory | null>(null);
  const [dragState, setDragState] = useState<ExpenseDragState | null>(null);
  const dragStateRef = useRef<ExpenseDragState | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement | null>(null);
  const dragOverCategoryRef = useRef<ExpenseCategory | null>(null);
  const nextDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const [clearDialog, setClearDialog] = useState<ClearDialogState>(null);
  const [clearInput, setClearInput] = useState('');

  const predictedExpenses = useMemo(() => state.expenses.filter((entry) => entry.bucket === 'predicted'), [state.expenses]);
  const actualExpenses = useMemo(() => state.expenses.filter((entry) => entry.bucket !== 'predicted'), [state.expenses]);

  const customFrequencyOptions = useMemo(() => {
    const values = new Set<string>();
    for (const entry of state.expenses) {
      if (entry.cadence !== 'custom') continue;
      const value = parseCustomFrequency(entry.notes);
      if (value) values.add(value);
    }
    return Array.from(values);
  }, [state.expenses]);

  function paintDragOverlay(x: number, y: number) {
    const current = dragStateRef.current;
    const overlay = dragOverlayRef.current;
    if (!current || !overlay) return;
    overlay.style.transform = `translate3d(${x - current.offsetX}px, ${y - current.offsetY}px, 0)`;
  }

  function categoryFromPoint(x: number, y: number): ExpenseCategory | null {
    const target = document.elementFromPoint(x, y);
    const categoryNode = target?.closest<HTMLElement>('[data-expense-category]');
    const category = categoryNode?.dataset.expenseCategory ?? null;
    return isExpenseCategory(category) ? category : null;
  }

  useEffect(() => {
    if (!dragState) return;

    dragStateRef.current = dragState;
    dragOverCategoryRef.current = dragOverCategory;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    paintDragOverlay(dragState.x, dragState.y);

    function schedulePaint() {
      if (dragFrameRef.current !== null) return;
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const nextPosition = nextDragPositionRef.current;
        if (!nextPosition) return;
        paintDragOverlay(nextPosition.x, nextPosition.y);
      });
    }

    function onPointerMove(event: globalThis.PointerEvent) {
      const current = dragStateRef.current;
      if (!current) return;
      nextDragPositionRef.current = { x: event.clientX, y: event.clientY };
      schedulePaint();

      const nextCategory = categoryFromPoint(event.clientX, event.clientY);
      if (nextCategory !== dragOverCategoryRef.current) {
        dragOverCategoryRef.current = nextCategory;
        setDragOverCategory(nextCategory);
      }
    }

    function finishDrag(event: globalThis.PointerEvent) {
      const current = dragStateRef.current;
      if (!current) return;

      const finalCategory = categoryFromPoint(event.clientX, event.clientY) ?? dragOverCategoryRef.current;
      if (finalCategory && finalCategory !== current.item.category) {
        moveExpense(current.item.id, finalCategory);
      }

      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      nextDragPositionRef.current = null;
      dragStateRef.current = null;
      dragOverCategoryRef.current = null;
      setDraggedExpenseId(null);
      setDragOverCategory(null);
      setDragState(null);
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
    };
  }, [dragOverCategory, dragState]);

  function runMutation(payload: FinanceOp, optimistic?: (current: FinanceStore) => FinanceStore) {
    setError('');
    const snapshot = state;
    if (optimistic) {
      setState((current) => optimistic(current));
    }
    setIsPending(true);
    mutateFinance(payload)
      .then((next) => setState(next))
      .catch((nextError) => {
        if (optimistic) setState(snapshot);
        setError((nextError as Error).message);
      })
      .finally(() => setIsPending(false));
  }

  function beginEditingExpense(item: ExpenseEntry) {
    setEditingExpenseId(item.id);
    setEditingExpenseForm(createExpenseFormFromEntry(item));
  }

  function stopEditingExpense() {
    setEditingExpenseId(null);
    setEditingExpenseForm(null);
  }

  function requestClear(bucket: ExpenseBucket, label: string) {
    setClearInput('');
    setClearDialog({ bucket, label, challenge: randomChallenge() });
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

    const cadence: ExpenseCadence = bucket === 'actual' ? 'one-time' : (form.frequency as ExpenseCadence);
    const notes = cadence === 'custom' ? `${CUSTOM_FREQ_PREFIX}${form.customFrequency.trim()}` : undefined;
    const subCategory = form.category === 'maintenance' && form.subCategory ? form.subCategory : undefined;

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

  function saveEditedExpense(expenseId: string) {
    const form = editingExpenseForm;
    const existing = state.expenses.find((entry) => entry.id === expenseId);
    if (!form || !existing) {
      setError('Expense to edit was not found');
      return;
    }

    if (!form.title.trim()) {
      setError('Expense name is required');
      return;
    }

    const amount = Number(form.amount || '0');
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Expense price must be greater than 0');
      return;
    }

    if (existing.bucket === 'predicted' && !form.frequency) {
      setError('Select a frequency for predicted expenses');
      return;
    }

    if (existing.bucket === 'predicted' && form.frequency === 'custom' && !form.customFrequency.trim()) {
      setError('Add a custom frequency label so you can reuse it');
      return;
    }

    const cadence: ExpenseCadence = existing.bucket === 'actual' ? 'one-time' : (form.frequency as ExpenseCadence);
    const notes = cadence === 'custom' ? `${CUSTOM_FREQ_PREFIX}${form.customFrequency.trim()}` : undefined;
    const subCategory = form.category === 'maintenance' && form.subCategory ? form.subCategory : undefined;

    runMutation({
      op: 'edit_expense',
      expenseId,
      title: form.title,
      amount,
      bucket: existing.bucket,
      category: form.category,
      subCategory,
      frequency: cadence,
      spentOn: existing.spentOn,
      notes,
      imageUrl: existing.imageUrl,
    });

    stopEditingExpense();
  }

  function moveExpense(expenseId: string, category: ExpenseCategory) {
    runMutation(
      { op: 'move_expense', expenseId, category },
      (current) => ({
        ...current,
        expenses: current.expenses.map((entry) =>
          entry.id === expenseId
            ? {
                ...entry,
                category,
                subCategory: category === 'maintenance' ? entry.subCategory : undefined,
              }
            : entry,
        ),
      }),
    );
  }

  function startExpenseDrag(drag: ExpenseDragStart) {
    setEditingExpenseId(null);
    setEditingExpenseForm(null);
    setDraggedExpenseId(drag.item.id);
    setDragOverCategory(drag.item.category);
    dragOverCategoryRef.current = drag.item.category;
    dragStateRef.current = drag;
    setDragState(drag);
  }

  return (
    <div className={`space-y-6 ${dragState ? 'expense-board-dragging' : ''}`}>
      {dragState && (
        <div
          ref={dragOverlayRef}
          className="expense-drag-overlay flex items-center justify-between gap-3"
          style={{
            width: dragState.width,
            minHeight: dragState.height,
            transform: `translate3d(${dragState.x - dragState.offsetX}px, ${dragState.y - dragState.offsetY}px, 0)`,
          }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <ItemAvatar title={dragState.item.title} imageUrl={dragState.item.imageUrl} />
            <div className="min-w-0">
              <p className="truncate font-extrabold text-duored-ink">{formatExpenseTitle(dragState.item.title)}</p>
              <p className="text-xs font-bold text-duored-muted">{categoryLabel(dragState.item.category)}</p>
            </div>
          </div>
          <p className="shrink-0 font-extrabold text-duored-deep">{formatMoney(dragState.item.amount)}</p>
        </div>
      )}
      {clearDialog && (
        <ClearExpenseDialog
          dialog={clearDialog}
          value={clearInput}
          setValue={setClearInput}
          onCancel={() => {
            setClearDialog(null);
            setClearInput('');
          }}
          onConfirm={() => {
            runMutation({ op: 'clear_expenses', bucket: clearDialog.bucket });
            setClearDialog(null);
            setClearInput('');
          }}
          isPending={isPending}
        />
      )}

      {error && <p className="rounded-xl border-2 border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p>}

      {mode === 'dashboard' && <SummaryCards summary={summary} />}

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
            editingExpenseId={editingExpenseId}
            editForm={editingExpenseForm}
            setEditForm={setEditingExpenseForm}
            onStartEdit={beginEditingExpense}
            onCancelEdit={stopEditingExpense}
            onSaveEdit={saveEditedExpense}
            onRemoveExpense={(expenseId) => runMutation({ op: 'remove_expense', expenseId })}
            onRequestClear={() => requestClear('predicted', 'Predicted Expenses')}
            filter={predictedFilter}
            setFilter={setPredictedFilter}
            draggedExpenseId={draggedExpenseId}
            dragOverCategory={dragOverCategory}
            onPointerDragStart={startExpenseDrag}
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
            editingExpenseId={editingExpenseId}
            editForm={editingExpenseForm}
            setEditForm={setEditingExpenseForm}
            onStartEdit={beginEditingExpense}
            onCancelEdit={stopEditingExpense}
            onSaveEdit={saveEditedExpense}
            onRemoveExpense={(expenseId) => runMutation({ op: 'remove_expense', expenseId })}
            onRequestClear={() => requestClear('actual', 'Actual Expenses')}
            filter={actualFilter}
            setFilter={setActualFilter}
            headerAction={
              <CsvImportButton
                isPending={isPending}
                status={importStatus}
                onParsed={(expenses) => {
                  if (expenses.length === 0) {
                    setImportStatus('No valid expenses found.');
                    return;
                  }
                  setImportStatus(null);
                  runMutation({ op: 'bulk_add_expenses', expenses });
                  setImportStatus(`${expenses.length} imported`);
                }}
              />
            }
            draggedExpenseId={draggedExpenseId}
            dragOverCategory={dragOverCategory}
            onPointerDragStart={startExpenseDrag}
          />
        </>
      )}

      {mode === 'wishlist' && (
        <>
          <section className="card-panel">
            <h2 className="section-title">Add to buy-list</h2>
            <p className="mb-2 text-sm font-semibold text-duored-muted">
              Paste only the product link. Name, price, source platform, and product image are extracted automatically.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="text-input md:col-span-2"
                value={buyForm.url}
                onChange={(event) => setBuyForm((state) => ({ ...state, url: event.target.value }))}
                placeholder="Paste product link from Amazon / Flipkart / Myntra / etc."
              />
              <input
                className="text-input md:col-span-2"
                value={buyForm.notes}
                onChange={(event) => setBuyForm((state) => ({ ...state, notes: event.target.value }))}
                placeholder="Optional note"
              />
            </div>
            <button
              className="btn-duored mt-3"
              disabled={isPending}
              onClick={() => {
                const url = buyForm.url.trim();
                const notes = buyForm.notes.trim();
                runMutation(
                  {
                    op: 'add_buy_item',
                    url,
                    notes,
                  },
                  (current) => {
                    const item: BuyListItem = {
                      id: `optimistic-buy-${Date.now()}`,
                      title: titleFromProductUrl(url),
                      url,
                      price: 0,
                      sourcePlatform: platformFromProductUrl(url),
                      currency: 'INR',
                      notes: notes || 'Fetching product details...',
                      createdAt: new Date().toISOString(),
                      returnable: false,
                    };
                    return { ...current, buyList: [...current.buyList, item] };
                  },
                );
                setBuyForm({ url: '', notes: '' });
              }}
              type="button"
            >
              Add item from link
            </button>
          </section>

          <section className="card-panel">
            <h2 className="section-title">Actually Need</h2>
            <p className="mb-3 text-sm font-semibold text-duored-muted">
              Items you genuinely need. Drag to Priority list below if it can wait.
            </p>
            <div
              className={`relative min-h-[72px] rounded-xl p-1 transition-all duration-200
                ${wishlistDropTarget === 'need' && wishlistDrag?.fromList === 'buy'
                  ? 'ring-2 ring-indigo-400 bg-indigo-50/60 shadow-inner'
                  : ''}
              `}
              onDragOver={(e) => { if (wishlistDrag?.fromList === 'buy') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
              onDragEnter={(e) => { if (wishlistDrag?.fromList === 'buy') { e.preventDefault(); setWishlistDropTarget('need'); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setWishlistDropTarget(null); }}
              onDrop={(e) => {
                e.preventDefault();
                const src = wishlistDrag;
                setWishlistDropTarget(null);
                setWishlistDrag(null);
                if (!src || src.fromList !== 'buy') return;
                runMutation(
                  { op: 'move_to_need_list', itemId: src.itemId },
                  (current) => {
                    const item = current.buyList.find((entry) => entry.id === src.itemId);
                    if (!item) return current;
                    return {
                      ...current,
                      buyList: current.buyList.filter((entry) => entry.id !== src.itemId),
                      needList: [item, ...current.needList],
                    };
                  },
                );
              }}
            >
              {wishlistDropTarget === 'need' && wishlistDrag?.fromList === 'buy' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 rounded-xl">
                  <span className="animate-bounce text-sm font-bold text-indigo-600 bg-white/90 rounded-full px-4 py-2 shadow-lg ring-1 ring-indigo-300">
                    ↑ Drop here to mark as Actually Need
                  </span>
                </div>
              )}
              {state.needList.length === 0 && wishlistDropTarget !== 'need' ? (
                <p className="px-1 py-2 font-semibold text-duored-muted">
                  No items yet. Drag from Priority buy list below or add via the link form above.
                </p>
              ) : (
                <ol className={`space-y-2 ${wishlistDropTarget === 'need' ? 'opacity-40' : ''} transition-opacity duration-200`}>
                  {state.needList.map((item, index) => (
                    <BuyRow
                      key={item.id}
                      item={item}
                      index={index}
                      length={state.needList.length}
                      affordable={affordableSet.has(item.id)}
                      isDragging={wishlistDrag?.itemId === item.id}
                      onDragStart={() => setWishlistDrag({ itemId: item.id, fromList: 'need' })}
                      onDragEnd={() => { setWishlistDrag(null); setWishlistDropTarget(null); }}
                      onMove={(itemId, direction) =>
                        runMutation(
                          { op: 'move_need_item', itemId, direction },
                          (current) => {
                            const idx = current.needList.findIndex((entry) => entry.id === itemId);
                            if (idx === -1) return current;
                            const target = direction === 'up' ? Math.max(0, idx - 1) : Math.min(current.needList.length - 1, idx + 1);
                            if (target === idx) return current;
                            const next = [...current.needList];
                            const [moved] = next.splice(idx, 1);
                            next.splice(target, 0, moved);
                            return { ...current, needList: next };
                          },
                        )
                      }
                      onRemove={(itemId) =>
                        runMutation(
                          { op: 'remove_need_item', itemId },
                          (current) => ({ ...current, needList: current.needList.filter((entry) => entry.id !== itemId) }),
                        )
                      }
                      onBought={(itemId) =>
                        runMutation(
                          { op: 'mark_need_item_bought', itemId, category: 'maintenance' },
                          (current) => {
                            const item = current.needList.find((entry) => entry.id === itemId);
                            if (!item) return current;
                            const nextExpense: ExpenseEntry = {
                              id: `optimistic-${item.id}`,
                              title: item.title,
                              amount: item.price,
                              bucket: 'actual',
                              category: 'maintenance',
                              cadence: 'one-time',
                              spentOn: new Date().toISOString(),
                              notes: [item.notes, item.sourcePlatform ? `Bought via ${item.sourcePlatform}` : '', getReturnLabel(item)].filter(Boolean).join(' | '),
                              imageUrl: item.imageUrl,
                              sourceUrl: item.url,
                              sourcePlatform: item.sourcePlatform,
                            };
                            return {
                              ...current,
                              needList: current.needList.filter((entry) => entry.id !== itemId),
                              expenses: [nextExpense, ...current.expenses],
                            };
                          },
                        )
                      }
                    />
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section className="card-panel">
            <h2 className="section-title">Priority buy list</h2>
            <p className="mb-3 text-sm font-semibold text-duored-muted">
              Top items have higher priority. Green-outline rows are affordable this month. Drag items to Actually Need above.
            </p>
            <div
              className={`relative min-h-[72px] rounded-xl p-1 transition-all duration-200
                ${wishlistDropTarget === 'buy' && wishlistDrag?.fromList === 'need'
                  ? 'ring-2 ring-blue-400 bg-blue-50/60 shadow-inner'
                  : ''}
              `}
              onDragOver={(e) => { if (wishlistDrag) e.preventDefault(); }}
              onDragEnter={(e) => { e.preventDefault(); if (wishlistDrag?.fromList === 'need') setWishlistDropTarget('buy'); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setWishlistDropTarget(null); setBuyDropIndicator(null); } }}
              onDrop={(e) => {
                e.preventDefault();
                const src = wishlistDrag;
                setWishlistDropTarget(null);
                setWishlistDrag(null);
                if (!src) return;
                if (src.fromList === 'need') {
                  runMutation(
                    { op: 'move_to_buy_list', itemId: src.itemId },
                    (current) => {
                      const item = current.needList.find((entry) => entry.id === src.itemId);
                      if (!item) return current;
                      return {
                        ...current,
                        needList: current.needList.filter((entry) => entry.id !== src.itemId),
                        buyList: [item, ...current.buyList],
                      };
                    },
                  );
                  return;
                }
                if (src.fromList === 'buy') {
                  setBuyDropIndicator(null);
                  const fromIdx = state.buyList.findIndex((entry) => entry.id === src.itemId);
                  if (fromIdx === -1) return;
                  const target = state.buyList.length - 1;
                  if (target === fromIdx) return;
                  runMutation(
                    { op: 'reorder_buy_item', itemId: src.itemId, targetIndex: target },
                    (current) => {
                      const f = current.buyList.findIndex((entry) => entry.id === src.itemId);
                      if (f === -1) return current;
                      const next = [...current.buyList];
                      const [moved] = next.splice(f, 1);
                      next.splice(target, 0, moved);
                      return { ...current, buyList: next };
                    },
                  );
                }
              }}
            >
              {wishlistDropTarget === 'buy' && wishlistDrag?.fromList === 'need' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 rounded-xl">
                  <span className="animate-bounce text-sm font-bold text-blue-600 bg-white/90 rounded-full px-4 py-2 shadow-lg ring-1 ring-blue-300">
                    ↓ Drop here to move to Priority list
                  </span>
                </div>
              )}
              {state.buyList.length === 0 && wishlistDropTarget !== 'buy' ? (
                <p className="px-1 py-2 font-semibold text-duored-muted">No items yet. Add your first product link above.</p>
              ) : (
                <ol className={`space-y-2 ${wishlistDropTarget === 'buy' ? 'opacity-40' : ''} transition-opacity duration-200`}>
                  {state.buyList.map((item, index) => (
                    <BuyRow
                      key={item.id}
                      item={item}
                      index={index}
                      length={state.buyList.length}
                      affordable={affordableSet.has(item.id)}
                      isDragging={wishlistDrag?.itemId === item.id}
                      hideReorderButtons
                      dropPosition={
                        wishlistDrag?.fromList === 'buy' && wishlistDrag.itemId !== item.id && buyDropIndicator?.index === index
                          ? buyDropIndicator.position
                          : null
                      }
                      onItemDragOver={(idx, position) => {
                        if (wishlistDrag?.fromList !== 'buy') return;
                        if (wishlistDrag.itemId === item.id) return;
                        setBuyDropIndicator((prev) => (prev?.index === idx && prev.position === position ? prev : { index: idx, position }));
                      }}
                      onItemDragLeave={() => {
                        setBuyDropIndicator((prev) => (prev?.index === index ? null : prev));
                      }}
                      onItemDrop={(idx, position) => {
                        const src = wishlistDrag;
                        setBuyDropIndicator(null);
                        setWishlistDrag(null);
                        setWishlistDropTarget(null);
                        if (!src || src.fromList !== 'buy' || src.itemId === item.id) return;
                        const fromIdx = state.buyList.findIndex((entry) => entry.id === src.itemId);
                        if (fromIdx === -1) return;
                        let target = position === 'before' ? idx : idx + 1;
                        if (fromIdx < target) target -= 1;
                        target = Math.max(0, Math.min(state.buyList.length - 1, target));
                        if (target === fromIdx) return;
                        runMutation(
                          { op: 'reorder_buy_item', itemId: src.itemId, targetIndex: target },
                          (current) => {
                            const f = current.buyList.findIndex((entry) => entry.id === src.itemId);
                            if (f === -1) return current;
                            const next = [...current.buyList];
                            const [moved] = next.splice(f, 1);
                            next.splice(target, 0, moved);
                            return { ...current, buyList: next };
                          },
                        );
                      }}
                      onDragStart={() => setWishlistDrag({ itemId: item.id, fromList: 'buy' })}
                      onDragEnd={() => { setWishlistDrag(null); setWishlistDropTarget(null); setBuyDropIndicator(null); }}
                      onMove={(itemId, direction) =>
                        runMutation(
                          { op: 'move_buy_item', itemId, direction },
                          (current) => {
                            const index = current.buyList.findIndex((entry) => entry.id === itemId);
                            if (index === -1) return current;
                            const target =
                              direction === 'up'
                                ? Math.max(0, index - 1)
                                : Math.min(current.buyList.length - 1, index + 1);
                            if (target === index) return current;
                            const nextBuyList = [...current.buyList];
                            const [item] = nextBuyList.splice(index, 1);
                            nextBuyList.splice(target, 0, item);
                            return { ...current, buyList: nextBuyList };
                          },
                        )
                      }
                      onRemove={(itemId) =>
                        runMutation(
                          { op: 'remove_buy_item', itemId },
                          (current) => ({ ...current, buyList: current.buyList.filter((entry) => entry.id !== itemId) }),
                        )
                      }
                      onBought={(itemId) =>
                        runMutation(
                          { op: 'mark_buy_item_bought', itemId, category: 'maintenance' },
                          (current) => {
                            const item = current.buyList.find((entry) => entry.id === itemId);
                            if (!item) return current;
                            const nextExpense: ExpenseEntry = {
                              id: `optimistic-${item.id}`,
                              title: item.title,
                              amount: item.price,
                              bucket: 'actual',
                              category: 'maintenance',
                              cadence: 'one-time',
                              spentOn: new Date().toISOString(),
                              notes: [
                                item.notes,
                                item.sourcePlatform ? `Bought via ${item.sourcePlatform}` : '',
                                getReturnLabel(item),
                              ]
                                .filter(Boolean)
                                .join(' | '),
                              imageUrl: item.imageUrl,
                              sourceUrl: item.url,
                              sourcePlatform: item.sourcePlatform,
                            };
                            return {
                              ...current,
                              buyList: current.buyList.filter((entry) => entry.id !== itemId),
                              expenses: [nextExpense, ...current.expenses],
                            };
                          },
                        )
                      }
                    />
                  ))}
                </ol>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export { FINANCE_CHANGED_EVENT };
