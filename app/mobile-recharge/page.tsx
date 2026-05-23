import type { Metadata } from 'next';
import { MobileRechargeClient } from '@/components/MobileRechargeClient';
import { JIO_SOURCE_URL } from '@/lib/jio-mobile-plans';
import { getAirtelMobilePlans } from '@/lib/airtel-mobile-plans';
import type { MobilePlansResponse } from '@/types/mobile-plan';

export const metadata: Metadata = {
  title: 'Mobile Recharge | FinFlow',
  description: 'Compare Jio & Airtel prepaid mobile recharge plans by shared aspects and ask DeepSeek for a final pick.',
};

export default function MobileRechargePage() {
  const airtelResult = getAirtelMobilePlans();

  const operators: Record<string, MobilePlansResponse> = {
    jio: {
      plans: [],
      fetchedAt: new Date().toISOString(),
      sourceUrl: JIO_SOURCE_URL,
      warnings: [],
    },
    airtel: airtelResult,
  };

  return <MobileRechargeClient operators={operators} />;
}
