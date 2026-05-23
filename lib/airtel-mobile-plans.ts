import type { MobilePlan, MobilePlansResponse } from '@/types/mobile-plan';

export const AIRTEL_SOURCE_URL = 'https://www.airtel.in/recharge-online';
const AIRTEL_RECHARGE_BASE = 'https://www.airtel.in/recharge-online';

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => text(v)).filter(Boolean)));
}

type AirtelRawCategory = {
  name: string;
  subcategories: AirtelRawSubCategory[];
};

type AirtelRawSubCategory = {
  name: string;
  plans: AirtelRawPlan[];
};

type AirtelRawPlan = {
  id: string;
  name: string;
  price: number;
  validity: string;
  data: string;
  voice: string;
  sms: string;
  subscriptions: string[];
  notes: string[];
  details: Array<{ header: string; value: string }>;
};

const AIRTEL_PLANS_DATA: AirtelRawCategory[] = [
  {
    name: 'Truly Unlimited',
    subcategories: [
      {
        name: '1 Month',
        plans: [
          {
            id: 'airtel-199',
            name: 'Rs 199 Pack',
            price: 199,
            validity: '28 Days',
            data: '2 GB',
            voice: 'Unlimited',
            sms: '300 SMS',
            subscriptions: ['Wynk Music', 'Hello Tunes'],
            notes: ['Data rollover not available'],
            details: [
              { header: 'Data', value: '2 GB' },
              { header: 'Validity', value: '28 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '300 SMS' },
              { header: 'Data at high speed', value: '2 GB at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
          {
            id: 'airtel-265',
            name: 'Rs 265 Pack',
            price: 265,
            validity: '28 Days',
            data: '1 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes'],
            notes: ['1 GB high-speed data per day', 'Post daily FUP unlimited at 64 Kbps'],
            details: [
              { header: 'Data', value: '1 GB/Day' },
              { header: 'Validity', value: '28 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '1 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
          {
            id: 'airtel-299',
            name: 'Rs 299 Pack',
            price: 299,
            validity: '28 Days',
            data: '1.5 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes', 'Apollo 24x7'],
            notes: ['1.5 GB high-speed data per day', 'Post daily FUP unlimited at 64 Kbps'],
            details: [
              { header: 'Data', value: '1.5 GB/Day' },
              { header: 'Validity', value: '28 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '1.5 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
          {
            id: 'airtel-359',
            name: 'Rs 359 Pack',
            price: 359,
            validity: '28 Days',
            data: '2 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes', 'Apollo 24x7'],
            notes: ['2 GB high-speed data per day', 'Post daily FUP unlimited at 64 Kbps'],
            details: [
              { header: 'Data', value: '2 GB/Day' },
              { header: 'Validity', value: '28 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '2 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
          {
            id: 'airtel-449',
            name: 'Rs 449 Pack',
            price: 449,
            validity: '28 Days',
            data: '3 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes', 'Apollo 24x7'],
            notes: ['3 GB high-speed data per day', 'Post daily FUP unlimited at 64 Kbps'],
            details: [
              { header: 'Data', value: '3 GB/Day' },
              { header: 'Validity', value: '28 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '3 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
        ],
      },
      {
        name: '3 Months',
        plans: [
          {
            id: 'airtel-719',
            name: 'Rs 719 Pack',
            price: 719,
            validity: '84 Days',
            data: '1.5 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes', 'Apollo 24x7'],
            notes: ['1.5 GB high-speed data per day'],
            details: [
              { header: 'Data', value: '1.5 GB/Day' },
              { header: 'Validity', value: '84 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '1.5 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
          {
            id: 'airtel-839',
            name: 'Rs 839 Pack',
            price: 839,
            validity: '84 Days',
            data: '2 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes', 'Apollo 24x7'],
            notes: ['2 GB high-speed data per day'],
            details: [
              { header: 'Data', value: '2 GB/Day' },
              { header: 'Validity', value: '84 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '2 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Data Packs',
    subcategories: [
      {
        name: 'Top-Up',
        plans: [
          {
            id: 'airtel-19',
            name: 'Rs 19 Data Pack',
            price: 19,
            validity: '1 Day',
            data: '1 GB',
            voice: 'No',
            sms: 'No',
            subscriptions: [],
            notes: ['Data only top-up', 'Valid for 1 day'],
            details: [
              { header: 'Data', value: '1 GB' },
              { header: 'Validity', value: '1 Day' },
              { header: 'Data at high speed', value: '1 GB' },
            ],
          },
          {
            id: 'airtel-49',
            name: 'Rs 49 Data Pack',
            price: 49,
            validity: '3 Days',
            data: '6 GB',
            voice: 'No',
            sms: 'No',
            subscriptions: [],
            notes: ['Data only top-up', 'Valid for 3 days', '2 GB per day'],
            details: [
              { header: 'Data', value: '6 GB' },
              { header: 'Validity', value: '3 Days' },
              { header: 'Data at high speed', value: '2 GB/Day' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Annual',
    subcategories: [
      {
        name: '1 Year',
        plans: [
          {
            id: 'airtel-1799',
            name: 'Rs 1799 Pack',
            price: 1799,
            validity: '365 Days',
            data: '24 GB',
            voice: 'Unlimited',
            sms: '3600 SMS',
            subscriptions: ['Wynk Music', 'Hello Tunes'],
            notes: ['Total 24 GB data for 365 days', 'Best for low-data users needing long validity'],
            details: [
              { header: 'Data', value: '24 GB' },
              { header: 'Validity', value: '365 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '3600 SMS' },
              { header: 'Data at high speed', value: '24 GB, post FUP unlimited at 64 Kbps' },
            ],
          },
          {
            id: 'airtel-2999',
            name: 'Rs 2999 Pack',
            price: 2999,
            validity: '365 Days',
            data: '2 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes', 'Apollo 24x7', 'Amazon Prime Video Mobile'],
            notes: ['2 GB high-speed data per day', 'Amazon Prime Video Mobile included'],
            details: [
              { header: 'Data', value: '2 GB/Day' },
              { header: 'Validity', value: '365 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '2 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
          {
            id: 'airtel-3359',
            name: 'Rs 3359 Pack',
            price: 3359,
            validity: '365 Days',
            data: '2.5 GB/Day',
            voice: 'Unlimited',
            sms: '100 SMS/Day',
            subscriptions: ['Wynk Music', 'Hello Tunes', 'Apollo 24x7', 'Amazon Prime Video', 'Disney+ Hotstar'],
            notes: ['2.5 GB high-speed data per day', 'Amazon Prime Video & Disney+ Hotstar included'],
            details: [
              { header: 'Data', value: '2.5 GB/Day' },
              { header: 'Validity', value: '365 Days' },
              { header: 'Voice', value: 'Unlimited Voice Calls' },
              { header: 'SMS', value: '100 SMS/Day' },
              { header: 'Data at high speed', value: '2.5 GB/Day at high speed, post FUP unlimited at 64 Kbps' },
            ],
          },
        ],
      },
    ],
  },
];

function normalizePlan(plan: AirtelRawPlan, category: string, subCategory: string): MobilePlan {
  const price = plan.price;
  const id = plan.id.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const amountLabel = `Rs ${price.toLocaleString('en-IN')}`;
  const displayName = plan.name || `Airtel prepaid Rs ${price}`;
  const subscriptions = unique(plan.subscriptions);
  const notes = unique(plan.notes);

  const aspectMap: Record<string, string> = {
    Price: amountLabel,
    Category: category,
    'Plan group': subCategory,
  };
  if (plan.validity) aspectMap.Validity = plan.validity;
  if (plan.data) aspectMap['High speed data'] = plan.data;
  if (plan.voice) aspectMap.Voice = plan.voice;
  if (plan.sms) aspectMap.SMS = plan.sms;
  if (subscriptions.length) aspectMap.Subscriptions = subscriptions.join(', ');

  const totalDataValue =
    plan.details.find((d) => d.header.toLowerCase().includes('total data'))?.value ?? plan.data;

  return {
    id,
    sourceId: plan.id,
    key: plan.id,
    name: plan.name,
    displayName,
    price,
    amountLabel,
    category,
    subCategory,
    validity: plan.validity,
    totalData: totalDataValue,
    highSpeedData: plan.data,
    voice: plan.voice,
    sms: plan.sms,
    subscriptions,
    notes,
    details: plan.details,
    description: `Airtel prepaid: ${displayName} - ${plan.validity}, ${plan.data}`,
    rechargeUrl: AIRTEL_RECHARGE_BASE,
    sourceUrl: AIRTEL_SOURCE_URL,
    aspectMap,
    operator: 'airtel',
  };
}

function flattenPlans(): MobilePlan[] {
  const seen = new Set<string>();
  const plans: MobilePlan[] = [];

  for (const category of AIRTEL_PLANS_DATA) {
    for (const subCategory of category.subcategories) {
      for (const plan of subCategory.plans) {
        const normalized = normalizePlan(plan, category.name, subCategory.name);
        if (seen.has(normalized.id)) continue;
        seen.add(normalized.id);
        plans.push(normalized);
      }
    }
  }

  return plans.sort((a, b) => a.price - b.price || a.category.localeCompare(b.category));
}

let cachedPlans: MobilePlan[] | null = null;

export function getAirtelMobilePlans(): MobilePlansResponse {
  if (cachedPlans) {
    return { plans: cachedPlans, fetchedAt: new Date().toISOString(), sourceUrl: AIRTEL_SOURCE_URL, warnings: [] };
  }
  cachedPlans = flattenPlans();
  return { plans: cachedPlans, fetchedAt: new Date().toISOString(), sourceUrl: AIRTEL_SOURCE_URL, warnings: [] };
}

export function getAirtelRechargeUrl(mobileNumber: string): string {
  const clean = mobileNumber.replace(/[^\d]/g, '');
  return `${AIRTEL_RECHARGE_BASE}?mobile=${clean}`;
}
