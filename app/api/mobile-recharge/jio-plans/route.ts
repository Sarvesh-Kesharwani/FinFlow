import { getJioMobilePlans } from '@/lib/jio-mobile-plans';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await getJioMobilePlans();
  return Response.json({ ok: result.plans.length > 0, ...result });
}
