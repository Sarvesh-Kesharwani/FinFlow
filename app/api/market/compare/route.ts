import type { MarketProduct } from '@/lib/market-search';

type ComparisonValue = {
  product_ref: string;
  value: string;
};

type CommonDimension = {
  dimension: string;
  values: ComparisonValue[];
  winner_ref?: string;
  reason?: string;
};

type RemainingAspect = {
  product_ref: string;
  dimension: string;
  value: string;
};

type RequirementRecommendation = {
  requirement: string;
  product_ref: string;
  reason: string;
};

type ComparisonResult = {
  common_dimensions: CommonDimension[];
  uncommon_dimensions: RemainingAspect[];
  requirement_recommendations: RequirementRecommendation[];
  final_ai_pick?: {
    product_ref: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
  };
};

type Aspect = {
  dimension: string;
  value: string;
  score?: number;
};

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function firstMatch(value: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return clean(match[1]);
    if (match?.[0]) return clean(match[0]);
  }
  return '';
}

function addAspect(aspects: Aspect[], dimension: string, value: string | number | undefined, score?: number) {
  const text = typeof value === 'number' ? String(value) : clean(String(value ?? ''));
  if (!text || /^unknown$/i.test(text) || aspects.some((aspect) => aspect.dimension === dimension)) return;
  aspects.push({ dimension, value: text, score });
}

function inferProductType(text: string): string {
  const patterns: Array<[RegExp, string]> = [
    [/\bkeyboard\b/i, 'Keyboard'],
    [/\bmouse\b/i, 'Mouse'],
    [/\b(?:ssd|solid state drive|hdd|hard drive|hard disk)\b/i, 'Storage drive'],
    [/\bshoe|sneaker|sandal\b/i, 'Footwear'],
    [/\bbackpack|rucksack|bag\b/i, 'Bag'],
    [/\bphone|smartphone\b/i, 'Smartphone'],
    [/\blaptop|notebook\b/i, 'Laptop'],
    [/\bheadphone|earbud|earphone|speaker\b/i, 'Audio'],
    [/\bwatch|smartwatch\b/i, 'Watch'],
  ];
  return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? 'Product';
}

