import type { MobilePlan } from '@/types/mobile-plan';
import { getCommonPlanAspects } from '@/lib/jio-mobile-plans';

type DeepSeekMessage = {
  role: 'system' | 'user';
  content: string;
};

type PlanRecommendation = {
  final_pick: {
    plan_id: string;
    plan_name: string;
    purpose: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
  };
  tradeoffs: string[];
};

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('DeepSeek did not return JSON');
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeRecommendation(value: unknown, plans: MobilePlan[], requirement: string): PlanRecommendation {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const finalPick = record.final_pick && typeof record.final_pick === 'object' ? (record.final_pick as Record<string, unknown>) : {};
  const planId = text(finalPick.plan_id);
  const matchedPlan = plans.find((plan) => plan.id === planId || plan.sourceId === planId) ?? plans[0];

  return {
    final_pick: {
      plan_id: matchedPlan?.id ?? planId,
      plan_name: text(finalPick.plan_name) || matchedPlan?.displayName || 'Selected plan',
      purpose: text(finalPick.purpose) || requirement || 'Best overall fit',
      reason: text(finalPick.reason) || 'Best match from the selected plan details.',
      confidence:
        finalPick.confidence === 'high' || finalPick.confidence === 'medium' || finalPick.confidence === 'low'
          ? finalPick.confidence
          : 'medium',
    },
    tradeoffs: Array.isArray(record.tradeoffs) ? record.tradeoffs.map(text).filter(Boolean).slice(0, 5) : [],
  };
}

function scorePlan(plan: MobilePlan, requirement: string): number {
  const lowerRequirement = requirement.toLowerCase();
  const dataText = `${plan.totalData} ${plan.highSpeedData}`.toLowerCase();
  let score = plan.price > 0 ? 100000 / plan.price : 0;
  if (/data|internet|5g|hotspot|stream|video|youtube|ott|movie/i.test(lowerRequirement) && dataText) score += 300;
  if (/call|voice|parent|senior|basic/i.test(lowerRequirement) && /unlimited/i.test(plan.voice)) score += 260;
  if (/long|annual|year|validity|forget/i.test(lowerRequirement) && /365|336|year/i.test(plan.validity)) score += 320;
  if (/ott|cricket|hotstar|movie|entertainment/i.test(lowerRequirement) && plan.subscriptions.length) score += 240;
  if (/cheap|low|budget|minimum|affordable/i.test(lowerRequirement) && plan.price > 0) score += 50000 / plan.price;
  return score;
}

function fallbackRecommendation(plans: MobilePlan[], requirement: string): PlanRecommendation {
  const picked =
    plans
      .map((plan) => ({ plan, score: scorePlan(plan, requirement) }))
      .sort((a, b) => b.score - a.score)[0]?.plan ?? plans[0];

  return {
    final_pick: {
      plan_id: picked.id,
      plan_name: picked.displayName,
      purpose: requirement || 'Best overall prepaid recharge fit',
      reason: `Best deterministic match from price, validity, data, voice, SMS, and subscription details. ${picked.amountLabel} includes ${[
        picked.validity,
        picked.highSpeedData || picked.totalData,
        picked.voice,
        picked.sms,
      ]
        .filter(Boolean)
        .join(', ')}.`,
      confidence: 'medium',
    },
    tradeoffs: ['DeepSeek was unavailable, so this pick used FinFlow scoring from the selected plan details.'],
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { plans?: MobilePlan[]; requirement?: string };
    const plans = (body.plans ?? []).filter((plan) => plan?.id && plan.displayName).slice(0, 8);
    const requirement = text(body.requirement).slice(0, 800);

    if (plans.length < 2) {
      return Response.json({ ok: false, error: 'Select at least two plans to compare.' }, { status: 400 });
    }

    const commonAspects = getCommonPlanAspects(plans);
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return Response.json({
        ok: true,
        source: 'fallback',
        recommendation: fallbackRecommendation(plans, requirement),
        commonAspects,
        warning: 'DEEPSEEK_API_KEY is not configured.',
      });
    }

    const messages: DeepSeekMessage[] = [
      {
        role: 'system',
        content:
          'You are a telecom plan advisor. Pick one prepaid plan from the selected plans for the user requirement. Return strict JSON only. Use only the provided facts. Explain which plan to choose and for what purpose.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          output_shape: {
            final_pick: {
              plan_id: 'exact selected plan id',
              plan_name: 'plan name',
              purpose: 'purpose this plan is best for',
              reason: 'concise reason using data, validity, price, calling, SMS, subscriptions',
              confidence: 'high|medium|low',
            },
            tradeoffs: ['short tradeoff'],
          },
          requirement,
          common_aspects: commonAspects,
          plans: plans.map((plan) => ({
            id: plan.id,
            name: plan.displayName,
            price: plan.amountLabel,
            category: plan.category,
            sub_category: plan.subCategory,
            validity: plan.validity,
            total_data: plan.totalData,
            high_speed_data: plan.highSpeedData,
            voice: plan.voice,
            sms: plan.sms,
            subscriptions: plan.subscriptions,
            notes: plan.notes.slice(0, 5),
            details: plan.details,
          })),
        }),
      },
    ];

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json({
        ok: true,
        source: 'fallback',
        recommendation: fallbackRecommendation(plans, requirement),
        commonAspects,
        warning: `DeepSeek returned ${response.status}: ${errorText.slice(0, 240)}`,
      });
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    return Response.json({
      ok: true,
      source: 'deepseek',
      recommendation: normalizeRecommendation(extractJsonObject(content), plans, requirement),
      commonAspects,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Plan comparison failed.' },
      { status: 500 },
    );
  }
}
