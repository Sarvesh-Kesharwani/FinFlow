import { FinanceWorkspace } from '@/components/FinanceWorkspace';
import { EmptyState } from '@/components/EmptyState';
import { getSession } from '@/lib/session';
import { loadFinanceState } from '@/lib/finance-load';
import type { FinanceMode } from '@/components/FinanceClient';

function toFinanceMode(value: string | string[] | undefined): FinanceMode {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === 'wishlist' || tab === 'priority-picks' || tab === 'reports' ? tab : 'dashboard';
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialMode = toFinanceMode(params?.tab);
  const session = await getSession();
  if (!session?.user) {
    return (
      <EmptyState
        emoji="💸"
        title="Sign in to open your finance dashboard"
        description="Your expenses, income, and buy-list stay private to your account with Google Drive sync."
      />
    );
  }

  const state = await loadFinanceState();
  return <FinanceWorkspace initialState={state} initialMode={initialMode} />;
}
