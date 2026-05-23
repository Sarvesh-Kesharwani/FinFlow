import type { MarketProduct } from '@/lib/market-search';

type DeepSeekMessage = {
  role: 'system' | 'user';
  content: string;
};

type ProductAspect = {
  label: string;
  value: string;
  confidence?: 'high' | 'medium' | 'low';
};

type ProductAspectSection = {
  title: string;
  items: ProductAspect[];
};

function extractJsonObject(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed);
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('DeepSeek did not return JSON');
}

function normalizeSections(value: unknown): ProductAspectSection[] {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const sections = Array.isArray(record.sections) ? record.sections : [];
  return sections
    .map((section) => {
      const sectionRecord = section && typeof section === 'object' ? (section as Record<string, unknown>) : {};
      const items = Array.isArray(sectionRecord.items) ? sectionRecord.items : [];
      return {
        title: String(sectionRecord.title ?? '').trim().slice(0, 80),
        items: items
          .map((item) => {
            const itemRecord = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
            const confidence: ProductAspect['confidence'] =
              itemRecord.confidence === 'high' || itemRecord.confidence === 'medium' || itemRecord.confidence === 'low'
                ? itemRecord.confidence
                : undefined;
            return {
              label: String(itemRecord.label ?? '').trim().slice(0, 80),
              value: String(itemRecord.value ?? '').trim().slice(0, 240),
              confidence,
            };
          })
          .filter((item) => item.label && item.value)
          .slice(0, 8),
      };
    })
    .filter((section) => section.title && section.items.length > 0)
    .slice(0, 12);
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: 'DEEPSEEK_API_KEY is not configured.' }, { status: 500 });
  }

  try {
    const body = (await request.json()) as { product?: MarketProduct };
    const product = body.product;
    if (!product?.title || !product.url) {
      return Response.json({ ok: false, error: 'Product details are required.' }, { status: 400 });
    }

    const messages: DeepSeekMessage[] = [
      {
        role: 'system',
        content:
          'You convert ecommerce product data into buyer decision dimensions. Return strict JSON only. Do not repeat the raw product title or raw description. Infer useful aspect groups from the product category, similar to product_identity, performance, compatibility, reliability, physical_characteristics, price_and_value, reviews_and_ratings, seller_and_logistics. Use "unknown" for missing facts. Keep values concise.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          output_shape: {
            sections: [
              {
                title: 'Product identity',
                items: [
                  { label: 'Brand', value: '...', confidence: 'high|medium|low' },
                  { label: 'Model or series', value: '...', confidence: 'high|medium|low' },
                ],
              },
            ],
          },
          product: {
            platform: product.platformLabel,
            title: product.title,
            description: product.description,
            price_inr: product.price,
            rating: product.rating,
            review_count: product.reviewCount,
            badges: product.badges,
            details: product.detailLines,
            url: product.url,
          },
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
      signal: AbortSignal.timeout(20000),
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
    const sections = normalizeSections(extractJsonObject(content));
    return Response.json({ ok: true, sections });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'DeepSeek analysis failed.' },
      { status: 500 },
    );
  }
}
