import { readFileSync } from 'fs';
import { writeDriveFinanceStore } from '@/lib/finance-drive';
import { getCookieFinanceStore, markCookieStoreSynced, markDriveSyncHydrated, setCookieFinanceStore } from '@/lib/finance-store';
import { getSession } from '@/lib/session';
import type { ExpenseCategory, ExpenseEntry } from '@/lib/finance-types';

const CSV_PATH = 'D:\\finanace_manager\\axio_expense_report_8878093599_1777215978955181.csv';

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, '').trim()) || 0;
}

function mapCategory(csvCategory: string, place: string): ExpenseCategory {
  const p = place.toUpperCase();
  if (p.includes('CHATGPT') || p.includes('CLAUDE') || p.includes('JIO') || p.includes('GOOGLEPLA')) return 'subscriptions';
  switch (csvCategory.trim().toUpperCase()) {
    case 'SHOPPING': return 'purchases';
    case 'GROCERIES': return 'purchases';
    case 'UTILITIES': return 'utilities';
    case 'BILLS': return 'utilities';
    case 'FUEL': return 'fuel';
    case 'INSURANCE': return 'insurance';
    case 'MAINTENANCE': return 'maintenance';
    default: return 'other';
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Import only available in development' }, { status: 403 });
  }

  const session = await getSession();
  if (!session?.user || !session.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let csv: string;
  try {
    csv = readFileSync(CSV_PATH, 'utf-8');
  } catch {
    return Response.json({ error: 'CSV file not found: ' + CSV_PATH }, { status: 404 });
  }

  const lines = csv.split('\n');
  const dataStart = lines.findIndex((l) => l.startsWith('"DATE"'));
  if (dataStart === -1) return Response.json({ error: 'Could not find header row' }, { status: 400 });

  const entries: ExpenseEntry[] = [];

  for (let i = dataStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('"",""')) continue;

    const cols = line.split('","').map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.length < 9) continue;

    const [date, , place, amountRaw, drCr, , expense, , category, , note] = cols;

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    if (drCr !== 'DR') continue;
    if (expense !== 'Yes') continue;
    if (place.toUpperCase() === 'NET BANKING') continue;

    const amount = parseAmount(amountRaw);
    if (amount <= 0) continue;

    entries.push({
      id: `csv-${Date.now()}-${entries.length}`,
      title: toTitleCase(place),
      amount,
      bucket: 'actual',
      category: mapCategory(category, place),
      cadence: 'one-time',
      spentOn: date,
      notes: note && note !== '-' && note !== "'-" ? note : undefined,
    });
  }

  const store = await getCookieFinanceStore();
  const existingKey = new Set(store.expenses.map((e) => e.spentOn + e.title + e.amount));
  const fresh = entries.filter((e) => !existingKey.has(e.spentOn + e.title + e.amount));

  const updated = { ...store, expenses: [...fresh, ...store.expenses] };

  // write to cookies
  await setCookieFinanceStore(updated);

  // push to Drive so the sync PUT doesn't overwrite with old data
  const syncedAt = await writeDriveFinanceStore(session.accessToken, updated);
  await markCookieStoreSynced(syncedAt);
  await markDriveSyncHydrated();

  return Response.json({ ok: true, imported: fresh.length, skipped: entries.length - fresh.length });
}