function buildProductAspects(product: MarketProduct): Aspect[] {
  const text = clean([product.title, product.description, product.detailLines.join(' '), product.badges.join(' ')].join(' '));
  const lower = text.toLowerCase();
  const aspects: Aspect[] = [];

  addAspect(aspects, 'Category', inferProductType(text));
  addAspect(aspects, 'Platform', product.platformLabel);
  if (product.price > 0) addAspect(aspects, 'Price', `${product.currency || 'INR'} ${product.price.toLocaleString('en-IN')}`, -product.price);
  if (product.rating > 0) addAspect(aspects, 'Rating', `${product.rating.toFixed(1)} stars`, product.rating);
  if (product.reviewCount > 0) addAspect(aspects, 'Review count', `${product.reviewCount.toLocaleString('en-IN')} reviews`, product.reviewCount);
  if (product.badges.length) addAspect(aspects, 'Marketplace badge', product.badges.join(', '));

  addAspect(aspects, 'Brand', firstMatch(text, [/^([A-Z][A-Za-z0-9&+-]{1,}(?:\s+[A-Z][A-Za-z0-9&+-]{1,})?)/]));
  addAspect(aspects, 'Capacity / size', firstMatch(text, [/\b(\d+(?:\.\d+)?\s?(?:TB|GB|MB|L|litre|liter))\b/i]));
  addAspect(aspects, 'Color', firstMatch(text, [/\b(black|white|blue|red|green|silver|grey|gray|gold|pink|purple|brown|beige)\b/i]));
  addAspect(aspects, 'Warranty', firstMatch(text, [/\b(\d+\s?(?:year|years|yr|yrs|month|months)\s+warranty)\b/i]));

  if (/\bkeyboard\b/i.test(text)) {
    addAspect(aspects, 'Connection', firstMatch(text, [/\b(wired|wireless|bluetooth|2\.4\s?ghz|usb)\b/i]));
    addAspect(aspects, 'Keyboard layout', firstMatch(text, [/\b(full[- ]?size|tkl|tenkeyless|60%|65%|75%|compact|standard)\b/i]));
    addAspect(aspects, 'Switch / key type', firstMatch(text, [/\b(mechanical|semi-mechanical|membrane|chiclet|plunger|scissor)\b/i]));
    if (/backlit|rgb|rainbow/i.test(text)) addAspect(aspects, 'Backlight', firstMatch(text, [/\b(rgb|rainbow|backlit|white backlight)\b/i]) || 'Included');
    if (/spill[- ]?resistant|water[- ]?resistant/i.test(text)) addAspect(aspects, 'Spill resistance', 'Included');
    if (/mouse combo|keyboard and mouse|combo/i.test(text)) addAspect(aspects, 'Combo accessory', 'Keyboard + mouse');
    addAspect(aspects, 'Compatibility', firstMatch(text, [/\b(Windows|macOS|Mac|Android|iPadOS|Chrome OS|PC|Laptop)(?:[,/& ]+(?:Windows|macOS|Mac|Android|iPadOS|Chrome OS|PC|Laptop))*\b/i]));
  }

  if (/\bmouse\b/i.test(text)) {
    addAspect(aspects, 'DPI', firstMatch(text, [/\b(\d{3,5}\s?DPI)\b/i]));
    addAspect(aspects, 'Mouse connection', firstMatch(text, [/\b(wired|wireless|bluetooth|2\.4\s?ghz|usb)\b/i]));
    addAspect(aspects, 'Mouse buttons', firstMatch(text, [/\b(\d+\s?buttons?)\b/i]));
  }

  if (/\b(?:ssd|solid state drive|hdd|hard drive|hard disk)\b/i.test(text)) {
    addAspect(aspects, 'Storage type', /\b(?:ssd|solid state drive)\b/i.test(text) ? 'SSD' : 'Hard drive');
    addAspect(aspects, 'Interface', firstMatch(text, [/\b(USB\s?(?:3\.\d|2\.0|Type-?C|C|A)|Type-?C|Thunderbolt|NVMe|SATA)\b/i]));
    addAspect(aspects, 'Transfer speed', firstMatch(text, [/\b(\d+(?:\.\d+)?\s?(?:MB\/s|GB\/s|Gbps|RPM))\b/i]));
    if (/drop protection|water\/dust|water resistant|dust resistant|IP\d{2}/i.test(text)) {
      addAspect(aspects, 'Protection', firstMatch(text, [/\b(IP\d{2}[^,|]*)\b/i, /\b(\d+\s?m\s?drop protection)\b/i, /\b(water\/dust resistant|water resistant|dust resistant)\b/i]) || 'Protected');
    }
  }

  if (/\bshoe|sneaker|sandal\b/i.test(text)) {
    addAspect(aspects, 'Footwear type', firstMatch(text, [/\b(running shoes?|sneakers?|sandals?|sports shoes?|casual shoes?)\b/i]));
    addAspect(aspects, 'Material', firstMatch(text, [/\b(mesh|leather|synthetic|canvas|rubber|foam)\b/i]));
    addAspect(aspects, 'Closure', firstMatch(text, [/\b(lace[- ]?up|slip[- ]?on|velcro)\b/i]));
  }

  if (/\blaptop|notebook\b/i.test(text)) {
    addAspect(aspects, 'Processor', firstMatch(text, [/\b(Intel\s+[A-Za-z0-9 -]+|Ryzen\s+[A-Za-z0-9 -]+|Apple\s+M\d)\b/i]));
    addAspect(aspects, 'RAM', firstMatch(text, [/\b(\d+\s?GB\s?RAM)\b/i]));
    addAspect(aspects, 'Screen size', firstMatch(text, [/\b(\d{2}(?:\.\d)?\s?(?:inch|inches|"))\b/i]));
  }

  if (/\bphone|smartphone\b/i.test(text)) {
    addAspect(aspects, 'RAM', firstMatch(text, [/\b(\d+\s?GB\s?RAM)\b/i]));
    addAspect(aspects, 'Phone storage', firstMatch(text, [/\b(\d+\s?GB\s?(?:storage|ROM))\b/i]));
    addAspect(aspects, 'Camera', firstMatch(text, [/\b(\d+\s?MP(?:\s?\+\s?\d+\s?MP)*)\b/i]));
  }

  if (/\bbackpack|rucksack|bag\b/i.test(text)) {
    addAspect(aspects, 'Bag capacity', firstMatch(text, [/\b(\d+\s?(?:L|litre|liter))\b/i]));
    addAspect(aspects, 'Laptop support', firstMatch(text, [/\b(\d{2}(?:\.\d)?\s?(?:inch|inches|")\s?laptop)\b/i]));
    if (/water[- ]?resistant|rain cover/i.test(text)) addAspect(aspects, 'Weather protection', firstMatch(text, [/\b(water[- ]?resistant|rain cover)\b/i]));
  }

  if (lower.includes('open marketplace')) {
    addAspect(aspects, 'Search fallback', 'Open live marketplace page for current products');
  }

  return aspects.slice(0, 18);
}

function compareAspectValues(dimension: string, values: ComparisonValue[], products: MarketProduct[]): Pick<CommonDimension, 'winner_ref' | 'reason'> {
  const productByRef = new Map(products.map((product, index) => [`P${index + 1}`, product]));
  if (dimension === 'Price') {
    const priced = values
      .map((value) => ({ ref: value.product_ref, price: productByRef.get(value.product_ref)?.price ?? 0 }))
      .filter((entry) => entry.price > 0)
      .sort((a, b) => a.price - b.price);
    if (priced[0]) return { winner_ref: priced[0].ref, reason: 'Lowest listed price.' };
  }
  if (dimension === 'Rating') {
    const rated = values
      .map((value) => ({ ref: value.product_ref, rating: productByRef.get(value.product_ref)?.rating ?? 0 }))
      .filter((entry) => entry.rating > 0)
      .sort((a, b) => b.rating - a.rating);
    if (rated[0]) return { winner_ref: rated[0].ref, reason: 'Highest listed rating.' };
  }
  if (dimension === 'Review count') {
    const reviewed = values
      .map((value) => ({ ref: value.product_ref, reviewCount: productByRef.get(value.product_ref)?.reviewCount ?? 0 }))
      .filter((entry) => entry.reviewCount > 0)
      .sort((a, b) => b.reviewCount - a.reviewCount);
    if (reviewed[0]) return { winner_ref: reviewed[0].ref, reason: 'Largest review base.' };
  }
  return {};
}

function buildComparison(products: MarketProduct[]): ComparisonResult {
  const aspectEntries = products.map((product, index) => ({
    product,
    productRef: `P${index + 1}`,
    aspects: buildProductAspects(product),
  }));
  const selectedCount = aspectEntries.length;
  const dimensions = new Map<string, Array<{ productRef: string; value: string }>>();

  for (const entry of aspectEntries) {
    for (const aspect of entry.aspects) {
      const values = dimensions.get(aspect.dimension) ?? [];
      values.push({ productRef: entry.productRef, value: aspect.value });
      dimensions.set(aspect.dimension, values);
    }
  }

  const common_dimensions = Array.from(dimensions.entries())
    .filter(([, values]) => new Set(values.map((value) => value.productRef)).size === selectedCount)
    .map(([dimension, values]) => {
      const rowValues = values.map((value) => ({ product_ref: value.productRef, value: value.value }));
      return {
        dimension,
        values: rowValues,
        ...compareAspectValues(dimension, rowValues, products),
      };
    })
    .slice(0, 12);

  const commonSet = new Set(common_dimensions.map((dimension) => dimension.dimension));
  const uncommon_dimensions = aspectEntries
    .flatMap((entry) =>
      entry.aspects
        .filter((aspect) => !commonSet.has(aspect.dimension))
        .map((aspect) => ({
          product_ref: entry.productRef,
          dimension: aspect.dimension,
          value: aspect.value,
        })),
    )
    .slice(0, 36);

  const finalPickIndex = products
    .map((product, index) => ({
      index,
      score: (product.price > 0 ? 100000 / product.price : 0) + product.rating * 120 + Math.log10(product.reviewCount + 1) * 80,
    }))
    .sort((a, b) => b.score - a.score)[0]?.index ?? 0;

  return {
    common_dimensions,
    uncommon_dimensions,
    requirement_recommendations: [
      {
        requirement: 'Best quick pick',
        product_ref: `P${finalPickIndex + 1}`,
        reason: 'Best balance from the available price, rating, and review signals.',
      },
    ],
    final_ai_pick: {
      product_ref: `P${finalPickIndex + 1}`,
      reason: 'Picked from deterministic marketplace signals; open the product pages for final stock, seller, and delivery checks.',
      confidence: products.some((product) => product.price > 0 || product.rating > 0) ? 'medium' : 'low',
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { products?: MarketProduct[] };
    const products = (body.products ?? []).filter((product) => product?.title && product.url).slice(0, 6);
    if (products.length < 2) {
      return Response.json({ ok: false, error: 'Select at least two products to compare.' }, { status: 400 });
    }

    return Response.json({ ok: true, comparison: buildComparison(products) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Product comparison failed.' },
      { status: 500 },
    );
  }
}
