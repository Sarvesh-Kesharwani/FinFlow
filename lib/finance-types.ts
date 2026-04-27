export type ExpenseCategory =
  | 'purchases'
  | 'services'
  | 'investments'
  | 'subscriptions'
  | 'utilities'
  | 'fuel'
  | 'insurance'
  | 'maintenance'
  | 'savings'
  | 'money+'
  | 'other';

export type MaintenanceSubcategory =
  | 'productivity-now'
  | 'fun-mentalHealth'
  | 'physicalHealth';

export type ExpenseCadence = 'one-time' | 'daily' | 'weekly' | 'bi-weekly' | 'monthly' | 'yearly' | 'custom';
export type ExpenseBucket = 'predicted' | 'actual';

export interface ExpenseEntry {
  id: string;
  title: string;
  amount: number;
  bucket: ExpenseBucket;
  category: ExpenseCategory;
  subCategory?: string;
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
  { value: 'savings', label: 'Savings' },
  { value: 'money+', label: 'Money+' },
  { value: 'other', label: 'Other' },
];

export const MAINTENANCE_SUBCATEGORIES: Array<{ value: MaintenanceSubcategory; label: string }> = [
  { value: 'productivity-now', label: 'Productivity-Now' },
  { value: 'fun-mentalHealth', label: 'Fun & Mental Health' },
  { value: 'physicalHealth', label: 'Physical Health' },
];

export const EXPENSE_CADENCE_OPTIONS: Array<{ value: ExpenseCadence; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'bi-weekly', label: 'Bi-weekly' },
  { value: 'one-time', label: 'One-time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom' },
];
