import { searchMarketProducts, type MarketSearchFilters } from '@/lib/market-search';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { query?: unknown; filters?: MarketSearchFilters };
    const query = String(body.query ?? '').trim();
    const results = await searchMarketProducts(query, body.filters);
    return Response.json(results);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Market search failed',
      },
      { status: 500 },
    );
  }
}
