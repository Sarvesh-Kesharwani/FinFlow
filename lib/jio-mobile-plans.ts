import type { MobilePlan, MobilePlansResponse, PlanDetail } from '@/types/mobile-plan';

export type JioPlan = MobilePlan;
export type JioPlanDetail = PlanDetail;
export type JioPlansResponse = MobilePlansResponse;

type RawJioPlan = {
  id?: unknown;
  voucherId?: unknown;
  key?: unknown;
  name?: unknown;
  amount?: unknown;
  planName?: unknown;
  categoryLabel?: unknown;
  description?: unknown;
  primeData?: {
    plan?: unknown;
    offerBenefits1?: unknown;
    offerBenefits2?: unknown;
    offerBenefits3?: unknown;
    offerBenefits4?: unknown;
    offerBenefits5?: unknown;
    subscriptions?: unknown;
  };
  misc?: {
    subscriptions?: Array<{ title?: unknown }>;
    notes?: unknown[];
    star?: unknown[];
    details?: Array<{ header?: unknown; value?: unknown }>;
  };
};

type RawJioSubCategory = {
  type?: unknown;
  plans?: RawJioPlan[];
};

type RawJioCategory = {
  type?: unknown;
  subCategories?: RawJioSubCategory[];
};

type RawJioPlansPayload = {
  planCategories?: RawJioCategory[];
};

const JIO_SOURCE_URL = 'https://www.jio.com/selfcare/plans/mobility/prepaid-plans-list/';
const JIO_PLANS_API =
  'https://www.jio.com/api/jio-mdmdata-service/mdmdata/recharge/plans?productType=MOBILITY&billingType=1';

let lastSuccessfulResponse: JioPlansResponse | null = null;

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value: unknown): string {
  return text(String(value ?? '').replace(/<[^>]*>/g, ' '));
}

function numberValue(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstDetail(details: JioPlanDetail[], labels: string[]): string {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  return (
    details.find((detail) =>
      normalizedLabels.some((label) => detail.header.toLowerCase().replace(/\*/g, '').includes(label)),
    )?.value ?? ''
  );
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(stripHtml).filter(Boolean)));
}

function buildFallbackDetail(plan: RawJioPlan, label: string, fallback: string): JioPlanDetail | null {
  const value = text(fallback);
  if (!value || /^na$/i.test(value)) return null;
  return { header: label, value };
}

