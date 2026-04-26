import { FinanceClient } from '@/components/FinanceClient';
import { EmptyState } from '@/components/EmptyState';
import { getCookieFinanceStore } from '@/lib/finance-store';
import { getSession } from '@/lib/session';

export default async function WishlistPage() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <EmptyState
        emoji="🛍️"
        title="Sign in to manage your buy list"
        description="Paste product links, prioritize items, and see how many you can buy this month."
      />
    );
  }

  const state = await getCookieFinanceStore();
  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <h1 className="text-3xl font-extrabold text-duored-deep">To Buy List</h1>
        <p className="font-semibold text-duored-muted">
          Add links from Amazon, Flipkart, Myntra, TechnoSport, and more, then rank by priority.
        </p>
      </section>
      <FinanceClient initialState={state} mode="wishlist" />
    </div>
  );
}
