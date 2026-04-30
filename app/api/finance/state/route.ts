import {
  getCookieFinanceStore,
  markCookieStoreDirty,
  setCookieFinanceStore,
} from '@/lib/finance-store';
import { readDriveFinanceStore } from '@/lib/finance-drive';
import { getSession } from '@/lib/session';
import { normalizeMoney } from '@/lib/finance-math';
import type {
  BuyListItem,
  ExpenseBucket,
  ExpenseCadence,
  ExpenseCategory,
  ExpenseEntry,
  FeatureRequestEntry,
  FinanceStore,
} from '@/lib/finance-types';
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
  const allowed = new Set<ExpenseCategory>(['maintenance', 'savings', 'money+']);
  const v = value.trim().toLowerCase() as ExpenseCategory;
  return allowed.has(v) ? v : 'maintenance';
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

function sanitizeImageUrl(value: unknown): string | undefined {
  const out = String(value ?? '').trim().slice(0, 1000);
  return out || undefined;
}

function sanitizeSourceUrl(value: unknown): string | undefined {
  const out = String(value ?? '').trim().slice(0, 1000);
  return assertUrl(out) ? out : undefined;
}

function lastReturnableDate(days?: number): string | undefined {
  if (!days || days <= 0) return undefined;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function loadAuthoritativeState(): Promise<FinanceStore> {
  const cookieStore = await getCookieFinanceStore();
  const session = await getSession();
  const accessToken = session?.accessToken ?? null;
  if (!accessToken) return cookieStore;

  try {
    const drive = await readDriveFinanceStore(accessToken);
    if (drive) {
      return {
        monthlyIncome: drive.monthlyIncome,
        expenses: drive.expenses,
        buyList: drive.buyList,
        needList: drive.needList,
        requests: drive.requests,
      };
    }
  } catch {
    // fall through to cookie copy
  }
  return cookieStore;
}

async function loadMutationState(): Promise<FinanceStore> {
  return getCookieFinanceStore();
}

async function persist(next: FinanceStore) {
  await setCookieFinanceStore(next);
  await markCookieStoreDirty();
  return Response.json({ ok: true, state: next });
}

export async function GET() {
  const state = await loadAuthoritativeState();
  return Response.json({ ok: true, state });
}

export async function POST(req: Request) {
  const state = await loadMutationState();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('Invalid request body');
  }

  const op = String(body.op ?? '').trim();

  if (op === 'set_income') {
    return persist(
      {
        ...state,
        monthlyIncome: normalizeMoney(body.monthlyIncome),
      },
    );
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
      imageUrl: sanitizeImageUrl(body.imageUrl),
      sourceUrl: sanitizeSourceUrl(body.sourceUrl),
      sourcePlatform: String(body.sourcePlatform ?? '').trim().slice(0, 80) || undefined,
    };

    return persist({ ...state, expenses: [entry, ...state.expenses] });
  }

  if (op === 'remove_expense') {
    const expenseId = String(body.expenseId ?? '').trim();
    return persist(
      {
        ...state,
        expenses: state.expenses.filter((entry) => entry.id !== expenseId),
      },
    );
  }

  if (op === 'clear_expenses') {
    const bucket = String(body.bucket ?? '').trim().toLowerCase();
    const nextExpenses = bucket === 'predicted' || bucket === 'actual'
      ? state.expenses.filter((entry) => entry.bucket !== bucket)
      : [];
    return persist(
      {
        ...state,
        expenses: nextExpenses,
      },
    );
  }

  if (op === 'move_expense') {
    const expenseId = String(body.expenseId ?? '').trim();
    if (!expenseId) return fail('Expense id is required');

    const existing = state.expenses.find((entry) => entry.id === expenseId);
    if (!existing) return fail('Expense not found', 404);

    const category = normalizeExpenseCategory(String(body.category ?? existing.category));
    const updatedEntry: ExpenseEntry = {
      ...existing,
      category,
      subCategory: category === 'maintenance' ? existing.subCategory : undefined,
      imageUrl: existing.imageUrl,
    };

    return persist(
      {
        ...state,
        expenses: state.expenses.map((entry) => (entry.id === expenseId ? updatedEntry : entry)),
      },
    );
  }

  if (op === 'edit_expense') {
    const expenseId = String(body.expenseId ?? '').trim();
    if (!expenseId) return fail('Expense id is required');

    const existing = state.expenses.find((entry) => entry.id === expenseId);
    if (!existing) return fail('Expense not found', 404);

    const title = toTitleCase(String(body.title ?? ''));
    if (!title) return fail('Expense title is required');

    const amount = normalizeMoney(body.amount);
    if (amount <= 0) return fail('Expense amount must be greater than 0');

    const bucket = normalizeExpenseBucket(String(body.bucket ?? existing.bucket));
    const category = normalizeExpenseCategory(String(body.category ?? existing.category));
    const cadence = normalizeCadence(
      String(body.frequency ?? body.cadence ?? (bucket === 'predicted' ? existing.cadence : 'one-time')),
    );
    if (bucket === 'predicted' && cadence === 'one-time') {
      return fail('Predicted expenses need a recurring frequency');
    }

    const updatedEntry: ExpenseEntry = {
      ...existing,
      title,
      amount,
      bucket,
      category,
      subCategory: normalizeSubCategory(category, body.subCategory),
      cadence: bucket === 'actual' ? 'one-time' : cadence,
      spentOn: new Date(String(body.spentOn ?? existing.spentOn)).toISOString(),
      notes: String(body.notes ?? '').trim() || undefined,
      imageUrl: sanitizeImageUrl(body.imageUrl) ?? existing.imageUrl,
    };

    return persist(
      {
        ...state,
        expenses: state.expenses.map((entry) => (entry.id === expenseId ? updatedEntry : entry)),
      },
    );
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
        imageUrl: sanitizeImageUrl(r.imageUrl),
        sourceUrl: sanitizeSourceUrl(r.sourceUrl),
        sourcePlatform: String(r.sourcePlatform ?? '').trim().slice(0, 80) || undefined,
      });
    }

    return persist({ ...state, expenses: [...fresh, ...state.expenses] });
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

    // YouTube videos are free - allow price of 0 for them
    if (price <= 0 && sourcePlatform !== 'YouTube') {
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
      imageUrl: sanitizeImageUrl(body.imageUrl) ?? extracted.imageUrl,
      returnable: extracted.returnable,
      returnDays: extracted.returnDays,
      lastReturnableOn: lastReturnableDate(extracted.returnDays),
    };
    return persist({ ...state, buyList: [...state.buyList, item] });
  }

  if (op === 'mark_buy_item_bought') {
    const itemId = String(body.itemId ?? '').trim();
    const item = state.buyList.find((entry) => entry.id === itemId);
    if (!item) return fail('Item not found', 404);

    const notes = [
      item.notes?.trim(),
      item.sourcePlatform ? `Bought via ${item.sourcePlatform}` : '',
      item.returnable
        ? `Returnable${item.returnDays ? ` for ${item.returnDays} days` : ''}${item.lastReturnableOn ? ` until ${item.lastReturnableOn}` : ''}`
        : 'Not returnable',
    ]
      .filter(Boolean)
      .join(' | ');

    const expense: ExpenseEntry = {
      id: id(),
      title: toTitleCase(item.title),
      amount: normalizeMoney(item.price),
      bucket: 'actual',
      category: normalizeExpenseCategory(String(body.category ?? 'maintenance')),
      subCategory: normalizeSubCategory(normalizeExpenseCategory(String(body.category ?? 'maintenance')), body.subCategory),
      cadence: 'one-time',
      spentOn: new Date().toISOString(),
      notes: notes || undefined,
      imageUrl: item.imageUrl,
      sourceUrl: item.url,
      sourcePlatform: item.sourcePlatform,
    };

    return persist(
      {
        ...state,
        expenses: [expense, ...state.expenses],
        buyList: state.buyList.filter((entry) => entry.id !== itemId),
      },
    );
  }

  if (op === 'remove_buy_item') {
    const itemId = String(body.itemId ?? '').trim();
    return persist(
      {
        ...state,
        buyList: state.buyList.filter((entry) => entry.id !== itemId),
      },
    );
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

    return persist(
      {
        ...state,
        buyList: moveItem(state.buyList, index, target),
      },
    );
  }

  if (op === 'reorder_buy_item') {
    const itemId = String(body.itemId ?? '').trim();
    const targetIndex = Math.max(0, Math.min(state.buyList.length - 1, Number(body.targetIndex ?? 0)));
    const fromIndex = state.buyList.findIndex((item) => item.id === itemId);
    if (fromIndex === -1) return fail('Item not found', 404);
    if (fromIndex === targetIndex) return Response.json({ ok: true, state });
    return persist({ ...state, buyList: moveItem(state.buyList, fromIndex, targetIndex) });
  }

  if (op === 'move_to_need_list') {
    const itemId = String(body.itemId ?? '').trim();
    const item = state.buyList.find((entry) => entry.id === itemId);
    if (!item) return fail('Item not found', 404);
    return persist({
      ...state,
      buyList: state.buyList.filter((entry) => entry.id !== itemId),
      needList: [item, ...state.needList],
    });
  }

  if (op === 'move_to_buy_list') {
    const itemId = String(body.itemId ?? '').trim();
    const item = state.needList.find((entry) => entry.id === itemId);
    if (!item) return fail('Item not found', 404);
    return persist({
      ...state,
      needList: state.needList.filter((entry) => entry.id !== itemId),
      buyList: [item, ...state.buyList],
    });
  }

  if (op === 'remove_need_item') {
    const itemId = String(body.itemId ?? '').trim();
    return persist({ ...state, needList: state.needList.filter((entry) => entry.id !== itemId) });
  }

  if (op === 'move_need_item') {
    const itemId = String(body.itemId ?? '').trim();
    const direction = String(body.direction ?? '').trim();
    const index = state.needList.findIndex((item) => item.id === itemId);
    if (index === -1) return fail('Item not found', 404);

    let target = index;
    if (direction === 'up') target = Math.max(0, index - 1);
    if (direction === 'down') target = Math.min(state.needList.length - 1, index + 1);
    if (target === index) return Response.json({ ok: true, state });

    return persist({ ...state, needList: moveItem(state.needList, index, target) });
  }

  if (op === 'mark_need_item_bought') {
    const itemId = String(body.itemId ?? '').trim();
    const item = state.needList.find((entry) => entry.id === itemId);
    if (!item) return fail('Item not found', 404);

    const notes = [
      item.notes?.trim(),
      item.sourcePlatform ? `Bought via ${item.sourcePlatform}` : '',
      item.returnable
        ? `Returnable${item.returnDays ? ` for ${item.returnDays} days` : ''}${item.lastReturnableOn ? ` until ${item.lastReturnableOn}` : ''}`
        : 'Not returnable',
    ]
      .filter(Boolean)
      .join(' | ');

    const expense: ExpenseEntry = {
      id: id(),
      title: toTitleCase(item.title),
      amount: normalizeMoney(item.price),
      bucket: 'actual',
      category: normalizeExpenseCategory(String(body.category ?? 'maintenance')),
      subCategory: normalizeSubCategory(normalizeExpenseCategory(String(body.category ?? 'maintenance')), body.subCategory),
      cadence: 'one-time',
      spentOn: new Date().toISOString(),
      notes: notes || undefined,
      imageUrl: item.imageUrl,
      sourceUrl: item.url,
      sourcePlatform: item.sourcePlatform,
    };

    return persist({
      ...state,
      expenses: [expense, ...state.expenses],
      needList: state.needList.filter((entry) => entry.id !== itemId),
    });
  }

  if (op === 'add_request') {
    const description = String(body.description ?? '').trim().slice(0, 500);
    if (!description) return fail('Request description is required');

    const request: FeatureRequestEntry = {
      id: id(),
      description,
      createdAt: new Date().toISOString(),
    };

    return persist(
      {
        ...state,
        requests: [request, ...state.requests],
      },
    );
  }

  if (op === 'remove_request') {
    const requestId = String(body.requestId ?? '').trim();
    return persist(
      {
        ...state,
        requests: state.requests.filter((entry) => entry.id !== requestId),
      },
    );
  }

  return fail('Unsupported operation');
}
