import 'server-only';
import { getCookieFinanceStore } from './finance-store';
import { readDriveFinanceStore } from './finance-drive';
import { getSession } from './session';
import type { FinanceStore } from './finance-types';

/**
 * Server-render loader. Prefers Google Drive when the user is signed in,
 * because cookies cannot reliably hold a large expense list (request-header
 * size limits truncate them on reload). Falls back to cookies when Drive is
 * unavailable or the user is not signed in.
 */
export async function loadFinanceState(): Promise<FinanceStore> {
  const cookieStore = await getCookieFinanceStore();
  const session = await getSession();
  if (!session?.accessToken) return cookieStore;

  try {
    const drive = await readDriveFinanceStore(session.accessToken);
    if (!drive) return cookieStore;
    return {
      monthlyIncome: drive.monthlyIncome,
      expenses: drive.expenses,
      buyList: drive.buyList,
      requests: drive.requests,
    };
  } catch {
    return cookieStore;
  }
}
