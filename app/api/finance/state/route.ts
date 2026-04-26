import {
  getCookieFinanceStore,
  markCookieStoreDirty,
  setCookieFinanceStore,
} from '@/lib/finance-store';
import { normalizeMoney } from '@/lib/finance-math';
import type { BuyListItem, ExpenseCadence, ExpenseCategory, ExpenseEntry, FinanceStore } from '@/lib/finance-types';
import { extractProductDetails } from '@/lib/product-extractor';

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function id(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function assertUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function normalizeExpenseCategory(value: string): ExpenseCategory {
  const allowed = new Set<ExpenseCategory>([
    'purchases',
    'services',
    'investments',
    'subscriptions',
    'utilities',
    'fuel',
    'insurance',
    'maintenance',
    'other',
  ]);
  const v = value.trim().toLowerCase() as ExpenseCategory;
  return allowed.has(v) ? v : 'other';
}

function normalizeCadence(value: string): ExpenseCadence {
  const allowed = new Set<ExpenseCadence>(['one-time', 'daily', 'weekly', 'monthly', 'yearly', 'custom']);
  const v = value.trim().toLowerCase() as ExpenseCadence;
  return allowed.has(v) ? v : 'one-time';
}

async function persist(next: FinanceStore) {
  await setCookieFinanceStore(next);
  await markCookieStoreDirty();
  return Response.json({ ok: true, state: next });
}

export async function GET() {
  const state = await getCookieFinanceStore();
  return Response.json({ ok: true, state });
}

export async function POST(req: Request) {
  const state = await getCookieFinanceStore();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('Invalid request body');
  }

  const op = String(body.op ?? '').trim();

  if (op === 'set_income') {
    return persist({
      ...state,
      monthlyIncome: normalizeMoney(body.monthlyIncome),
    });
  }

  if (op === 'add_expense') {
    const title = String(body.title ?? '').trim();
    if (!title) return fail('Expense title is required');
    const amount = normalizeMoney(body.amount);
    if (amount <= 0) return fail('Expense amount must be greater than 0');

    const entry: ExpenseEntry = {
      id: id(),
      title,
      amount,
      category: normalizeExpenseCategory(String(body.category ?? 'other')),
      cadence: normalizeCadence(String(body.frequency ?? body.cadence ?? 'one-time')),
      spentOn: new Date(String(body.spentOn ?? new Date().toISOString())).toISOString(),
      notes: String(body.notes ?? '').trim() || undefined,
    };

    return persist({ ...state, expenses: [entry, ...state.expenses] });
  }

  if (op === 'remove_expense') {
    const expenseId = String(body.expenseId ?? '').trim();
    return persist({
      ...state,
      expenses: state.expenses.filter((entry) => entry.id !== expenseId),
    });
  }

  if (op === 'add_buy_item') {
    const url = String(body.url ?? '').trim();
    let title = String(body.title ?? '').trim();
    let price = normalizeMoney(body.price);
    let sourcePlatform = '';
    let currency = '';

    if (!url || !assertUrl(url)) return fail('A valid product URL is required');

    const extracted = await extractProductDetails(url);
    if (!title) title = extracted.title;
    if (price <= 0) price = extracted.price;
    sourcePlatform = extracted.sourcePlatform;
    currency = extracted.currency;

    if (!title) return fail('Could not extract product title from this URL');
    if (price <= 0) {
      return fail('Could not extract product price from this URL. Please try another product link.');
    }

    const item: BuyListItem = {
      id: id(),
      title,
      url,
      price,
      sourcePlatform,
      currency,
      notes: String(body.notes ?? '').trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    return persist({ ...state, buyList: [...state.buyList, item] });
  }

  if (op === 'remove_buy_item') {
    const itemId = String(body.itemId ?? '').trim();
    return persist({
      ...state,
      buyList: state.buyList.filter((entry) => entry.id !== itemId),
    });
  }

  if (op === 'move_buy_item') {
    const itemId = String(body.itemId ?? '').trim();
    const direction = String(body.direction ?? '').trim();
    const index = state.buyList.findIndex((item) => item.id === itemId);
    if (index === -1) return fail('Item not found', 404);

    let target = index;
    if (direction === 'up') target = Math.max(0, index - 1);
    if (direction === 'down') target = Math.min(state.buyList.length - 1, index + 1);
    if (target === index) return Response.json({ ok: true, state });

    return persist({
      ...state,
      buyList: moveItem(state.buyList, index, target),
    });
  }

  return fail('Unsupported operation');
}
