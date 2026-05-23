import { FinanceClient } from '@/components/FinanceClient';
import { EmptyState } from '@/components/EmptyState';
import { loadFinanceState } from '@/lib/finance-load';
import { getSession } from '@/lib/session';

const TO_BUY_HELP = 'Add links from Amazon, Flipkart, Myntra, TechnoSport, and more, then rank by priority.';

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

  const state = await loadFinanceState();
  return (
    <div className="space-y-4">
      <section>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-extrabold text-duored-deep">To Buy List</h1>
          <span className="group relative inline-flex">
            <button
              type="button"
              aria-label={TO_BUY_HELP}
              title={TO_BUY_HELP}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-duored-border bg-white text-xs font-black text-duored-muted shadow-card"
            >
              i
            </button>
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-xl border-2 border-duored-border bg-white px-3 py-2 text-sm font-bold text-duored-muted opacity-0 shadow-roseCard transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {TO_BUY_HELP}
            </span>
          </span>
        </div>
      </section>
      <FinanceClient initialState={state} mode="wishlist" />
    </div>
  );
}
