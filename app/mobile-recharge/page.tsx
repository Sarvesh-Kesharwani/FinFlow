import type { Metadata } from 'next';
import { MobileRechargeClient } from '@/components/MobileRechargeClient';
import { getJioMobilePlans } from '@/lib/jio-mobile-plans';
import { getAirtelMobilePlans } from '@/lib/airtel-mobile-plans';
import type { MobilePlansResponse } from '@/types/mobile-plan';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mobile Recharge | FinFlow',
  description: 'Compare Jio & Airtel prepaid mobile recharge plans by shared aspects and ask DeepSeek for a final pick.',
};

export default async function MobileRechargePage() {
  const jioResult = await getJioMobilePlans();
  const airtelResult = getAirtelMobilePlans();

  const operators: Record<string, MobilePlansResponse> = {
    jio: jioResult,
    airtel: airtelResult,
  };

  return <MobileRechargeClient operators={operators} />;
}
