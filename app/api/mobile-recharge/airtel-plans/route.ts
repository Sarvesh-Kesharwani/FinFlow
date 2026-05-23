import { getAirtelMobilePlans } from '@/lib/airtel-mobile-plans';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = getAirtelMobilePlans();
  return Response.json({ ok: result.plans.length > 0, ...result });
}
