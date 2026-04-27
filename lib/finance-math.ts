import type { BuyListItem, ExpenseEntry, FinanceStore, FinanceSummary } from './finance-types';

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clampMoney(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function isCurrentMonth(isoDate: string): boolean {
  const date = new Date(isoDate);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function expectedContribution(entry: ExpenseEntry): number {
  const amount = clampMoney(toNumber(entry.amount));
  if (entry.cadence === 'daily') return clampMoney(amount * 30);
  if (entry.cadence === 'weekly') return clampMoney((amount * 52) / 12);
  if (entry.cadence === 'bi-weekly') return clampMoney((amount * 26) / 12);
  if (entry.cadence === 'monthly') return amount;
  if (entry.cadence === 'yearly') return clampMoney(amount / 12);
  return 0;
}

function currentMonthContribution(entry: ExpenseEntry): number {
  if (
    entry.cadence === 'daily' ||
    entry.cadence === 'weekly' ||
    entry.cadence === 'bi-weekly' ||
    entry.cadence === 'monthly'
  ) {
    return clampMoney(toNumber(entry.amount));
  }
  if (entry.cadence === 'yearly') return 0;
  return isCurrentMonth(entry.spentOn) ? clampMoney(toNumber(entry.amount)) : 0;
}

function canAffordThisMonth(sortedByPriority: BuyListItem[], budget: number): string[] {
  const affordable: string[] = [];
  let running = 0;

  for (const item of sortedByPriority) {
    const next = running + clampMoney(toNumber(item.price));
    if (next > budget) break;
    running = next;
    affordable.push(item.id);
  }

  return affordable;
}

export function summarizeFinance(store: FinanceStore): FinanceSummary {
  const monthlyIncome = clampMoney(toNumber(store.monthlyIncome));
  const predictedExpenses = store.expenses.filter((expense) => expense.bucket === 'predicted');
  const actualExpenses = store.expenses.filter((expense) => expense.bucket !== 'predicted');
  const monthlyExpectedExpenses = clampMoney(
    predictedExpenses.reduce((sum, expense) => sum + expectedContribution(expense), 0),
  );
  const currentMonthSpent = clampMoney(
    actualExpenses.reduce((sum, expense) => sum + currentMonthContribution(expense), 0),
  );
  const currentMonthRemaining = clampMoney(Math.max(0, monthlyIncome - currentMonthSpent));
  const affordableItemIds = canAffordThisMonth(store.buyList, currentMonthRemaining);

  return {
    monthlyExpectedExpenses,
    currentMonthSpent,
    currentMonthRemaining,
    canBuyCountThisMonth: affordableItemIds.length,
    affordableItemIds,
  };
}

export function normalizeMoney(value: unknown): number {
  return clampMoney(toNumber(value));
}
