import { readDriveFinanceStore, writeDriveFinanceStore } from '@/lib/finance-drive';
import {
  getCookieFinanceStore,
  getCookieSyncMeta,
  hasDriveSyncHydrated,
  markCookieStoreSynced,
  markDriveSyncHydrated,
  setCookieFinanceStore,
} from '@/lib/finance-store';
import { getSession } from '@/lib/session';
import type { FinanceStore } from '@/lib/finance-types';

function sameStore(a: FinanceStore, b: FinanceStore): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let cookieStore: FinanceStore = { monthlyIncome: 0, expenses: [], buyList: [] };
  let driveData = null;
  let localMeta = { updatedAt: null as string | null, dirty: false };
  try {
    [cookieStore, driveData, localMeta] = await Promise.all([
      getCookieFinanceStore(),
      readDriveFinanceStore(session.accessToken),
      getCookieSyncMeta(),
    ]);
  } catch {
    return Response.json({ error: 'Failed to read Drive sync state' }, { status: 502 });
  }

  const driveStore: FinanceStore = driveData
    ? { monthlyIncome: driveData.monthlyIncome, expenses: driveData.expenses, buyList: driveData.buyList }
    : { monthlyIncome: 0, expenses: [], buyList: [] };

  return Response.json({
    driveItems: driveStore.buyList.length,
    localItems: cookieStore.buyList.length,
    initialized: await hasDriveSyncHydrated(),
    synced: sameStore(cookieStore, driveStore) && !localMeta.dirty,
    updatedAt: driveData?.updatedAt ?? null,
  });
}

export async function POST() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  const cookieStore = await getCookieFinanceStore();
  const localMeta = await getCookieSyncMeta();

  try {
    const driveData = await readDriveFinanceStore(session.accessToken);

    if (driveData && !localMeta.dirty) {
      const driveStore: FinanceStore = {
        monthlyIncome: driveData.monthlyIncome,
        expenses: driveData.expenses,
        buyList: driveData.buyList,
      };
      const replacedLocal = !sameStore(cookieStore, driveStore);

      await setCookieFinanceStore(driveStore);
      await markCookieStoreSynced(driveData.updatedAt);
      await markDriveSyncHydrated();

      return Response.json({
        ok: true,
        initialized: true,
        driveWins: true,
        replacedLocal,
        updatedAt: driveData.updatedAt,
      });
    }

    const syncedAt = await writeDriveFinanceStore(session.accessToken, cookieStore);
    await markCookieStoreSynced(syncedAt);
    await markDriveSyncHydrated();

    return Response.json({
      ok: true,
      initialized: true,
      seededFromLocal: true,
      updatedAt: syncedAt,
    });
  } catch {
    return Response.json({ error: 'Failed to write Drive sync state' }, { status: 502 });
  }
}

export async function PUT() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let driveData = null;
  try {
    driveData = await readDriveFinanceStore(session.accessToken);
  } catch {
    return Response.json({ error: 'Failed to pull finance data from Drive' }, { status: 502 });
  }

  if (!driveData) {
    await markDriveSyncHydrated();
    return Response.json({ ok: true, initialized: true });
  }

  await setCookieFinanceStore({
    monthlyIncome: driveData.monthlyIncome,
    expenses: driveData.expenses,
    buyList: driveData.buyList,
  });
  await markCookieStoreSynced(driveData.updatedAt);
  await markDriveSyncHydrated();
  return Response.json({ ok: true, initialized: true });
}
