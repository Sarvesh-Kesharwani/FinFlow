import {
  getCookieFinanceStore,
  markCookieStoreDirty,
  markCookieStoreSynced,
  markDriveSyncHydrated,
  setCookieFinanceStore,
} from '@/lib/finance-store';
import { writeDriveFinanceStore } from '@/lib/finance-drive';
import { getSession } from '@/lib/session';
import { normalizeMoney } from '@/lib/finance-math';
import type { BuyListItem, ExpenseBucket, ExpenseCadence, ExpenseCategory, ExpenseEntry, FinanceStore } from '@/lib/finance-types';
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
    'savings',
    'money+',
    'other',
  ]);
  const v = value.trim().toLowerCase() as ExpenseCategory;
  return allowed.has(v) ? v : 'other';
}

function normalizeSubCategory(category: ExpenseCategory, value: unknown): string | undefined {
  if (category !== 'maintenance') return undefined;
  const v = String(value ?? '').trim().slice(0, 60);
  return v || undefined;
}

function normalizeCadence(value: string): ExpenseCadence {
  const allowed = new Set<ExpenseCadence>(['one-time', 'daily', 'weekly', 'bi-weekly', 'monthly', 'yearly', 'custom']);
  const v = value.trim().toLowerCase() as ExpenseCadence;
  return allowed.has(v) ? v : 'one-time';
}

function normalizeExpenseBucket(value: string): ExpenseBucket {
  const v = value.trim().toLowerCase();
  return v === 'predicted' ? 'predicted' : 'actual';
}

function toTitleCase(value: string): string {
  const parts = value
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  if (parts.length === 0) return '';

  return parts.map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
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
    const title = toTitleCase(String(body.title ?? ''));
    if (!title) return fail('Expense title is required');
    const amount = normalizeMoney(body.amount);
    if (amount <= 0) return fail('Expense amount must be greater than 0');

    const category = normalizeExpenseCategory(String(body.category ?? 'other'));
    const entry: ExpenseEntry = {
      id: id(),
      title,
      amount,
      bucket: normalizeExpenseBucket(String(body.bucket ?? 'actual')),
      category,
      subCategory: normalizeSubCategory(category, body.subCategory),
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

  if (op === 'bulk_add_expenses') {
    const incoming = Array.isArray(body.expenses) ? (body.expenses as unknown[]) : [];
    const existingKeys = new Set(state.expenses.map((e) => `${e.spentOn}|${e.title}|${e.amount}`));
    const fresh: ExpenseEntry[] = [];
    for (const raw of incoming) {
      const r = raw as Record<string, unknown>;
      const title = toTitleCase(String(r.title ?? ''));
      if (!title) continue;
      const amount = normalizeMoney(r.amount);
      if (amount <= 0) continue;
      const spentOn = String(r.spentOn ?? new Date().toISOString().slice(0, 10));
      const key = `${spentOn}|${title}|${amount}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const category = normalizeExpenseCategory(String(r.category ?? 'other'));
      fresh.push({
        id: id(),
        title,
        amount,
        bucket: 'actual',
        category,
        subCategory: normalizeSubCategory(category, r.subCategory),
        cadence: 'one-time',
        spentOn,
        notes: String(r.notes ?? '').trim() || undefined,
      });
    }

    const next = { ...state, expenses: [...fresh, ...state.expenses] };
    await setCookieFinanceStore(next);

    // Push to Drive synchronously so the import survives logout/login.
    // Falls back to dirty-marking if Drive is unavailable.
    const session = await getSession();
    if (session?.accessToken) {
      try {
        const syncedAt = await writeDriveFinanceStore(session.accessToken, next);
        await markCookieStoreSynced(syncedAt);
        await markDriveSyncHydrated();
      } catch {
        await markCookieStoreDirty();
      }
    } else {
      await markCookieStoreDirty();
    }

    return Response.json({ ok: true, state: next });
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
