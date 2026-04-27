import { cookies } from 'next/headers';
import { DEFAULT_FINANCE_STORE, type BuyListItem, type ExpenseEntry, type FinanceStore } from './finance-types';
import { normalizeMoney } from './finance-math';

const COOKIE = 'finance_manager_state';
const COOKIE_CHUNKS = 'finance_manager_state_chunks';
const COOKIE_CHUNK_PREFIX = 'finance_manager_state_chunk_';
const DRIVE_READY_COOKIE = 'finance_manager_drive_ready';
const LOCAL_UPDATED_COOKIE = 'finance_manager_local_updated_at';
const LOCAL_DIRTY_COOKIE = 'finance_manager_local_dirty';
const MAX_AGE = 60 * 60 * 24 * 365;
const MAX_COOKIE_CHUNK_SIZE = 3000;

function cleanId(value: string): string {
  return value.trim().slice(0, 120);
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = cleanId(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...item, id });
  }
  return out;
}

function normalizeExpense(entry: Partial<ExpenseEntry>): ExpenseEntry | null {
  const id = cleanId(String(entry.id ?? ''));
  const title = String(entry.title ?? '').trim().slice(0, 120);
  if (!id || !title) return null;

  const allowedCategories = new Set<ExpenseEntry['category']>([
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
  const rawCategory = String(entry.category ?? 'other').trim().toLowerCase() as ExpenseEntry['category'];
  const category = allowedCategories.has(rawCategory) ? rawCategory : 'other';
  const subCategory = String(entry.subCategory ?? '').trim().slice(0, 60) || undefined;
  const rawCadence = String(entry.cadence ?? 'one-time').trim().toLowerCase();
  const cadence = (
    ['one-time', 'daily', 'weekly', 'monthly', 'yearly', 'custom'].includes(rawCadence)
      ? rawCadence
      : 'one-time'
  ) as ExpenseEntry['cadence'];
  const spentOn = String(entry.spentOn ?? new Date().toISOString()).trim();

  return {
    id,
    title,
    amount: normalizeMoney(entry.amount),
    bucket: entry.bucket === 'predicted' ? 'predicted' : 'actual',
    category,
    subCategory: category === 'maintenance' ? subCategory : undefined,
    cadence,
    spentOn: new Date(spentOn).toISOString(),
    notes: String(entry.notes ?? '').trim().slice(0, 240) || undefined,
  };
}

function normalizeBuyListItem(item: Partial<BuyListItem>): BuyListItem | null {
  const id = cleanId(String(item.id ?? ''));
  const title = String(item.title ?? '').trim().slice(0, 120);
  if (!id || !title) return null;
  const url = String(item.url ?? '').trim().slice(0, 500);
  if (!url) return null;

  return {
    id,
    title,
    url,
    price: normalizeMoney(item.price),
    sourcePlatform: String(item.sourcePlatform ?? '').trim() || undefined,
    currency: String(item.currency ?? '').trim().toUpperCase() || undefined,
    notes: String(item.notes ?? '').trim().slice(0, 240) || undefined,
    createdAt: new Date(String(item.createdAt ?? new Date().toISOString())).toISOString(),
  };
}

export function normalizeFinanceStore(store: Partial<FinanceStore> | null | undefined): FinanceStore {
  const normalizedExpenses = uniqueById(
    (store?.expenses ?? [])
      .map((item) => normalizeExpense(item))
      .filter((item): item is ExpenseEntry => !!item),
  );
  const normalizedBuyList = uniqueById(
    (store?.buyList ?? [])
      .map((item) => normalizeBuyListItem(item))
      .filter((item): item is BuyListItem => !!item),
  );

  return {
    monthlyIncome: normalizeMoney(store?.monthlyIncome),
    expenses: normalizedExpenses,
    buyList: normalizedBuyList,
  };
}

function parseState(raw: string): FinanceStore {
  const value = raw.trim();
  if (!value) return DEFAULT_FINANCE_STORE;

  try {
    return normalizeFinanceStore(JSON.parse(value) as Partial<FinanceStore>);
  } catch {
    return DEFAULT_FINANCE_STORE;
  }
}

export async function getCookieFinanceStore(): Promise<FinanceStore> {
  const jar = await cookies();
  const chunkCount = Number(jar.get(COOKIE_CHUNKS)?.value ?? '0');
  if (Number.isInteger(chunkCount) && chunkCount > 0) {
    const parts: string[] = [];
    for (let index = 0; index < chunkCount; index += 1) {
      const value = jar.get(`${COOKIE_CHUNK_PREFIX}${index}`)?.value;
      if (!value) {
        parts.length = 0;
        break;
      }
      parts.push(value);
    }

    if (parts.length === chunkCount) {
      return parseState(parts.join(''));
    }
  }

  const raw = jar.get(COOKIE)?.value ?? '';
  return parseState(raw);
}

export async function setCookieFinanceStore(store: FinanceStore): Promise<void> {
  const jar = await cookies();
  const serialized = JSON.stringify(normalizeFinanceStore(store));
  const previousChunkCount = Number(jar.get(COOKIE_CHUNKS)?.value ?? '0');

  if (Number.isInteger(previousChunkCount) && previousChunkCount > 0) {
    for (let index = 0; index < previousChunkCount; index += 1) {
      jar.delete(`${COOKIE_CHUNK_PREFIX}${index}`);
    }
    jar.delete(COOKIE_CHUNKS);
  }

  if (serialized.length <= MAX_COOKIE_CHUNK_SIZE) {
    jar.set(COOKIE, serialized, {
      maxAge: MAX_AGE,
      path: '/',
      sameSite: 'lax',
    });
    return;
  }

  jar.delete(COOKIE);

  const parts: string[] = [];
  for (let start = 0; start < serialized.length; start += MAX_COOKIE_CHUNK_SIZE) {
    parts.push(serialized.slice(start, start + MAX_COOKIE_CHUNK_SIZE));
  }

  for (let index = 0; index < parts.length; index += 1) {
    jar.set(`${COOKIE_CHUNK_PREFIX}${index}`, parts[index], {
      maxAge: MAX_AGE,
      path: '/',
      sameSite: 'lax',
    });
  }
  jar.set(COOKIE_CHUNKS, String(parts.length), {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function clearCookieFinanceStore(): Promise<void> {
  const jar = await cookies();
  const chunkCount = Number(jar.get(COOKIE_CHUNKS)?.value ?? '0');
  if (Number.isInteger(chunkCount) && chunkCount > 0) {
    for (let index = 0; index < chunkCount; index += 1) {
      jar.delete(`${COOKIE_CHUNK_PREFIX}${index}`);
    }
  }

  jar.delete(COOKIE);
  jar.delete(COOKIE_CHUNKS);
  jar.delete(DRIVE_READY_COOKIE);
  jar.delete(LOCAL_UPDATED_COOKIE);
  jar.delete(LOCAL_DIRTY_COOKIE);
}

export async function hasDriveSyncHydrated(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(DRIVE_READY_COOKIE)?.value === '1';
}

export async function markDriveSyncHydrated(): Promise<void> {
  const jar = await cookies();
  jar.set(DRIVE_READY_COOKIE, '1', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function getCookieSyncMeta(): Promise<{ updatedAt: string | null; dirty: boolean }> {
  const jar = await cookies();
  return {
    updatedAt: jar.get(LOCAL_UPDATED_COOKIE)?.value ?? null,
    dirty: jar.get(LOCAL_DIRTY_COOKIE)?.value === '1',
  };
}

export async function markCookieStoreDirty(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
  jar.set(LOCAL_DIRTY_COOKIE, '1', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}

export async function markCookieStoreSynced(updatedAt = new Date().toISOString()): Promise<void> {
  const jar = await cookies();
  jar.set(LOCAL_UPDATED_COOKIE, updatedAt, {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
  jar.set(LOCAL_DIRTY_COOKIE, '0', {
    maxAge: MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });
}
