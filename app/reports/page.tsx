import { EmptyState } from '@/components/EmptyState';
import { summarizeFinance } from '@/lib/finance-math';
import { getCookieFinanceStore } from '@/lib/finance-store';
import { getSession } from '@/lib/session';

function inr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function ReportsPage() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <EmptyState
        emoji="📈"
        title="Sign in to view reports"
        description="Monthly expected expenses, this month spend, and affordability insights are available after login."
      />
    );
  }

  const state = await getCookieFinanceStore();
  const summary = summarizeFinance(state);

  const byCategory = state.expenses.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount;
    return acc;
  }, {});
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h1 className="text-3xl font-extrabold text-duored-deep">Reports</h1>
        <p className="font-semibold text-duored-muted">Quick monthly outlook for expected vs current spending.</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="card-3d card-green">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Monthly Income</p>
          <p className="mt-2 text-2xl font-extrabold">{inr(state.monthlyIncome)}</p>
        </article>
        <article className="card-3d card-amber">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Expected / Month</p>
          <p className="mt-2 text-2xl font-extrabold">{inr(summary.monthlyExpectedExpenses)}</p>
        </article>
        <article className="card-3d card-rose">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Spent This Month</p>
          <p className="mt-2 text-2xl font-extrabold">{inr(summary.currentMonthSpent)}</p>
        </article>
        <article className="card-3d card-green">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Can Buy This Month</p>
          <p className="mt-2 text-2xl font-extrabold">{summary.canBuyCountThisMonth} items</p>
        </article>
      </section>

      <section className="grid gap-3 md:grid-cols-1">
        <article className="card-3d card-green">
          <p className="text-xs uppercase tracking-[0.18em] opacity-75">Remaining This Month</p>
          <p className="mt-2 text-2xl font-extrabold">{inr(summary.currentMonthRemaining)}</p>
        </article>
      </section>

      <section className="card-panel">
        <h2 className="section-title">Category totals</h2>
        {sorted.length === 0 ? (
          <p className="font-semibold text-duored-muted">No expenses recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map(([category, amount]) => (
              <li key={category} className="lift-card">
                <span className="font-extrabold capitalize text-duored-ink">{category}</span>
                <span className="font-extrabold text-duored-deep">{inr(amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
