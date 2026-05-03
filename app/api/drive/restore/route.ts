import { readDriveFinanceBackup, writeDriveFinanceStore } from '@/lib/finance-drive';
import {
  markCookieStoreSynced,
  markDriveSyncHydrated,
  setCookieFinanceStore,
} from '@/lib/finance-store';
import { getSession } from '@/lib/session';
import type { FinanceStore } from '@/lib/finance-types';

export async function GET() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }
  try {
    const backup = await readDriveFinanceBackup(session.accessToken);
    if (!backup) {
      return Response.json({ ok: true, exists: false });
    }
    return Response.json({
      ok: true,
      exists: true,
      backupAt: backup.backupAt,
      sourceUpdatedAt: backup.sourceUpdatedAt,
    });
  } catch {
    return Response.json({ error: 'Failed to read backup' }, { status: 502 });
  }
}

export async function POST() {
  const session = await getSession();
  if (!session?.accessToken) {
    return Response.json({ error: 'Not signed in' }, { status: 401 });
  }
  try {
    const backup = await readDriveFinanceBackup(session.accessToken);
    if (!backup) {
      return Response.json({ error: 'No backup file found in Drive' }, { status: 404 });
    }
    const store: FinanceStore = {
      monthlyIncome: backup.monthlyIncome,
      priorityPicksBudget: backup.priorityPicksBudget,
      expenses: backup.expenses,
      buyList: backup.buyList,
      needList: backup.needList,
      squidGameWinnerList: backup.squidGameWinnerList,
      requests: backup.requests,
    };
    const syncedAt = await writeDriveFinanceStore(session.accessToken, store);
    await setCookieFinanceStore(store);
    await markCookieStoreSynced(syncedAt);
    await markDriveSyncHydrated();
    return Response.json({ ok: true, restoredAt: syncedAt, backupAt: backup.backupAt });
  } catch {
    return Response.json({ error: 'Failed to restore from backup' }, { status: 502 });
  }
}
