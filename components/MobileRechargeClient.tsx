'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MobilePlan, MobilePlansResponse } from '@/types/mobile-plan';

type CommonAspect = {
  aspect: string;
  values: Array<{ planId: string; value: string }>;
};

type AiRecommendation = {
  final_pick: {
    plan_id: string;
    plan_name: string;
    purpose: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
  };
  tradeoffs: string[];
};

type AiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; source: string; recommendation: AiRecommendation; warning?: string }
  | { status: 'error'; error: string };

type MobileRechargeClientProps = {
  operators: Record<string, MobilePlansResponse>;
};

const OPERATORS = [
  { id: 'jio', label: 'Jio', color: 'bg-blue-600' },
  { id: 'airtel', label: 'Airtel', color: 'bg-red-600' },
] as const;

type OperatorId = (typeof OPERATORS)[number]['id'];

const TAB_STORAGE_KEY = 'finflow_mobile_recharge_tab';
const SELECTED_STORAGE_KEY = 'finflow_mobile_recharge_selected';
const REQUIREMENT_STORAGE_KEY = 'finflow_mobile_recharge_requirement';
const OPERATOR_STORAGE_KEY = 'finflow_mobile_recharge_operator';

const PLAN_ENDPOINTS: Record<OperatorId, string> = {
  jio: '/api/mobile-recharge/jio-plans',
  airtel: '/api/mobile-recharge/airtel-plans',
};

type CustomFilterKey = 'sms' | 'voice' | 'data' | 'ott';

const CUSTOM_FILTERS: Array<{ key: CustomFilterKey; label: string }> = [
  { key: 'sms', label: 'SMS' },
  { key: 'voice', label: 'Voice' },
  { key: 'data', label: 'Data' },
  { key: 'ott', label: 'OTT' },
];

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getCommonAspects(plans: MobilePlan[]): CommonAspect[] {
  if (plans.length < 2) return [];
  const aspectNames = new Set(plans.flatMap((plan) => Object.keys(plan.aspectMap)));
  return Array.from(aspectNames)
    .filter((aspect) => plans.every((plan) => clean(plan.aspectMap[aspect] ?? '')))
    .map((aspect) => ({
      aspect,
      values: plans.map((plan) => ({ planId: plan.id, value: plan.aspectMap[aspect] })),
    }));
}

function getSpecificAspects(plans: MobilePlan[], commonAspects: CommonAspect[]) {
  const commonSet = new Set(commonAspects.map((aspect) => aspect.aspect));
  return plans.map((plan) => ({
    plan,
    aspects: Object.entries(plan.aspectMap)
      .filter(([aspect, value]) => !commonSet.has(aspect) && clean(value))
      .map(([aspect, value]) => ({ aspect, value })),
  }));
}

function formatFetchedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function hasIncludedValue(value: string): boolean {
  return Boolean(value.trim()) && !/^(no|none|na|n\/a|0)$/i.test(value.trim());
}

function hasData(plan: MobilePlan): boolean {
  return hasIncludedValue(plan.highSpeedData) || hasIncludedValue(plan.totalData);
}

function hasVoice(plan: MobilePlan): boolean {
  return hasIncludedValue(plan.voice);
}

function hasSms(plan: MobilePlan): boolean {
  return hasIncludedValue(plan.sms);
}

function hasOtt(plan: MobilePlan): boolean {
  return plan.subscriptions.some((subscription) => /(prime|hotstar|netflix|sonyliv|zee5|jiocinema|jio cinema|sun nxt|ott|amazon|disney)/i.test(subscription));
}