function normalizePlan(plan: RawJioPlan, category: string, subCategory: string): JioPlan {
  const rawDetails = Array.isArray(plan.misc?.details) ? plan.misc.details : [];
  const details = rawDetails
    .map((detail) => ({ header: text(detail.header), value: text(detail.value) }))
    .filter((detail) => detail.header && detail.value);

  const primeData = plan.primeData ?? {};
  const fallbackDetails = [
    buildFallbackDetail(plan, 'Data at high speed', `${text(primeData.offerBenefits1)} ${text(primeData.offerBenefits2)}`),
    buildFallbackDetail(plan, 'Pack validity', `${text(primeData.offerBenefits3)} ${text(primeData.offerBenefits4)}`),
    buildFallbackDetail(plan, 'Extra benefit', text(primeData.offerBenefits5)),
  ].filter((detail): detail is JioPlanDetail => Boolean(detail));

  const mergedDetails = [...details];
  for (const fallback of fallbackDetails) {
    if (!mergedDetails.some((detail) => detail.header.toLowerCase() === fallback.header.toLowerCase())) {
      mergedDetails.push(fallback);
    }
  }

  const price = numberValue(plan.amount ?? plan.name);
  const sourceId = text(plan.id ?? plan.voucherId ?? plan.key ?? plan.name);
  const key = text(plan.key ?? sourceId);
  const subscriptions = unique([
    ...(Array.isArray(plan.misc?.subscriptions) ? plan.misc.subscriptions.map((subscription) => text(subscription.title)) : []),
    text(primeData.subscriptions),
  ]);
  const notes = unique([
    ...(Array.isArray(plan.misc?.notes) ? plan.misc.notes.map(stripHtml) : []),
    ...(Array.isArray(plan.misc?.star) ? plan.misc.star.map(stripHtml) : []),
    text(primeData.plan).split('|')[0] ?? '',
  ]);
  const validity = firstDetail(mergedDetails, ['pack validity', 'validity']) || text(`${primeData.offerBenefits3} ${primeData.offerBenefits4}`);
  const totalData = firstDetail(mergedDetails, ['total data']);
  const highSpeedData =
    firstDetail(mergedDetails, ['data at high speed', 'data', 'benefits']) ||
    text(`${primeData.offerBenefits1} ${primeData.offerBenefits2}`);
  const voice = firstDetail(mergedDetails, ['voice']);
  const sms = firstDetail(mergedDetails, ['sms']);
  const displayName = text(plan.planName ?? plan.name) || `Jio prepaid Rs ${price}`;
  const id = `${sourceId || key || displayName}-${category}-${subCategory}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const amountLabel = price > 0 ? `Rs ${price.toLocaleString('en-IN')}` : text(plan.amount ?? plan.name) || 'Price unavailable';

  const aspectMap: Record<string, string> = {
    Price: amountLabel,
    Category: category,
    'Plan group': subCategory,
  };
  if (validity) aspectMap.Validity = validity;
  if (totalData) aspectMap['Total data'] = totalData;
  if (highSpeedData) aspectMap['High speed data'] = highSpeedData;
  if (voice) aspectMap.Voice = voice;
  if (sms) aspectMap.SMS = sms;
  if (subscriptions.length) aspectMap.Subscriptions = subscriptions.join(', ');
  if (notes.length) aspectMap.Notes = notes.slice(0, 3).join('; ');

  return {
    id,
    sourceId,
    key,
    name: text(plan.name) || amountLabel,
    displayName,
    price,
    amountLabel,
    category,
    subCategory,
    validity,
    totalData,
    highSpeedData,
    voice,
    sms,
    subscriptions,
    notes,
    details: mergedDetails,
    description: stripHtml(plan.description),
    rechargeUrl: JIO_SOURCE_URL,
    sourceUrl: JIO_SOURCE_URL,
    aspectMap,
    operator: 'jio',
  };
}

function flattenPlans(payload: RawJioPlansPayload): JioPlan[] {
  const seen = new Set<string>();
  const plans: JioPlan[] = [];

  for (const category of payload.planCategories ?? []) {
    const categoryName = text(category.type) || 'Jio prepaid';
    for (const subCategory of category.subCategories ?? []) {
      const subCategoryName = text(subCategory.type) || categoryName;
      for (const plan of subCategory.plans ?? []) {
        const normalized = normalizePlan(plan, categoryName, subCategoryName);
        const dedupeKey = normalized.key || `${normalized.sourceId}-${normalized.category}-${normalized.subCategory}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        plans.push(normalized);
      }
    }
  }

  return plans.sort((a, b) => a.price - b.price || a.category.localeCompare(b.category));
}

export async function getJioMobilePlans(): Promise<JioPlansResponse> {
  const warnings: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(JIO_PLANS_API, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Referer: JIO_SOURCE_URL,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        warnings.push(`Jio returned ${response.status} while loading prepaid plans.`);
        continue;
      }

      const payload = (await response.json()) as RawJioPlansPayload;
      const plans = flattenPlans(payload);
      if (!plans.length) {
        warnings.push('Jio returned no prepaid plans in the expected structure.');
        continue;
      }

      const result = { plans, fetchedAt: new Date().toISOString(), sourceUrl: JIO_SOURCE_URL, warnings };
      lastSuccessfulResponse = result;
      return result;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Failed to load Jio prepaid plans.');
    }
  }

  if (lastSuccessfulResponse) {
    return {
      ...lastSuccessfulResponse,
      warnings: [...warnings, 'Showing the last successful Jio response from this server session.'],
    };
  }

  return { plans: [], fetchedAt: new Date().toISOString(), sourceUrl: JIO_SOURCE_URL, warnings };
}

export function getCommonPlanAspects(plans: JioPlan[]) {
  const selectedCount = plans.length;
  if (selectedCount < 2) return [];
  const allKeys = new Set(plans.flatMap((plan) => Object.keys(plan.aspectMap)));
  return Array.from(allKeys)
    .filter((key) => plans.every((plan) => text(plan.aspectMap[key])))
    .map((aspect) => ({
      aspect,
      values: plans.map((plan) => ({ planId: plan.id, value: plan.aspectMap[aspect] })),
    }));
}
