'use client';

import { type Dispatch, type PointerEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { ItemAvatar } from '@/components/ItemAvatar';
import { CsvImportButton } from '@/components/CsvImportButton';
import { FINANCE_CHANGED_EVENT } from '@/components/finance-events';
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
import type { MarketPlatform, MarketProduct, MarketSearchResponse, MarketSortValue } from '@/lib/market-search';

const CUSTOM_FREQ_PREFIX = 'custom-frequency:';
const MARKET_EXPLORER_STORAGE_KEY = 'finflow_market_explorer_state';
const MARKET_COMPARISON_STORAGE_KEY = 'finflow_market_comparison_state';
const WISHLIST_TAB_STORAGE_KEY = 'finflow_wishlist_tab';

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
  | { op: 'set_priority_picks_budget'; amount: number }
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
  | { op: 'hydrate_buy_item_photos'; itemIds: string[] }
  | { op: 'add_buy_item'; url: string; notes?: string; title?: string; price?: number; currency?: string; imageUrl?: string }
  | { op: 'remove_buy_item'; itemId: string }
  | { op: 'move_buy_item'; itemId: string; direction: 'up' | 'down' }
  | { op: 'reorder_buy_item'; itemId: string; targetIndex: number }
  | { op: 'mark_buy_item_bought'; itemId: string; category?: ExpenseCategory; subCategory?: string }
  | { op: 'remove_need_item'; itemId: string }
  | { op: 'move_need_item'; itemId: string; direction: 'up' | 'down' }
  | { op: 'mark_need_item_bought'; itemId: string; category?: ExpenseCategory; subCategory?: string }
  | { op: 'move_to_need_list'; itemId: string }
  | { op: 'move_to_buy_list'; itemId: string }
  | { op: 'move_priority_pick_item'; itemId: string; targetList: PriorityListKey; targetIndex: number };

type PriorityListKey = 'buy' | 'winner';

type PriorityDragState = {
  itemId: string;
  fromList: PriorityListKey;
};

type PriorityDropIndicator = {
  list: PriorityListKey;
  index: number;
  position: 'before' | 'after';
} | null;

export type FinanceMode = 'dashboard' | 'wishlist' | 'priority-picks' | 'reports';

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

function formatBuyItemPrice(item: BuyListItem): string {
  return item.price > 0 ? formatMoney(item.price, item.currency || 'INR') : 'Price pending';
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

function ReportsView({ state, summary }: { state: FinanceStore; summary: ReturnType<typeof summarizeFinance> }) {
  const sorted = Object.entries(
    state.expenses.reduce<Record<string, number>>((acc, expense) => {
      acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <section className="space-y-1">
        <h1 className="text-3xl font-extrabold text-duored-deep">Reports</h1>
        <p className="font-semibold text-duored-muted">Quick monthly outlook for expected vs current spending.</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="card-3d card-green">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Monthly Income</p>
          <p className="mt-2 text-2xl font-extrabold">{formatMoney(state.monthlyIncome)}</p>
        </article>
        <article className="card-3d card-amber">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Expected / Month</p>
          <p className="mt-2 text-2xl font-extrabold">{formatMoney(summary.monthlyExpectedExpenses)}</p>
        </article>
        <article className="card-3d card-rose">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Spent This Month</p>
          <p className="mt-2 text-2xl font-extrabold">{formatMoney(summary.currentMonthSpent)}</p>
        </article>
        <article className="card-3d card-green">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Can Buy This Month</p>
          <p className="mt-2 text-2xl font-extrabold">{summary.canBuyCountThisMonth} items</p>
        </article>
      </section>

      <section className="grid gap-3 md:grid-cols-1">
        <article className="card-3d card-green">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Remaining This Month</p>
          <p className="mt-2 text-2xl font-extrabold">{formatMoney(summary.currentMonthRemaining)}</p>
        </article>
      </section>

      <section className="card-panel">
        <h2 className="section-title">Category totals</h2>
        {sorted.length === 0 ? (
          <p className="font-semibold text-duored-muted">No expenses recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map(([category, amount]) => (
              <li key={category} className="lift-card">
                <span className="font-extrabold capitalize text-duored-ink">
                  {isExpenseCategory(category) ? categoryLabel(category) : category}
                </span>
                <span className="font-extrabold text-duored-deep">{formatMoney(amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
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
        <span className="chip-price">{formatBuyItemPrice(item)}</span>
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

const MARKET_PLATFORM_OPTIONS: Array<{ value: MarketPlatform; label: string }> = [
  { value: 'amazon', label: 'Amazon' },
  { value: 'flipkart', label: 'Flipkart' },
  { value: 'meesho', label: 'Meesho' },
  { value: 'myntra', label: 'Myntra' },
];

const MARKET_SORT_OPTIONS: Array<{ value: MarketSortValue; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'review_count_desc', label: 'Review count high to low' },
  { value: 'rating_desc', label: 'Stars high to low' },
  { value: 'magic_score_desc', label: 'Magic score high to low' },
  { value: 'price_asc', label: 'Price low to high' },
  { value: 'price_desc', label: 'Price high to low' },
];

type MarketFilterForm = {
  platforms: MarketPlatform[];
  minReviewCount: string;
  minRating: string;
  bestSellerOnly: boolean;
  primeOnly: boolean;
  amazonsChoiceOnly: boolean;
  limitedTimeDealOnly: boolean;
  sortBy: MarketSortValue;
};

type ProductAspect = {
  label: string;
  value: string;
  confidence?: 'high' | 'medium' | 'low';
};

type ProductAspectSection = {
  title: string;
  items: ProductAspect[];
};

type ProductAnalysisState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  sections?: ProductAspectSection[];
  error?: string;
};

type MarketComparisonValue = {
  product_ref: string;
  value: string;
};

type MarketComparisonDimension = {
  dimension: string;
  values?: MarketComparisonValue[];
  winner_ref?: string;
  reason?: string;
};

type MarketUncommonDimension = {
  product_ref: string;
  dimension: string;
  value: string;
};

type MarketRequirementRecommendation = {
  requirement: string;
  product_ref: string;
  reason: string;
};

type MarketComparisonResult = {
  common_dimensions?: MarketComparisonDimension[];
  uncommon_dimensions?: MarketUncommonDimension[];
  requirement_recommendations?: MarketRequirementRecommendation[];
  final_ai_pick?: {
    product_ref: string;
    reason: string;
    confidence?: 'high' | 'medium' | 'low';
  };
};

type MarketComparisonState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result?: MarketComparisonResult;
  error?: string;
};

type WishlistTab = 'explore' | 'compare' | 'cart';

type MarketExplorerSnapshot = {
  query: string;
  filters: MarketFilterForm;
  results: MarketProduct[];
  sources: MarketSearchResponse['sources'];
  status: string;
};

type MarketComparisonSnapshot = {
  products: MarketProduct[];
  comparison: MarketComparisonState;
};

function readStoredJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStoredJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures so the market tools still work in private or restricted browsers.
  }
}

function writeStoredText(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures so the market tools still work in private or restricted browsers.
  }
}

function isWishlistTab(value: unknown): value is WishlistTab {
  return value === 'explore' || value === 'compare' || value === 'cart';
}

function normalizeMarketFilters(value: Partial<MarketFilterForm> | undefined): MarketFilterForm {
  const fallback = createMarketFilterForm();
  if (!value) return fallback;
  const platforms = Array.isArray(value.platforms)
    ? value.platforms.filter((platform): platform is MarketPlatform =>
        MARKET_PLATFORM_OPTIONS.some((option) => option.value === platform),
      )
    : fallback.platforms;
  const sortBy: MarketSortValue = MARKET_SORT_OPTIONS.some((option) => option.value === value.sortBy)
    ? (value.sortBy as MarketSortValue)
    : fallback.sortBy;

  return {
    platforms: platforms.length ? platforms : fallback.platforms,
    minReviewCount: typeof value.minReviewCount === 'string' ? value.minReviewCount : fallback.minReviewCount,
    minRating: typeof value.minRating === 'string' ? value.minRating : fallback.minRating,
    bestSellerOnly: Boolean(value.bestSellerOnly),
    primeOnly: Boolean(value.primeOnly),
    amazonsChoiceOnly: Boolean(value.amazonsChoiceOnly),
    limitedTimeDealOnly: Boolean(value.limitedTimeDealOnly),
    sortBy,
  };
}

function createMarketFilterForm(): MarketFilterForm {
  return {
    platforms: MARKET_PLATFORM_OPTIONS.map((platform) => platform.value),
    minReviewCount: '',
    minRating: '',
    bestSellerOnly: false,
    primeOnly: false,
    amazonsChoiceOnly: false,
    limitedTimeDealOnly: false,
    sortBy: 'relevance',
  };
}

function pushAspect(items: ProductAspect[], label: string, value: string | number | undefined, confidence?: ProductAspect['confidence']) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || /^unknown$/i.test(text) || items.some((item) => item.label === label)) return;
  items.push({ label, value: text, confidence });
}

function firstMatch(value: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1].trim();
    if (match?.[0]) return match[0].trim();
  }
  return '';
}

function compactLabel(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*[,|]\s*$/g, '')
    .trim();
}

function inferBrand(text: string): string {
  const known = [
    'SanDisk',
    'Seagate',
    'Western Digital',
    'WD',
    'Samsung',
    'Logitech',
    'Dell',
    'Zebronics',
    'Portronics',
    'Lenovo',
    'HP',
    'Sony',
    'boAt',
    'Noise',
    'Puma',
    'Nike',
    'Adidas',
    'HRX',
    'Elista',
  ];
  const found = known.find((brand) => new RegExp(`\\b${brand.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text));
  if (found) return found;
  return firstMatch(text, [/^([A-Z][A-Za-z0-9&+-]{1,}(?:\s+[A-Z][A-Za-z0-9&+-]{1,})?)/]);
}

function inferProductType(text: string): string {
  const types: Array<[RegExp, string]> = [
    [/\bexternal\s+(?:ssd|solid state drive)\b/i, 'External SSD'],
    [/\bexternal\s+(?:hdd|hard drive|hard disk)\b/i, 'External HDD'],
    [/\b(?:ssd|solid state drive)\b/i, 'SSD'],
    [/\b(?:hdd|hard drive|hard disk)\b/i, 'Hard drive'],
    [/\bkeyboard\b/i, 'Keyboard'],
    [/\bmouse\b/i, 'Mouse'],
    [/\bshoe|sneaker|sandal\b/i, 'Footwear'],
    [/\bbackpack|bag\b/i, 'Bag'],
    [/\bphone|smartphone\b/i, 'Smartphone'],
    [/\blaptop\b/i, 'Laptop'],
    [/\bheadphone|earbud|earphone|speaker\b/i, 'Audio'],
    [/\bwatch|smartwatch\b/i, 'Watch'],
  ];
  return types.find(([pattern]) => pattern.test(text))?.[1] ?? 'Product';
}

function buildRegexProductSections(product: MarketProduct): ProductAspectSection[] {
  const text = compactLabel([product.title, product.description, product.detailLines.join(' '), product.badges.join(' ')].join(' '));
  const brand = inferBrand(text) || 'Unknown';
  const productType = inferProductType(text);
  const capacity = firstMatch(text, [/\b(\d+(?:\.\d+)?\s?(?:TB|GB|MB|L|litre|liter))\b/i]);
  const speed = firstMatch(text, [/\b(\d+(?:\.\d+)?\s?(?:MB\/s|GB\/s|Gbps|RPM))\b/i]);
  const warranty = firstMatch(text, [/\b(\d+\s?(?:year|years|yr|yrs|Y)\s+warranty)\b/i]);
  const interfaceValue = firstMatch(text, [/\b(USB\s?(?:3\.\d|2\.0|Type-?C|C|A)|Type-?C|Thunderbolt|NVMe|SATA)\b/i]);
  const compatibility = firstMatch(text, [/\b(PC|Mac|Windows|Android|iOS|PS5|PS4|Xbox|Smartphone|Laptop)(?:[,/& ]+(?:PC|Mac|Windows|Android|iOS|PS5|PS4|Xbox|Smartphone|Laptop))*\b/i]);
  const color = firstMatch(text, [/\b(black|white|blue|red|green|silver|grey|gray|gold|pink|purple|brown|beige)\s?(?:color|colour)?\b/i]);
  const identity: ProductAspect[] = [];
  const signals: ProductAspect[] = [];
  const specs: ProductAspect[] = [];
  const fit: ProductAspect[] = [];

  pushAspect(identity, 'Brand', brand && brand !== 'Unknown' ? brand : '');
  pushAspect(identity, 'Category', productType);
  pushAspect(identity, 'Capacity / size', capacity);
  pushAspect(identity, 'Color', color);
  pushAspect(signals, 'Platform', product.platformLabel);
  pushAspect(signals, 'Price', product.price > 0 ? formatMoney(product.price, product.currency) : '');
  pushAspect(signals, 'Rating', product.rating ? `${product.rating.toFixed(1)} stars` : '');
  pushAspect(signals, 'Reviews', product.reviewCount ? `${product.reviewCount.toLocaleString('en-IN')} reviews` : '');
  pushAspect(signals, 'Badges', product.badges.join(', '));

  if (/\bkeyboard\b/i.test(text)) {
    pushAspect(specs, 'Connection', firstMatch(text, [/\b(wired|wireless|bluetooth|2\.4\s?ghz|usb)\b/i]));
    pushAspect(specs, 'Layout', firstMatch(text, [/\b(full[- ]?size|tkl|tenkeyless|60%|65%|75%|compact|standard)\b/i]));
    pushAspect(specs, 'Switch / key type', firstMatch(text, [/\b(mechanical|semi-mechanical|membrane|chiclet|plunger|scissor)\b/i]));
    if (/backlit|rgb|rainbow/i.test(text)) pushAspect(specs, 'Backlight', firstMatch(text, [/\b(rgb|rainbow|backlit|white backlight)\b/i]) || 'Included');
    if (/spill[- ]?resistant|water[- ]?resistant/i.test(text)) pushAspect(fit, 'Spill resistance', 'Included');
    if (/mouse combo|keyboard and mouse|combo/i.test(text)) pushAspect(fit, 'Combo accessory', 'Keyboard + mouse');
    pushAspect(fit, 'Compatibility', compatibility);
  } else if (/\b(?:ssd|solid state drive|hdd|hard drive|hard disk)\b/i.test(text)) {
    pushAspect(specs, 'Storage type', /\b(?:ssd|solid state drive)\b/i.test(text) ? 'SSD' : 'Hard drive');
    pushAspect(specs, 'Interface', interfaceValue);
    pushAspect(specs, 'Transfer speed', speed);
    pushAspect(fit, 'Warranty', warranty);
    if (/drop protection|water\/dust|water resistant|dust resistant|IP\d{2}/i.test(text)) {
      pushAspect(fit, 'Protection', firstMatch(text, [/\b(IP\d{2}[^,|]*)\b/i, /\b(\d+\s?m\s?drop protection)\b/i, /\b(water\/dust resistant|water resistant|dust resistant)\b/i]) || 'Protected');
    }
  } else if (/\bshoe|sneaker|sandal\b/i.test(text)) {
    pushAspect(specs, 'Footwear type', firstMatch(text, [/\b(running shoes?|sneakers?|sandals?|sports shoes?|casual shoes?)\b/i]));
    pushAspect(specs, 'Material', firstMatch(text, [/\b(mesh|leather|synthetic|canvas|rubber|foam)\b/i]));
    pushAspect(fit, 'Closure', firstMatch(text, [/\b(lace[- ]?up|slip[- ]?on|velcro)\b/i]));
  } else {
    pushAspect(specs, 'Interface', interfaceValue);
    pushAspect(specs, 'Speed / rating spec', speed);
    pushAspect(fit, 'Compatibility', compatibility);
    pushAspect(fit, 'Warranty', warranty);
  }

  if (product.badges.some((badge) => /open marketplace/i.test(badge))) {
    pushAspect(fit, 'Search fallback', 'Open live marketplace page for current products');
  }

  return [
    { title: 'Product identity', items: identity },
    { title: `${productType} aspects`, items: specs },
    { title: 'Fit and usage', items: fit },
    { title: 'Market signal', items: signals },
  ].filter((section) => section.items.length > 0);
}

function normalizeComparisonResult(value: unknown): MarketComparisonResult {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const nested = record.output_shape && typeof record.output_shape === 'object'
    ? (record.output_shape as Record<string, unknown>)
    : record;
  return {
    common_dimensions: Array.isArray(nested.common_dimensions) ? nested.common_dimensions as MarketComparisonDimension[] : [],
    uncommon_dimensions: Array.isArray(nested.uncommon_dimensions) ? nested.uncommon_dimensions as MarketUncommonDimension[] : [],
    requirement_recommendations: Array.isArray(nested.requirement_recommendations)
      ? nested.requirement_recommendations as MarketRequirementRecommendation[]
      : [],
    final_ai_pick: nested.final_ai_pick as MarketComparisonResult['final_ai_pick'],
  };
}

async function analyzeMarketProduct(product: MarketProduct): Promise<ProductAspectSection[]> {
  const res = await fetch('/api/market/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'DeepSeek analysis failed');
  }
  return data.sections as ProductAspectSection[];
}

async function compareMarketProducts(products: MarketProduct[]): Promise<MarketComparisonResult> {
  const res = await fetch('/api/market/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ products }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'DeepSeek comparison failed');
  }
  return normalizeComparisonResult(data.comparison);
}

async function searchMarket(query: string, filters: MarketFilterForm): Promise<MarketSearchResponse> {
  const res = await fetch('/api/market/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      filters: {
        platforms: filters.platforms,
        minReviewCount: Number(filters.minReviewCount || '0'),
        minRating: Number(filters.minRating || '0'),
        bestSellerOnly: filters.bestSellerOnly,
        primeOnly: filters.primeOnly,
        amazonsChoiceOnly: filters.amazonsChoiceOnly,
        limitedTimeDealOnly: filters.limitedTimeDealOnly,
        sortBy: filters.sortBy,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Market search failed');
  }
  return data as MarketSearchResponse;
}

function MarketResultRow({
  product,
  isPending,
  analysis,
  selectedForCompare,
  onAdd,
  onAnalyze,
  onToggleCompare,
}: {
  product: MarketProduct;
  isPending: boolean;
  analysis: ProductAnalysisState;
  selectedForCompare: boolean;
  onAdd: (product: MarketProduct) => void;
  onAnalyze: (product: MarketProduct) => void;
  onToggleCompare: (product: MarketProduct) => void;
}) {
  const regexSections = buildRegexProductSections(product);
  const displaySections = analysis.status === 'ready' && analysis.sections?.length ? analysis.sections : regexSections;

  return (
    <li className="lift-card flex-col items-start sm:flex-row">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ItemAvatar title={product.title} imageUrl={product.imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip-soft px-2 py-0.5 text-xs">{product.platformLabel}</span>
            {product.badges.map((badge) => (
              <span key={badge} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-extrabold text-amber-700">
                {badge}
              </span>
            ))}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {displaySections.map((section) => (
              <div key={section.title} className="rounded-xl border-2 border-duored-border bg-white/80 p-3">
                <p className="text-xs font-extrabold uppercase text-duored-muted">{section.title}</p>
                <dl className="mt-2 space-y-1">
                  {section.items.map((item) => (
                    <div key={`${section.title}-${item.label}`} className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
                      <dt className="font-extrabold text-duored-ink">{item.label}</dt>
                      <dd className="font-semibold text-duored-muted">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          {analysis.status === 'error' && (
            <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
              {analysis.error}
            </p>
          )}

          <a href={product.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-duored-link underline">
            Open product page
          </a>
        </div>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
        <span className="chip-price">{product.price > 0 ? formatMoney(product.price, product.currency) : 'Price pending'}</span>
        <button
          className="chip-soft"
          type="button"
          disabled={analysis.status === 'loading'}
          onClick={() => onAnalyze(product)}
        >
          {analysis.status === 'loading' ? 'Processing...' : analysis.status === 'ready' ? 'Refresh aspects' : 'DeepSeek aspects'}
        </button>
        <button className="chip-soft" type="button" onClick={() => onToggleCompare(product)}>
          {selectedForCompare ? 'In comparison' : 'Add to comparison'}
        </button>
        <button className="btn-duored px-3 py-1 text-xs" type="button" disabled={isPending} onClick={() => onAdd(product)}>
          Add to cart
        </button>
      </div>
    </li>
  );
}

function MarketExplorer({
  isPending,
  comparisonProducts,
  onAddProduct,
  onToggleCompare,
}: {
  isPending: boolean;
  comparisonProducts: MarketProduct[];
  onAddProduct: (product: MarketProduct) => void;
  onToggleCompare: (product: MarketProduct) => void;
}) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<MarketFilterForm>(createMarketFilterForm);
  const [results, setResults] = useState<MarketProduct[]>([]);
  const [sources, setSources] = useState<MarketSearchResponse['sources']>([]);
  const [analysisByProduct, setAnalysisByProduct] = useState<Record<string, ProductAnalysisState>>({});
  const [status, setStatus] = useState('Search Amazon, Flipkart, Meesho, and Myntra from one place.');
  const [isSearching, setIsSearching] = useState(false);
  const [hasLoadedPersistedSearch, setHasLoadedPersistedSearch] = useState(false);

  useEffect(() => {
    const snapshot = readStoredJson<Partial<MarketExplorerSnapshot>>(MARKET_EXPLORER_STORAGE_KEY);
    if (snapshot) {
      if (typeof snapshot.query === 'string') setQuery(snapshot.query);
      setFilters(normalizeMarketFilters(snapshot.filters));
      if (Array.isArray(snapshot.results)) setResults(snapshot.results);
      if (Array.isArray(snapshot.sources)) setSources(snapshot.sources);
      if (typeof snapshot.status === 'string') setStatus(snapshot.status);
    }
    setHasLoadedPersistedSearch(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedSearch) return;
    writeStoredJson(MARKET_EXPLORER_STORAGE_KEY, {
      query,
      filters,
      results,
      sources,
      status,
    } satisfies MarketExplorerSnapshot);
  }, [filters, hasLoadedPersistedSearch, query, results, sources, status]);

  function togglePlatform(platform: MarketPlatform) {
    setFilters((current) => {
      const hasPlatform = current.platforms.includes(platform);
      const nextPlatforms = hasPlatform
        ? current.platforms.filter((item) => item !== platform)
        : [...current.platforms, platform];
      return { ...current, platforms: nextPlatforms.length ? nextPlatforms : [platform] };
    });
  }

  function runSearch() {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      setStatus('Enter a keyword to explore products.');
      setResults([]);
      setSources([]);
      return;
    }

    setIsSearching(true);
    setStatus('Searching marketplaces...');
    searchMarket(cleanQuery, filters)
      .then((data) => {
        setResults(data.results);
        setSources(data.sources);
        setAnalysisByProduct({});
        setStatus(data.results.length ? `${data.results.length} cleaned products found.` : 'No products matched these filters.');
      })
      .catch((error) => {
        setResults([]);
        setSources([]);
        setStatus((error as Error).message);
      })
      .finally(() => setIsSearching(false));
  }

  function runDeepSeekAnalysis(product: MarketProduct) {
    setAnalysisByProduct((current) => ({
      ...current,
      [product.url]: { status: 'loading' },
    }));
    analyzeMarketProduct(product)
      .then((sections) => {
        setAnalysisByProduct((current) => ({
          ...current,
          [product.url]: { status: 'ready', sections },
        }));
      })
      .catch((error) => {
        setAnalysisByProduct((current) => ({
          ...current,
          [product.url]: { status: 'error', error: (error as Error).message },
        }));
      });
  }

  return (
    <section className="card-panel">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="section-title">Explore Market</h2>
          <p className="text-sm font-semibold text-duored-muted">
            Search once, compare cleaned results, then add the product directly to your cart list.
          </p>
        </div>

        <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
          <input
            className="text-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
            }}
            placeholder="Search products, for example keyboard, shoes, backpack"
          />
          <button className="btn-duored" type="button" disabled={isSearching} onClick={runSearch}>
            {isSearching ? 'Searching...' : 'Search market'}
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border-2 border-duored-border bg-duored-soft/40 p-3">
            <p className="mb-2 text-xs font-extrabold uppercase text-duored-muted">Platforms</p>
            <div className="flex flex-wrap gap-2">
              {MARKET_PLATFORM_OPTIONS.map((platform) => (
                <label key={platform.value} className="chip">
                  <input
                    type="checkbox"
                    checked={filters.platforms.includes(platform.value)}
                    onChange={() => togglePlatform(platform.value)}
                  />
                  <span>{platform.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <input
              className="text-input"
              value={filters.minReviewCount}
              onChange={(event) => setFilters((current) => ({ ...current, minReviewCount: event.target.value }))}
              inputMode="numeric"
              placeholder="Min reviews"
            />
            <input
              className="text-input"
              value={filters.minRating}
              onChange={(event) => setFilters((current) => ({ ...current, minRating: event.target.value }))}
              inputMode="decimal"
              placeholder="Min stars"
            />
            <select
              className="text-input"
              value={filters.sortBy}
              onChange={(event) => setFilters((current) => ({ ...current, sortBy: event.target.value as MarketSortValue }))}
            >
              {MARKET_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            ['bestSellerOnly', 'Best seller'],
            ['primeOnly', 'Prime / assured'],
            ['amazonsChoiceOnly', "Amazon's Choice"],
            ['limitedTimeDealOnly', 'Deals'],
          ].map(([key, label]) => (
            <label key={key} className="chip">
              <input
                type="checkbox"
                checked={Boolean(filters[key as keyof MarketFilterForm])}
                onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <div className="rounded-xl border-2 border-duored-border bg-white px-3 py-2 text-sm font-bold text-duored-muted">
          {status}
        </div>

        {sources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <a
                key={source.platform}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className={`rounded-full border px-3 py-1 text-xs font-extrabold ${
                  source.ok && source.count > 0
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                }`}
                title={source.error ?? source.url}
              >
                {source.label}: {source.count}
              </a>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <ol className="space-y-2">
            {results.map((product) => (
              <MarketResultRow
                key={`${product.platform}-${product.url}`}
                product={product}
                isPending={isPending}
                analysis={analysisByProduct[product.url] ?? { status: 'idle' }}
                selectedForCompare={comparisonProducts.some((entry) => entry.url === product.url)}
                onAdd={onAddProduct}
                onAnalyze={runDeepSeekAnalysis}
                onToggleCompare={onToggleCompare}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function productComparisonLabel(product: MarketProduct, index: number): string {
  return product.title.trim() || `P${index + 1}`;
}

function comparisonProductName(productRef: string | undefined, products: MarketProduct[]): string {
  if (!productRef) return 'Unknown';
  const index = Number(productRef.replace(/^P/i, '')) - 1;
  const product = products[index];
  return product ? `${productRef}: ${productComparisonLabel(product, index)}` : productRef;
}

function CompareMarketView({
  products,
  comparison,
  onRemove,
  onClear,
  onCompare,
}: {
  products: MarketProduct[];
  comparison: MarketComparisonState;
  onRemove: (url: string) => void;
  onClear: () => void;
  onCompare: () => void;
}) {
  return (
    <section className="card-panel">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="section-title mb-1">Compare</h2>
            <p className="text-sm font-semibold text-duored-muted">
              Select products from Explore Market, then compare shared dimensions and product-specific aspects separately.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="chip-soft" type="button" disabled={products.length === 0} onClick={onClear}>
              Clear
            </button>
            <button className="btn-duored" type="button" disabled={products.length < 2 || comparison.status === 'loading'} onClick={onCompare}>
              {comparison.status === 'loading' ? 'Comparing...' : 'Compare products'}
            </button>
          </div>
        </div>

        {products.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-duored-border bg-duored-soft/40 p-4 font-bold text-duored-muted">
            No comparison products yet. Use Add to comparison on any market result.
          </p>
        ) : (
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product, index) => {
              const sections = buildRegexProductSections(product);
              const signal = sections.find((section) => section.title === 'Market signal');
              return (
                <li key={product.url} className="rounded-xl border-2 border-duored-border bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <ItemAvatar title={product.title} imageUrl={product.imageUrl} />
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold uppercase text-duored-muted">P{index + 1} · {product.platformLabel}</p>
                        <p className="mt-1 line-clamp-2 font-extrabold text-duored-ink">{productComparisonLabel(product, index)}</p>
                        <a
                          href={product.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex text-xs font-extrabold text-duored-link underline"
                        >
                          Open product
                        </a>
                      </div>
                    </div>
                    <button className="chip-danger shrink-0 px-2 py-1 text-xs" type="button" onClick={() => onRemove(product.url)}>
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="chip-price">{product.price > 0 ? formatMoney(product.price, product.currency) : 'Price pending'}</span>
                    {signal?.items.slice(1, 3).map((item) => (
                      <span key={item.label} className="rounded-full bg-duored-soft px-2 py-1 text-xs font-bold text-duored-muted">
                        {item.value}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {comparison.status === 'error' && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
            {comparison.error}
          </p>
        )}

        {comparison.status === 'ready' && comparison.result && (
          <div className="space-y-4">
            {comparison.result.final_ai_pick && (
              <section className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-extrabold uppercase text-emerald-700">Final AI pick</p>
                <h3 className="mt-1 text-xl font-black text-emerald-800">
                  {comparisonProductName(comparison.result.final_ai_pick.product_ref, products)}
                </h3>
                <p className="mt-2 font-semibold text-emerald-800">{comparison.result.final_ai_pick.reason}</p>
                {comparison.result.final_ai_pick.confidence && (
                  <p className="mt-2 text-xs font-extrabold uppercase text-emerald-700">
                    Confidence: {comparison.result.final_ai_pick.confidence}
                  </p>
                )}
              </section>
            )}

            {comparison.result.requirement_recommendations?.length ? (
              <section className="rounded-xl border-2 border-duored-border bg-white p-4">
                <h3 className="text-lg font-extrabold text-duored-deep">Buy by requirement</h3>
                <ul className="mt-3 space-y-2">
                  {comparison.result.requirement_recommendations.map((item) => (
                    <li key={`${item.requirement}-${item.product_ref}`} className="rounded-xl bg-duored-soft/50 p-3">
                      <p className="font-extrabold text-duored-ink">{item.requirement}</p>
                      <p className="text-sm font-bold text-duored-muted">{comparisonProductName(item.product_ref, products)}</p>
                      <p className="mt-1 text-sm font-semibold text-duored-muted">{item.reason}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {comparison.result.common_dimensions?.length ? (
              <section className="rounded-xl border-2 border-duored-border bg-white p-4">
                <h3 className="text-lg font-extrabold text-duored-deep">Common dimensions</h3>
                <div className="mt-3 space-y-3">
                  {comparison.result.common_dimensions.map((dimension) => (
                    <article key={dimension.dimension} className="rounded-xl border border-duored-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-extrabold text-duored-ink">{dimension.dimension}</p>
                        {dimension.winner_ref && (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-extrabold text-emerald-700">
                            Winner: {comparisonProductName(dimension.winner_ref, products)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        {(dimension.values ?? []).map((value) => (
                          <p key={`${dimension.dimension}-${value.product_ref}`} className="text-sm font-semibold text-duored-muted">
                            <span className="font-extrabold text-duored-ink">{value.product_ref}:</span> {value.value}
                          </p>
                        ))}
                      </div>
                      {dimension.reason && <p className="mt-2 text-sm font-semibold text-duored-muted">{dimension.reason}</p>}
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {comparison.result.uncommon_dimensions?.length ? (
              <section className="rounded-xl border-2 border-duored-border bg-white p-4">
                <h3 className="text-lg font-extrabold text-duored-deep">Remaining product-specific aspects</h3>
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {comparison.result.uncommon_dimensions.map((item) => (
                    <li key={`${item.product_ref}-${item.dimension}`} className="rounded-xl bg-duored-soft/50 p-3">
                      <p className="text-xs font-extrabold uppercase text-duored-muted">
                        {comparisonProductName(item.product_ref, products)}
                      </p>
                      <p className="font-extrabold text-duored-ink">{item.dimension}</p>
                      <p className="text-sm font-semibold text-duored-muted">{item.value}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {!comparison.result.common_dimensions?.length && !comparison.result.uncommon_dimensions?.length ? (
              <p className="rounded-xl border-2 border-dashed border-duored-border bg-duored-soft/40 p-4 font-bold text-duored-muted">
                No comparable aspects were found for these selected products.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function getPriorityList(store: FinanceStore, list: PriorityListKey): BuyListItem[] {
  return list === 'winner' ? store.squidGameWinnerList : store.buyList;
}

function applyPriorityMove(
  store: FinanceStore,
  itemId: string,
  targetList: PriorityListKey,
  targetIndex: number,
): FinanceStore {
  const sourceList: PriorityListKey = store.squidGameWinnerList.some((item) => item.id === itemId) ? 'winner' : 'buy';
  const sourceItems = getPriorityList(store, sourceList);
  const item = sourceItems.find((entry) => entry.id === itemId);
  if (!item) return store;

  const nextBuyList = store.buyList.filter((entry) => entry.id !== itemId);
  const nextWinnerList = store.squidGameWinnerList.filter((entry) => entry.id !== itemId);
  const targetItems = targetList === 'winner' ? nextWinnerList : nextBuyList;
  let insertionIndex = Math.max(0, Math.min(targetItems.length, targetIndex));

  if (sourceList === targetList) {
    const fromIndex = sourceItems.findIndex((entry) => entry.id === itemId);
    if (targetIndex > fromIndex) insertionIndex = Math.max(0, insertionIndex - 1);
  }

  targetItems.splice(insertionIndex, 0, item);

  return {
    ...store,
    buyList: targetList === 'buy' ? targetItems : nextBuyList,
    squidGameWinnerList: targetList === 'winner' ? targetItems : nextWinnerList,
  };
}

function PriorityPickRow({
  item,
  index,
  list,
  isDragging,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  item: BuyListItem;
  index: number;
  list: PriorityListKey;
  isDragging: boolean;
  dropPosition?: 'before' | 'after' | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (index: number, position: 'before' | 'after') => void;
  onDragLeave: () => void;
  onDrop: (index: number, position: 'before' | 'after') => void;
}) {
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        try {
          event.dataTransfer.setData('text/plain', item.id);
        } catch {}
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        onDragOver(index, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) onDragLeave();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onDrop(index, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
      }}
      className={`lift-card relative select-none cursor-grab items-start active:cursor-grabbing
        ${isDragging ? 'scale-[0.98] opacity-30 shadow-none' : 'opacity-100'}
        ${dropPosition === 'before' ? 'before:absolute before:left-3 before:right-3 before:-top-1 before:h-1 before:rounded-full before:bg-duored-main before:shadow-[0_0_12px_rgba(216,54,72,0.45)]' : ''}
        ${dropPosition === 'after' ? 'after:absolute after:left-3 after:right-3 after:-bottom-1 after:h-1 after:rounded-full after:bg-duored-main after:shadow-[0_0_12px_rgba(216,54,72,0.45)]' : ''}
      `}
      data-priority-list={list}
    >
      <div className="pt-2 text-duored-muted/50" aria-hidden>
        ::
      </div>
      <ItemAvatar title={item.title} imageUrl={item.imageUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-extrabold text-duored-ink">{item.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="chip-price">{formatBuyItemPrice(item)}</span>
          <span className="text-xs font-bold text-duored-muted">{item.sourcePlatform || 'Online Store'}</span>
        </div>
        <a href={item.url} target="_blank" rel="noreferrer" draggable={false} className="mt-1 block truncate text-xs text-duored-link underline">
          {item.url}
        </a>
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

export function FinanceClient({ initialState, mode }: { initialState: FinanceStore; mode: FinanceMode }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState(String(initialState.priorityPicksBudget || ''));
  const summary = useMemo(() => summarizeFinance(state), [state]);
  const affordableSet = useMemo(() => new Set(summary.affordableItemIds), [summary.affordableItemIds]);

  const [predictedForm, setPredictedForm] = useState(createExpenseForm);
  const [actualForm, setActualForm] = useState(createExpenseForm);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editingExpenseForm, setEditingExpenseForm] = useState<ExpenseFormState | null>(null);
  const [predictedFilter, setPredictedFilter] = useState<FilterState>(createPredictedFilter);
  const [actualFilter, setActualFilter] = useState<FilterState>(createActualFilter);
  const [buyForm, setBuyForm] = useState({ url: '', notes: '' });
  const [wishlistTab, setWishlistTab] = useState<WishlistTab>('explore');
  const [marketComparisonProducts, setMarketComparisonProducts] = useState<MarketProduct[]>([]);
  const [marketComparison, setMarketComparison] = useState<MarketComparisonState>({ status: 'idle' });
  const [hasLoadedWishlistPersistence, setHasLoadedWishlistPersistence] = useState(false);
  const [wishlistDrag, setWishlistDrag] = useState<{ itemId: string; fromList: 'need' | 'buy' } | null>(null);
  const [wishlistDropTarget, setWishlistDropTarget] = useState<'need' | 'buy' | null>(null);
  const [buyDropIndicator, setBuyDropIndicator] = useState<{ index: number; position: 'before' | 'after' } | null>(null);
  const [priorityDrag, setPriorityDrag] = useState<PriorityDragState | null>(null);
  const [priorityDropTarget, setPriorityDropTarget] = useState<PriorityListKey | null>(null);
  const [priorityDropIndicator, setPriorityDropIndicator] = useState<PriorityDropIndicator>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [draggedExpenseId, setDraggedExpenseId] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<ExpenseCategory | null>(null);
  const [dragState, setDragState] = useState<ExpenseDragState | null>(null);
  const dragStateRef = useRef<ExpenseDragState | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement | null>(null);
  const dragOverCategoryRef = useRef<ExpenseCategory | null>(null);
  const nextDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const hydratedPhotoIdsRef = useRef<Set<string>>(new Set());
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

  useEffect(() => {
    if (mode !== 'wishlist') return;

    const storedTab = window.localStorage.getItem(WISHLIST_TAB_STORAGE_KEY);
    if (isWishlistTab(storedTab)) {
      setWishlistTab(storedTab);
    }

    const snapshot = readStoredJson<Partial<MarketComparisonSnapshot>>(MARKET_COMPARISON_STORAGE_KEY);
    if (snapshot) {
      if (Array.isArray(snapshot.products)) setMarketComparisonProducts(snapshot.products.slice(0, 6));
      if (snapshot.comparison?.status === 'ready' || snapshot.comparison?.status === 'error') {
        setMarketComparison(
          snapshot.comparison.status === 'ready'
            ? { status: 'ready', result: normalizeComparisonResult(snapshot.comparison.result) }
            : snapshot.comparison,
        );
      }
    }

    setHasLoadedWishlistPersistence(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'wishlist' || !hasLoadedWishlistPersistence) return;

    writeStoredText(WISHLIST_TAB_STORAGE_KEY, wishlistTab);
    writeStoredJson(MARKET_COMPARISON_STORAGE_KEY, {
      products: marketComparisonProducts,
      comparison: marketComparison.status === 'loading' ? { status: 'idle' } : marketComparison,
    } satisfies MarketComparisonSnapshot);
  }, [hasLoadedWishlistPersistence, marketComparison, marketComparisonProducts, mode, wishlistTab]);

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

  function addMarketProductToCart(product: MarketProduct) {
    runMutation(
      {
        op: 'add_buy_item',
        url: product.url,
        title: product.title,
        price: product.price,
        currency: product.currency,
        imageUrl: product.imageUrl,
        notes: [product.platformLabel, product.description, product.detailLines.join(' | ')].filter(Boolean).join(' | '),
      },
      (current) => {
        const item: BuyListItem = {
          id: `optimistic-market-${Date.now()}`,
          title: product.title,
          url: product.url,
          price: product.price,
          sourcePlatform: product.platformLabel,
          currency: product.currency,
          notes: 'Added from Explore Market.',
          createdAt: new Date().toISOString(),
          imageUrl: product.imageUrl,
          returnable: false,
        };
        return { ...current, buyList: [...current.buyList, item] };
      },
    );
    setWishlistTab('cart');
  }

  function toggleMarketComparisonProduct(product: MarketProduct) {
    setMarketComparison({ status: 'idle' });
    setMarketComparisonProducts((current) => {
      if (current.some((entry) => entry.url === product.url)) {
        return current.filter((entry) => entry.url !== product.url);
      }
      return [...current, product].slice(0, 6);
    });
  }

  function removeMarketComparisonProduct(url: string) {
    setMarketComparison({ status: 'idle' });
    setMarketComparisonProducts((current) => current.filter((entry) => entry.url !== url));
  }

  function runMarketComparison() {
    if (marketComparisonProducts.length < 2) {
      setMarketComparison({ status: 'error', error: 'Select at least two products to compare.' });
      return;
    }
    setMarketComparison({ status: 'loading' });
    compareMarketProducts(marketComparisonProducts)
      .then((result) => setMarketComparison({ status: 'ready', result }))
      .catch((error) => setMarketComparison({ status: 'error', error: (error as Error).message }));
  }

  useEffect(() => {
    if (mode !== 'wishlist' && mode !== 'priority-picks') return;

    const missing = [...state.buyList, ...state.needList, ...state.squidGameWinnerList]
      .filter((item) => !item.imageUrl && !hydratedPhotoIdsRef.current.has(item.id))
      .slice(0, 6);
    if (missing.length === 0) return;

    for (const item of missing) {
      hydratedPhotoIdsRef.current.add(item.id);
    }
    runMutation({ op: 'hydrate_buy_item_photos', itemIds: missing.map((item) => item.id) });
  }, [mode, state.buyList, state.needList, state.squidGameWinnerList]);

  function savePriorityBudget() {
    const amount = Number(budgetDraft || '0');
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Budget amount must be zero or more');
      setBudgetDraft(String(state.priorityPicksBudget || ''));
      return;
    }
    if (amount === state.priorityPicksBudget) return;
    runMutation(
      { op: 'set_priority_picks_budget', amount },
      (current) => ({ ...current, priorityPicksBudget: amount }),
    );
  }

  function movePriorityPick(itemId: string, targetList: PriorityListKey, targetIndex: number) {
    runMutation(
      { op: 'move_priority_pick_item', itemId, targetList, targetIndex },
      (current) => applyPriorityMove(current, itemId, targetList, targetIndex),
    );
  }

  function handlePriorityContainerDrop(targetList: PriorityListKey) {
    const src = priorityDrag;
    setPriorityDropTarget(null);
    setPriorityDropIndicator(null);
    setPriorityDrag(null);
    if (!src) return;
    movePriorityPick(src.itemId, targetList, getPriorityList(state, targetList).length);
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
    <div className={`relative space-y-6 ${dragState ? 'expense-board-dragging' : ''}`}>
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

      {mode === 'reports' && <ReportsView state={state} summary={summary} />}

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

      {mode === 'priority-picks' && (
        <>
          <section className="card-panel">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="section-title mb-1">Total Expense Budget</h2>
                <p className="text-sm font-semibold text-duored-muted">
                  This budget is saved with your finance state and ready for later calculations.
                </p>
              </div>
              <label className="w-full max-w-sm">
                <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-duored-muted">Budget amount</span>
                <input
                  className="text-input w-full text-lg font-extrabold"
                  type="number"
                  min="0"
                  step="1"
                  value={budgetDraft}
                  onChange={(event) => setBudgetDraft(event.target.value)}
                  onBlur={savePriorityBudget}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="0"
                />
              </label>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {([
              {
                key: 'buy' as const,
                title: 'To Buy Items',
                items: state.buyList,
                empty: 'No to-buy items left here.',
              },
              {
                key: 'winner' as const,
                title: 'SquidGame Winner Items',
                items: state.squidGameWinnerList,
                empty: 'Drag winners here from To Buy Items.',
              },
            ]).map((list) => (
              <div key={list.key} className="card-panel min-h-[32rem]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="section-title mb-0">{list.title}</h2>
                  <span className="chip-soft">{list.items.length}</span>
                </div>
                <div
                  className={`relative max-h-[68vh] min-h-[26rem] overflow-y-auto rounded-xl p-1 transition-all duration-200
                    ${priorityDropTarget === list.key ? 'bg-duored-soft/50 ring-2 ring-duored-main/40' : ''}
                  `}
                  onDragOver={(event) => {
                    if (!priorityDrag) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDragEnter={(event) => {
                    if (!priorityDrag) return;
                    event.preventDefault();
                    setPriorityDropTarget(list.key);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                      setPriorityDropTarget(null);
                      setPriorityDropIndicator(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handlePriorityContainerDrop(list.key);
                  }}
                >
                  {list.items.length === 0 ? (
                    <div className="flex min-h-[24rem] items-center justify-center rounded-xl border-2 border-dashed border-duored-border bg-white/60 px-4 text-center font-bold text-duored-muted">
                      {list.empty}
                    </div>
                  ) : (
                    <ol className="space-y-2">
                      {list.items.map((item, index) => (
                        <PriorityPickRow
                          key={item.id}
                          item={item}
                          index={index}
                          list={list.key}
                          isDragging={priorityDrag?.itemId === item.id}
                          dropPosition={
                            priorityDropIndicator?.list === list.key &&
                            priorityDropIndicator.index === index &&
                            priorityDrag?.itemId !== item.id
                              ? priorityDropIndicator.position
                              : null
                          }
                          onDragStart={() => {
                            setPriorityDrag({ itemId: item.id, fromList: list.key });
                            setPriorityDropTarget(list.key);
                          }}
                          onDragEnd={() => {
                            setPriorityDrag(null);
                            setPriorityDropTarget(null);
                            setPriorityDropIndicator(null);
                          }}
                          onDragOver={(idx, position) => {
                            if (!priorityDrag || priorityDrag.itemId === item.id) return;
                            setPriorityDropTarget(list.key);
                            setPriorityDropIndicator((current) =>
                              current?.list === list.key && current.index === idx && current.position === position
                                ? current
                                : { list: list.key, index: idx, position },
                            );
                          }}
                          onDragLeave={() => {
                            setPriorityDropIndicator((current) =>
                              current?.list === list.key && current.index === index ? null : current,
                            );
                          }}
                          onDrop={(idx, position) => {
                            const src = priorityDrag;
                            setPriorityDrag(null);
                            setPriorityDropTarget(null);
                            setPriorityDropIndicator(null);
                            if (!src || src.itemId === item.id) return;
                            movePriorityPick(src.itemId, list.key, position === 'before' ? idx : idx + 1);
                          }}
                        />
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {mode === 'wishlist' && (
        <>
          <section className="flex flex-wrap gap-2">
            {[
              ['explore', 'Explore Market'],
              ['compare', `Compare (${marketComparisonProducts.length})`],
              ['cart', `Cart (${state.buyList.length + state.needList.length})`],
            ].map(([tab, label]) => (
              <button
                key={tab}
                className={[
                  'btn-duo',
                  wishlistTab === tab
                    ? 'bg-duored-main text-white shadow-duored'
                    : 'border-2 border-duored-border bg-white text-duored-ink shadow-card',
                ].join(' ')}
                type="button"
                onClick={() => setWishlistTab(tab as 'explore' | 'compare' | 'cart')}
              >
                {label}
              </button>
            ))}
          </section>

          {wishlistTab === 'explore' ? (
            <MarketExplorer
              isPending={isPending}
              comparisonProducts={marketComparisonProducts}
              onAddProduct={addMarketProductToCart}
              onToggleCompare={toggleMarketComparisonProduct}
            />
          ) : wishlistTab === 'compare' ? (
            <CompareMarketView
              products={marketComparisonProducts}
              comparison={marketComparison}
              onRemove={removeMarketComparisonProduct}
              onClear={() => {
                setMarketComparisonProducts([]);
                setMarketComparison({ status: 'idle' });
              }}
              onCompare={runMarketComparison}
            />
          ) : (
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
        </>
      )}
    </div>
  );
}
