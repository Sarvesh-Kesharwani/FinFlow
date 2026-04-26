import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getCookieFinanceStore } from '@/lib/finance-store';
import { EmptyState } from '@/components/EmptyState';
import { IncomeForm } from '@/components/IncomeForm';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <EmptyState
        emoji="⚙️"
        title="Sign in to access settings"
        description="Manage your income and preferences after logging in."
      />
    );
  }

  const state = await getCookieFinanceStore();

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h1 className="text-3xl font-extrabold text-duored-deep">Settings</h1>
        <p className="font-semibold text-duored-muted">Manage your financial preferences.</p>
      </section>

      <IncomeForm initialIncome={state.monthlyIncome} />
    </div>
  );
}