function dataScore(value: string): number {
  const textValue = value.toLowerCase();
  if (!textValue || /no|none|na|n\/a/.test(textValue)) return 0;
  if (/unlimited/.test(textValue)) return 1_000_000;
  const matches = Array.from(textValue.matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb|mb)/gi));
  if (!matches.length) return 0;
  const multiplier = /\/\s*day|per\s*day|daily/.test(textValue) ? 1000 : 1;
  return Math.max(
    ...matches.map((match) => {
      const amount = Number(match[1]);
      const unit = match[2].toLowerCase();
      const gb = unit === 'tb' ? amount * 1024 : unit === 'mb' ? amount / 1024 : amount;
      return gb * multiplier;
    }),
  );
}

function planDataScore(plan: MobilePlan): number {
  return Math.max(dataScore(plan.highSpeedData), dataScore(plan.totalData), dataScore(plan.description));
}

function planConditionText(plan: MobilePlan): string {
  return [plan.category, plan.subCategory, plan.rechargeUrl ? 'Rechargeable from official source' : 'Open source to confirm rechargeability']
    .filter(Boolean)
    .join(' | ');
}

export function MobileRechargeClient({ operators }: MobileRechargeClientProps) {
  const [operatorResults, setOperatorResults] = useState<Record<string, MobilePlansResponse>>(operators);
  const [loadingOperators, setLoadingOperators] = useState<Record<string, boolean>>({});
  const [requestedOperators, setRequestedOperators] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<'plans' | 'compare'>('plans');
  const [operator, setOperator] = useState<string>('airtel');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [customMode, setCustomMode] = useState<'none' | 'data_desc'>('none');
  const [customFilters, setCustomFilters] = useState<Record<CustomFilterKey, boolean>>({
    sms: false,
    voice: false,
    data: false,
    ott: false,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [requirement, setRequirement] = useState('');
  const [aiState, setAiState] = useState<AiState>({ status: 'idle' });

  useEffect(() => {
    const savedTab = localStorage.getItem(TAB_STORAGE_KEY);
    if (savedTab === 'plans' || savedTab === 'compare') setTab(savedTab);
    const savedOperator = localStorage.getItem(OPERATOR_STORAGE_KEY);
    if (savedOperator && (operators[savedOperator]?.plans.length ?? 0) > 0) {
      setOperator(savedOperator);
    } else {
      setOperator('airtel');
    }
    const savedSelected = localStorage.getItem(SELECTED_STORAGE_KEY);
    if (savedSelected) {
      try {
        const ids = JSON.parse(savedSelected) as unknown;
        if (Array.isArray(ids)) setSelectedIds(ids.map(String));
      } catch {
        localStorage.removeItem(SELECTED_STORAGE_KEY);
      }
    }
    setRequirement(localStorage.getItem(REQUIREMENT_STORAGE_KEY) ?? '');
  }, [operators]);

  useEffect(() => {
    let cancelled = false;
    const controllers: AbortController[] = [];

    for (const op of OPERATORS) {
      if ((operatorResults[op.id]?.plans.length ?? 0) > 0 || requestedOperators[op.id]) continue;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 9000);
      controllers.push(controller);
      setRequestedOperators((current) => ({ ...current, [op.id]: true }));
      setLoadingOperators((current) => ({ ...current, [op.id]: true }));

      fetch(PLAN_ENDPOINTS[op.id], { signal: controller.signal })
        .then(async (response) => {
          const data = (await response.json()) as MobilePlansResponse & { ok?: boolean };
          if (!response.ok) throw new Error(data.warnings?.join(' ') || `Failed to load ${op.label} plans.`);
          if (!cancelled) {
            setOperatorResults((current) => ({ ...current, [op.id]: data }));
          }
        })
        .catch((error) => {
          if (cancelled) return;
          setOperatorResults((current) => ({
            ...current,
            [op.id]: {
              ...(current[op.id] ?? {
                plans: [],
                fetchedAt: new Date().toISOString(),
                sourceUrl: '',
              }),
              warnings: [
                error instanceof DOMException && error.name === 'AbortError'
                  ? `${op.label} plans are taking too long to load. Try switching back in a moment.`
                  : error instanceof Error
                    ? error.message
                    : `Failed to load ${op.label} plans.`,
              ],
            },
          }));
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          if (!cancelled) setLoadingOperators((current) => ({ ...current, [op.id]: false }));
        });
    }

    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, [operatorResults, requestedOperators]);

  useEffect(() => { localStorage.setItem(TAB_STORAGE_KEY, tab); }, [tab]);
  useEffect(() => { localStorage.setItem(OPERATOR_STORAGE_KEY, operator); }, [operator]);
  useEffect(() => { localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(selectedIds)); }, [selectedIds]);
  useEffect(() => { localStorage.setItem(REQUIREMENT_STORAGE_KEY, requirement); }, [requirement]);

  const operatorData = operatorResults[operator];
  const allPlans = operatorData?.plans ?? [];
  const fetchedAt = operatorData?.fetchedAt ?? '';
  const sourceUrl = operatorData?.sourceUrl ?? '';
  const warnings = operatorData?.warnings ?? [];
  const isLoadingPlans = Boolean(loadingOperators[operator]);

  const jioCategories = useMemo(
    () => ['All', ...Array.from(new Set(allPlans.map((plan) => plan.category))).sort((a, b) => a.localeCompare(b))],
    [allPlans],
  );

  const filteredPlans = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = allPlans.filter((plan) => {
      const matchesCategory = category === 'All' || plan.category === category;
      const matchesCustom =
        (!customFilters.sms || hasSms(plan)) &&
        (!customFilters.voice || hasVoice(plan)) &&
        (!customFilters.data || hasData(plan)) &&
        (!customFilters.ott || hasOtt(plan));
      const haystack = [
        plan.displayName,
        plan.category,
        plan.subCategory,
        plan.amountLabel,
        plan.validity,
        plan.highSpeedData,
        plan.totalData,
        plan.voice,
        plan.sms,
        plan.subscriptions.join(' '),
        plan.notes.join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return matchesCategory && matchesCustom && (!needle || haystack.includes(needle));
    });

    if (customMode === 'data_desc') {
      return [...filtered].sort((a, b) => planDataScore(b) - planDataScore(a) || a.price - b.price);
    }

    return filtered;
  }, [category, allPlans, query, customFilters, customMode]);

  const selectedPlans = useMemo(
    () => selectedIds.map((id) => allPlans.find((plan) => plan.id === id)).filter((plan): plan is MobilePlan => Boolean(plan)),
    [allPlans, selectedIds],
  );

  const commonAspects = useMemo(() => getCommonAspects(selectedPlans), [selectedPlans]);
  const specificAspects = useMemo(() => getSpecificAspects(selectedPlans, commonAspects), [commonAspects, selectedPlans]);

  function togglePlan(planId: string) {
    setSelectedIds((current) =>
      current.includes(planId) ? current.filter((id) => id !== planId) : [...current, planId].slice(0, 8),
    );
    setAiState({ status: 'idle' });
  }

  async function runAiCompare() {
    if (selectedPlans.length < 2) {
      setAiState({ status: 'error', error: 'Select at least two plans.' });
      return;
    }

    setAiState({ status: 'loading' });
    try {
      const response = await fetch('/api/mobile-recharge/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plans: selectedPlans, requirement }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        source?: string;
        recommendation?: AiRecommendation;
        warning?: string;
      };
      if (!response.ok || !data.ok || !data.recommendation) {
        throw new Error(data.error || 'Plan recommendation failed.');
      }
      setAiState({
        status: 'ready',
        source: data.source ?? 'deepseek',
        recommendation: data.recommendation,
        warning: data.warning,
      });
    } catch (error) {
      setAiState({ status: 'error', error: error instanceof Error ? error.message : 'Plan recommendation failed.' });
    }
  }

  const operatorLabel = OPERATORS.find((o) => o.id === operator)?.label ?? operator;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold text-duored-deep">Mobile Recharge</h1>
          <p className="max-w-3xl font-semibold text-duored-muted">
            Compare prepaid plans from Jio and Airtel. Select plans, compare shared aspects, then ask DeepSeek which one fits your requirement.
          </p>
          <p className="text-sm font-bold text-duored-muted">
            {isLoadingPlans
              ? `Loading ${operatorLabel} plans...`
              : `${allPlans.length} ${operatorLabel} plans loaded. Last refreshed ${formatFetchedAt(fetchedAt)}.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="btn-duo border-2 border-duored-border bg-white text-duored-ink shadow-card">
              Open {operatorLabel} source
            </a>
          ) : null}
        </div>
      </section>

      <section className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-extrabold uppercase text-duored-muted">Operator</label>
          <div className="inline-flex rounded-chonk border-2 border-duored-border bg-white p-1 shadow-card">
            {OPERATORS.map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => {
                  setOperator(op.id);
                  setSelectedIds([]);
                  setCategory('All');
                  setCustomMode('none');
                  setCustomFilters({ sms: false, voice: false, data: false, ott: false });
                  setAiState({ status: 'idle' });
                }}
                className={[
                  'rounded-2xl px-4 py-2 text-sm font-extrabold uppercase',
                  operator === op.id ? `${op.color} text-white` : 'text-duored-ink',
                ].join(' ')}
              >
                {op.label}
              </button>
            ))}
          </div>
        </div>

      </section>

      {warnings.length > 0 ? (
        <div className="rounded-chonk border-2 border-amber-200 bg-amber-50 px-4 py-3 font-bold text-amber-800">
          {warnings.join(' ')}
        </div>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-chonk border-2 border-duored-border bg-white p-1 shadow-card">
          {(['plans', 'compare'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={[
                'rounded-2xl px-4 py-2 text-sm font-extrabold uppercase',
                tab === value ? 'bg-duored-main text-white' : 'text-duored-ink',
              ].join(' ')}
            >
              {value === 'plans' ? 'Plans' : `Compare (${selectedPlans.length})`}
            </button>
          ))}
        </div>
        {selectedPlans.length > 0 ? (
          <button type="button" className="chip-danger" onClick={() => setSelectedIds([])}>
            Clear selected
          </button>
        ) : null}
      </section>

      {tab === 'plans' ? (
        <section className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
            <input
              className="text-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by data, validity, OTT, voice, price..."
            />
            <select
              className="text-input"
              value={customMode === 'data_desc' ? 'custom:data_desc' : category}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'custom:data_desc') {
                  setCustomMode('data_desc');
                  setCategory('All');
                  return;
                }
                setCustomMode('none');
                setCategory(value);
              }}
            >
              <optgroup label="Jio categories">
                {jioCategories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Custom">
                <option value="custom:data_desc">Data wise sorting</option>
              </optgroup>
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            {jioCategories.slice(0, 12).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setCategory(item);
                  setCustomMode('none');
                }}
                className={customMode === 'none' && category === item ? 'chip max-w-full whitespace-normal bg-duored-main text-white' : 'chip max-w-full whitespace-normal'}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="rounded-2xl border-2 border-duored-border bg-white p-3">
            <p className="mb-2 text-xs font-extrabold uppercase text-duored-muted">Custom</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCustomMode((current) => (current === 'data_desc' ? 'none' : 'data_desc'));
                  setCategory('All');
                }}
                className={customMode === 'data_desc' ? 'chip max-w-full whitespace-normal bg-duored-main text-white' : 'chip max-w-full whitespace-normal'}
              >
                Data wise sorting
              </button>
              {CUSTOM_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setCustomFilters((current) => ({ ...current, [filter.key]: !current[filter.key] }))}
                  className={customFilters[filter.key] ? 'chip max-w-full whitespace-normal bg-duored-main text-white' : 'chip max-w-full whitespace-normal'}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {filteredPlans.length === 0 ? (
              <div className="card-panel xl:col-span-2">
                <h2 className="section-title">{isLoadingPlans ? `Loading ${operatorLabel} plans` : 'No plans found'}</h2>
                <p className="font-semibold text-duored-muted">
                  {isLoadingPlans ? 'Plans will appear here automatically.' : 'Try another search or category.'}
                </p>
              </div>
            ) : null}
            {filteredPlans.map((plan) => {
              const selected = selectedIds.includes(plan.id);
              return (
                <article key={plan.id} className="card-panel min-w-0 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <span className="chip-soft max-w-full whitespace-normal text-left">{plan.category}</span>
                        <span className="chip-soft max-w-full whitespace-normal text-left">{plan.subCategory}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePlan(plan.id)}
                      className={selected ? 'btn-duored' : 'btn-duo border-2 border-duored-border bg-white text-duored-ink shadow-card'}
                    >
                      {selected ? 'Selected' : 'Compare'}
                    </button>
                  </div>

                  <dl className="grid gap-3 md:grid-cols-3">
                    {[
                      ['Plan name', plan.displayName],
                      ['Price of plan', plan.amountLabel],
                      ['Validity', plan.validity || 'Unknown'],
                    ]
                      .map(([label, value]) => (
                        <div key={label} className="rounded-2xl border-2 border-duored-border bg-white px-3 py-2">
                          <dt className="text-xs font-extrabold uppercase text-duored-muted">{label}</dt>
                          <dd className="break-words font-extrabold text-duored-ink">{value}</dd>
                        </div>
                      ))}
                  </dl>

                  <dl className="grid gap-3 sm:grid-cols-2">
                    {[
                      ['Contains SMS', hasSms(plan) ? plan.sms : 'No'],
                      ['Voice call', hasVoice(plan) ? plan.voice : 'No'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border-2 border-duored-border bg-white px-3 py-2">
                        <dt className="text-xs font-extrabold uppercase text-duored-muted">{label}</dt>
                        <dd className="break-words font-extrabold text-duored-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="grid gap-3 lg:grid-cols-3">
                    <div className="rounded-2xl border-2 border-duored-border bg-white px-3 py-2">
                      <p className="text-xs font-extrabold uppercase text-duored-muted">Subscriptions under this plan</p>
                      <p className="mt-1 break-words font-extrabold text-duored-ink">
                        {plan.subscriptions.length ? plan.subscriptions.join(', ') : 'No subscriptions'}
                      </p>
                    </div>
                    <div className="rounded-2xl border-2 border-duored-border bg-white px-3 py-2">
                      <p className="text-xs font-extrabold uppercase text-duored-muted">Recharge conditions</p>
                      <p className="mt-1 break-words font-extrabold text-duored-ink">{planConditionText(plan)}</p>
                    </div>
                    <div className="rounded-2xl border-2 border-duored-border bg-white px-3 py-2">
                      <p className="text-xs font-extrabold uppercase text-duored-muted">Remaining details</p>
                      <p className="mt-1 break-words font-extrabold text-duored-ink">
                        {[
                          plan.highSpeedData ? `Data: ${plan.highSpeedData}` : '',
                          plan.totalData && plan.totalData !== plan.highSpeedData ? `Total: ${plan.totalData}` : '',
                          plan.notes.slice(0, 3).join('; '),
                          plan.details
                            .filter((detail) => !/validity|voice|sms/i.test(detail.header))
                            .slice(0, 4)
                            .map((detail) => `${detail.header}: ${detail.value}`)
                            .join('; '),
                        ].filter(Boolean).join(' | ') || 'No extra details'}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="space-y-5">
          {selectedPlans.length < 2 ? (
            <div className="card-panel">
              <h2 className="section-title">Select at least two plans</h2>
              <p className="font-semibold text-duored-muted">Use the Plans tab to add {operatorLabel} prepaid plans for comparison.</p>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-chonk border-2 border-duored-border bg-white shadow-roseCard">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left">
                    <thead className="bg-duored-soft">
                      <tr>
                        <th className="border-b-2 border-duored-border px-4 py-3 text-sm font-extrabold uppercase text-duored-muted">
                          Aspect
                        </th>
                        {selectedPlans.map((plan, index) => (
                          <th
                            key={plan.id}
                            className="min-w-56 border-b-2 border-duored-border px-4 py-3 text-sm font-extrabold text-duored-ink"
                          >
                            <div className="space-y-1">
                              <div>{`P${index + 1}: ${plan.amountLabel}`}</div>
                              <div className="text-xs text-duored-muted">{plan.displayName}</div>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {commonAspects.map((row) => (
                        <tr key={row.aspect}>
                          <th className="border-b border-duored-border px-4 py-3 align-top font-extrabold text-duored-ink">
                            {row.aspect}
                          </th>
                          {selectedPlans.map((plan) => (
                            <td key={`${row.aspect}-${plan.id}`} className="border-b border-duored-border px-4 py-3 align-top font-semibold text-duored-muted">
                              {row.values.find((value) => value.planId === plan.id)?.value || 'Unknown'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-extrabold uppercase text-duored-muted" htmlFor="requirement">
                  Requirement
                </label>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem]">
                  <textarea
                    id="requirement"
                    className="text-input min-h-24 resize-y"
                    value={requirement}
                    onChange={(event) => setRequirement(event.target.value)}
                    placeholder="Example: cheapest plan for my parents with long validity and calling, not much data"
                  />
                  <button type="button" onClick={runAiCompare} disabled={aiState.status === 'loading'} className="btn-duored h-fit">
                    {aiState.status === 'loading' ? 'Asking...' : 'Ask DeepSeek'}
                  </button>
                </div>
              </div>

              {aiState.status === 'error' ? (
                <div className="rounded-chonk border-2 border-red-200 bg-red-50 px-4 py-3 font-bold text-red-700">
                  {aiState.error}
                </div>
              ) : null}

              {aiState.status === 'ready' ? (
                <div className="card-panel space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="chip-price">{aiState.recommendation.final_pick.plan_name}</span>
                    <span className="chip-soft">{aiState.recommendation.final_pick.confidence} confidence</span>
                    <span className="chip-soft">{aiState.source === 'deepseek' ? 'DeepSeek' : 'FinFlow fallback'}</span>
                  </div>
                  <div>
                    <h2 className="section-title">Final pick</h2>
                    <p className="font-extrabold text-duored-ink">{aiState.recommendation.final_pick.purpose}</p>
                    <p className="font-semibold text-duored-muted">{aiState.recommendation.final_pick.reason}</p>
                  </div>
                  {aiState.recommendation.tradeoffs.length ? (
                    <ul className="space-y-1 text-sm font-semibold text-duored-muted">
                      {aiState.recommendation.tradeoffs.map((tradeoff) => (
                        <li key={tradeoff}>{tradeoff}</li>
                      ))}
                    </ul>
                  ) : null}
                  {aiState.warning ? <p className="text-sm font-bold text-amber-700">{aiState.warning}</p> : null}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                {specificAspects.map(({ plan, aspects }) => (
                  <article key={plan.id} className="rounded-chonk border-2 border-duored-border bg-white p-4 shadow-roseCard">
                    <h3 className="text-lg font-extrabold text-duored-ink">{plan.displayName}</h3>
                    {aspects.length ? (
                      <dl className="mt-3 space-y-2">
                        {aspects.map((item) => (
                          <div key={item.aspect} className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                            <dt className="font-extrabold text-duored-ink">{item.aspect}</dt>
                            <dd className="font-semibold text-duored-muted">{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-2 font-semibold text-duored-muted">No extra plan-specific aspects beyond the shared table.</p>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
