import { readDriveFinanceStore, rotateDailyBackupIfStale, writeDriveFinanceStore } from '@/lib/finance-drive';
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

function hasFinanceData(store: FinanceStore): boolean {
  return (
    store.monthlyIncome > 0 ||
    store.priorityPicksBudget > 0 ||
    store.expenses.length > 0 ||
    store.buyList.length > 0 ||
    store.needList.length > 0 ||
    store.squidGameWinnerList.length > 0 ||
    store.requests.length > 0
  );
}

export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }

  let cookieStore: FinanceStore = {
    monthlyIncome: 0,
    priorityPicksBudget: 0,
    expenses: [],
    buyList: [],
    needList: [],
    squidGameWinnerList: [],
    requests: [],
  };
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
    ? {
        monthlyIncome: driveData.monthlyIncome,
        priorityPicksBudget: driveData.priorityPicksBudget,
        expenses: driveData.expenses,
        buyList: driveData.buyList,
        needList: driveData.needList,
        squidGameWinnerList: driveData.squidGameWinnerList,
        requests: driveData.requests,
      }
    : {
        monthlyIncome: 0,
        priorityPicksBudget: 0,
        expenses: [],
        buyList: [],
        needList: [],
        squidGameWinnerList: [],
        requests: [],
      };

  return Response.json({
    driveItems: driveStore.buyList.length,
    localItems: cookieStore.buyList.length,
    driveHasData: hasFinanceData(driveStore),
    localHasData: hasFinanceData(cookieStore),
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

  const [cookieStore, localMeta, hydrated] = await Promise.all([
    getCookieFinanceStore(),
    getCookieSyncMeta(),
    hasDriveSyncHydrated(),
  ]);

  try {
    const driveData = await readDriveFinanceStore(session.accessToken);

    if (driveData) {
      const driveStore: FinanceStore = {
        monthlyIncome: driveData.monthlyIncome,
        priorityPicksBudget: driveData.priorityPicksBudget,
        expenses: driveData.expenses,
        buyList: driveData.buyList,
        needList: driveData.needList,
        squidGameWinnerList: driveData.squidGameWinnerList,
        requests: driveData.requests,
      };
      try {
        await rotateDailyBackupIfStale(session.accessToken, driveData);
      } catch {
        // backup rotation failure must not block sync
      }
      if (hydrated && localMeta.dirty) {
        const syncedAt = await writeDriveFinanceStore(session.accessToken, cookieStore);
        await markCookieStoreSynced(syncedAt);
        await markDriveSyncHydrated();

        return Response.json({
          ok: true,
          initialized: true,
          seededFromLocal: true,
          updatedAt: syncedAt,
        });
      }

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
    priorityPicksBudget: driveData.priorityPicksBudget,
    expenses: driveData.expenses,
    buyList: driveData.buyList,
    needList: driveData.needList,
    squidGameWinnerList: driveData.squidGameWinnerList,
    requests: driveData.requests,
  });
  await markCookieStoreSynced(driveData.updatedAt);
  await markDriveSyncHydrated();
  return Response.json({ ok: true, initialized: true });
}
