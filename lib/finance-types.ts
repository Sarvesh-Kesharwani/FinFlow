export type ExpenseCategory =
  | 'purchases'
  | 'services'
  | 'investments'
  | 'subscriptions'
  | 'utilities'
  | 'fuel'
  | 'insurance'
  | 'maintenance'
  | 'other';

export type ExpenseCadence = 'one-time' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type ExpenseBucket = 'predicted' | 'actual';

export interface ExpenseEntry {
  id: string;
  title: string;
  amount: number;
  bucket: ExpenseBucket;
  category: ExpenseCategory;
  cadence: ExpenseCadence;
  spentOn: string; // ISO date
  notes?: string;
}

export interface BuyListItem {
  id: string;
  title: string;
  url: string;
  price: number;
  sourcePlatform?: string;
  currency?: string;
  notes?: string;
  createdAt: string; // ISO datetime
}

export interface FinanceStore {
  monthlyIncome: number;
  expenses: ExpenseEntry[];
  buyList: BuyListItem[];
}

export interface FinanceSummary {
  monthlyExpectedExpenses: number;
  currentMonthSpent: number;
  currentMonthRemaining: number;
  canBuyCountThisMonth: number;
  affordableItemIds: string[];
}

export const DEFAULT_FINANCE_STORE: FinanceStore = {
  monthlyIncome: 0,
  expenses: [],
  buyList: [],
};

export const EXPENSE_CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: 'purchases', label: 'Purchases' },
  { value: 'services', label: 'Services' },
  { value: 'investments', label: 'Investments' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'other', label: 'Other' },
];

export const EXPENSE_CADENCE_OPTIONS: Array<{ value: ExpenseCadence; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'one-time', label: 'One-time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom' },
];
