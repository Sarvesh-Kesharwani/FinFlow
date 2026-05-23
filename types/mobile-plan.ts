export type PlanDetail = {
  header: string;
  value: string;
};

export type MobilePlan = {
  id: string;
  sourceId: string;
  key: string;
  name: string;
  displayName: string;
  price: number;
  amountLabel: string;
  category: string;
  subCategory: string;
  validity: string;
  totalData: string;
  highSpeedData: string;
  voice: string;
  sms: string;
  subscriptions: string[];
  notes: string[];
  details: PlanDetail[];
  description: string;
  rechargeUrl: string;
  sourceUrl: string;
  aspectMap: Record<string, string>;
  operator: string;
};

export type MobilePlansResponse = {
  plans: MobilePlan[];
  fetchedAt: string;
  sourceUrl: string;
  warnings: string[];
};
