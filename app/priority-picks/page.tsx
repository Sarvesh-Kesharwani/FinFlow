import { FinanceClient } from '@/components/FinanceClient';
import { EmptyState } from '@/components/EmptyState';
import { loadFinanceState } from '@/lib/finance-load';
import { getSession } from '@/lib/session';

export default async function PriorityPicksPage() {
  const session = await getSession();
  if (!session?.user) {
    return (
      <EmptyState
        emoji="P"
        title="Sign in to manage Priority Picks"
        description="Rank your to-buy items and keep the winner list synced."
      />
    );
  }

  const state = await loadFinanceState();
  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <h1 className="text-3xl font-extrabold text-duored-deep">Priority Picks</h1>
        <p className="font-semibold text-duored-muted">
          Drag items between To Buy and SquidGame Winner Items, then reorder each list by priority.
        </p>
      </section>
      <FinanceClient initialState={state} mode="priority-picks" />
    </div>
  );
}
