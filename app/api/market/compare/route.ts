import type { MarketProduct } from '@/lib/market-search';

type DeepSeekMessage = {
  role: 'system' | 'user';
  content: string;
};

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('DeepSeek did not return JSON');
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: 'DEEPSEEK_API_KEY is not configured.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as { products?: MarketProduct[] };
    const products = (body.products ?? []).filter((product) => product?.title && product.url).slice(0, 6);
    if (products.length < 2) {
      return Response.json({ ok: false, error: 'Select at least two products to compare.' }, { status: 400 });
    }

    const messages: DeepSeekMessage[] = [
      {
        role: 'system',
        content:
          'You compare ecommerce products for a buyer. Return strict JSON only. Do not repeat raw titles. Build common and uncommon decision dimensions from the product category. Include requirement-specific recommendations and one final AI pick. Be concise and practical. Use unknown when evidence is missing.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          output_shape: {
            common_dimensions: [
              { dimension: 'Price', values: [{ product_ref: 'P1', value: '...' }], winner_ref: 'P1', reason: '...' },
            ],
            uncommon_dimensions: [
              { product_ref: 'P1', dimension: 'Unique strength', value: '...' },
            ],
            requirement_recommendations: [
              { requirement: 'Best for daily backup', product_ref: 'P1', reason: '...' },
            ],
            final_ai_pick: {
              product_ref: 'P1',
              reason: '...',
              confidence: 'high|medium|low',
            },
          },
          products: products.map((product, index) => ({
            product_ref: `P${index + 1}`,
            platform: product.platformLabel,
            title: product.title,
            description: product.description,
            price_inr: product.price,
            rating: product.rating,
            review_count: product.reviewCount,
            badges: product.badges,
            details: product.detailLines,
            url: product.url,
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
      const text = await response.text();
      return Response.json(
        { ok: false, error: `DeepSeek returned ${response.status}: ${text.slice(0, 240)}` },
        { status: 502 },
      );
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    return Response.json({ ok: true, comparison: extractJsonObject(content) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'DeepSeek comparison failed.' },
      { status: 500 },
    );
  }
}
