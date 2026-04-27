import { FinanceClient } from '@/components/FinanceClient';
import { EmptyState } from '@/components/EmptyState';
import { getSession } from '@/lib/session';
import { loadFinanceState } from '@/lib/finance-load';

export default async function DashboardPage() {
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
  return (
    <div className="space-y-4">
      <FinanceClient initialState={state} mode="dashboard" />
    </div>
  );
}
