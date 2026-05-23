export const MARKET_PLATFORMS = ['amazon', 'flipkart', 'meesho', 'myntra'] as const;

export type MarketPlatform = (typeof MARKET_PLATFORMS)[number];

export type MarketSortValue =
  | 'relevance'
  | 'review_count_desc'
  | 'rating_desc'
  | 'magic_score_desc'
  | 'price_desc'
  | 'price_asc';

export interface MarketSearchFilters {
  platforms?: MarketPlatform[];
  minReviewCount?: number;
  minRating?: number;
  bestSellerOnly?: boolean;
  primeOnly?: boolean;
  amazonsChoiceOnly?: boolean;
  limitedTimeDealOnly?: boolean;
  sortBy?: MarketSortValue;
}

export interface MarketProduct {
  id: string;
  platform: MarketPlatform;
  platformLabel: string;
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  price: number;
  currency: string;
  rating: number;
  reviewCount: number;
  badges: string[];
  detailLines: string[];
  magicScore: number;
}

export interface MarketSourceStatus {
  platform: MarketPlatform;
  label: string;
  ok: boolean;
  count: number;
  url: string;
  error?: string;
}

export interface MarketSearchResponse {
  ok: true;
  query: string;
  results: MarketProduct[];
  sources: MarketSourceStatus[];
}

type PlatformConfig = {
  platform: MarketPlatform;
  label: string;
  buildUrl: (query: string, filters: Required<MarketSearchFilters>) => string;
  parse: (html: string, url: string) => MarketProduct[];
};

const PRODUCT_FETCH_TIMEOUT_MS = 9000;
const MAX_MARKET_HTML_BYTES = 1600000;
const MAX_RESULTS_PER_PLATFORM = 16;

const DEFAULT_FILTERS: Required<MarketSearchFilters> = {
  platforms: [...MARKET_PLATFORMS],
  minReviewCount: 0,
  minRating: 0,
  bestSellerOnly: false,
  primeOnly: false,
  amazonsChoiceOnly: false,
  limitedTimeDealOnly: false,
  sortBy: 'relevance',
};

const PLATFORM_LABELS: Record<MarketPlatform, string> = {
  amazon: 'Amazon',
  flipkart: 'Flipkart',
  meesho: 'Meesho',
  myntra: 'Myntra',
};

function cleanText(value: string): string {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function parseShortNumber(value: string): number {
  const cleaned = cleanText(value).replace(/[(),\s+]/g, '');
  const short = cleaned.match(/^([\d.]+)([KkMm])/);
  if (short) {
    const base = Number.parseFloat(short[1]);
    if (!Number.isFinite(base)) return 0;
    return Math.round(base * (short[2].toLowerCase() === 'm' ? 1000000 : 1000));
  }
  const plain = Number.parseInt(cleaned.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(plain) ? plain : 0;
}

function parsePrice(value: string): number {
  const match = cleanText(value).match(/(?:Rs\.?|INR|\u20b9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function absoluteUrl(value: string, base: string): string {
  const clean = decodeHtml(value).trim();
  if (!clean) return '';
  try {
    return new URL(clean, base).toString();
  } catch {
    return '';
  }
}

function secureImageUrl(value: string, base: string): string {
  const url = absoluteUrl(value, base);
  return url.startsWith('http://') ? url.replace(/^http:\/\//, 'https://') : url;
}

function uniqueByUrl(products: MarketProduct[]): MarketProduct[] {
  const seen = new Set<string>();
  const out: MarketProduct[] = [];
  for (const product of products) {
    const key = product.url || product.title.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(product);
  }
  return out;
}

function extractBalancedJson(html: string, marker: string): unknown | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = html.indexOf('{', markerIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function getJsonLd(html: string, id?: string): unknown[] {
  const idPart = id ? `[^>]*id=["']${id}["']` : '[^>]*';
  const regex = new RegExp(`<script\\s+[^>]*type=["']application/ld\\+json["']${idPart}[^>]*>([\\s\\S]*?)<\\/script>`, 'gi');
  const out: unknown[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim()) as unknown;
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return out;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      const chunk = value.length > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.length;
      if (value.length > remaining) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Response may already be complete.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function buildAmazonUrl(query: string, filters: Required<MarketSearchFilters>): string {
  const url = new URL('https://www.amazon.in/s');
  url.searchParams.set('k', query);
  if (filters.sortBy === 'price_asc') url.searchParams.set('s', 'price-asc-rank');
  if (filters.sortBy === 'price_desc') url.searchParams.set('s', 'price-desc-rank');
  if (filters.sortBy === 'review_count_desc') url.searchParams.set('s', 'review-rank');
  if (filters.minRating >= 4) url.searchParams.set('rh', 'p_72:1318476031');
  return url.toString();
}

function normalizeAmazonProductUrl(rawHref: string): string {
  const url = new URL(decodeHtml(rawHref), 'https://www.amazon.in');
  const nested = url.searchParams.get('url');
  if (nested) return new URL(decodeHtml(nested), 'https://www.amazon.in').toString().split('/ref=')[0];
  return url.toString().split('/ref=')[0];
}

function parseAmazon(html: string): MarketProduct[] {
  const starts: number[] = [];
  const marker = 'data-component-type="s-search-result"';
  let cursor = 0;
  while (true) {
    const found = html.indexOf(marker, cursor);
    if (found < 0) break;
    starts.push(Math.max(0, html.lastIndexOf('<div', found)));
    cursor = found + marker.length;
  }

  const products: MarketProduct[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const block = html.slice(starts[i], starts[i + 1] ?? starts[i] + 50000);
    const asin = decodeHtml(block.match(/data-asin=["']([^"']+)["']/i)?.[1] ?? '');
    if (!asin) continue;

    const title =
      cleanText(block.match(/<h2[^>]*aria-label=["']([^"']+)["']/i)?.[1] ?? '') ||
      cleanText(block.match(/<h2[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    if (!title) continue;

    const href = block.match(/<a[^>]+href=["']([^"']*(?:\/dp\/|url=%2F)[^"']+)["'][^>]*>\s*<h2/i)?.[1] ??
      block.match(/href=["']([^"']*\/dp\/[^"']+)["']/i)?.[1] ??
      `/dp/${asin}`;
    const url = normalizeAmazonProductUrl(href);
    const imageUrl = secureImageUrl(block.match(/<img[^>]+class=["'][^"']*s-image[^"']*["'][^>]+src=["']([^"']+)["']/i)?.[1] ?? '', url);
    const price = parsePrice(block.match(/<span[^>]+class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
    const rating = Number.parseFloat(block.match(/([\d.]+)\s+out of 5 stars/i)?.[1] ?? '') || 0;
    const reviewCount =
      parseShortNumber(block.match(/#customerReviews["'][\s\S]*?<span[^>]*>\(?([^<()]+)\)?<\/span>/i)?.[1] ?? '') ||
      parseShortNumber(block.match(/aria-label=["']([^"']*(?:ratings|reviews)[^"']*)["']/i)?.[1] ?? '');
    const lower = cleanText(block).toLowerCase();
    const badges = [
      lower.includes('best seller') ? 'Best seller' : '',
      lower.includes("amazon's choice") || lower.includes('amazons choice') ? "Amazon's Choice" : '',
      lower.includes('limited time deal') || lower.includes('deal of the day') ? 'Limited time deal' : '',
      /a-icon-prime|amazon prime/i.test(block) ? 'Prime' : '',
    ].filter(Boolean);
    const bought = cleanText(block.match(/([0-9][^<]{0,30}bought in past month)/i)?.[1] ?? '');

    products.push({
      id: `amazon-${asin}`,
      platform: 'amazon',
      platformLabel: PLATFORM_LABELS.amazon,
      title: title.replace(/^Sponsored Ad -\s*/i, ''),
      description: cleanDescription([title.replace(/^Sponsored Ad -\s*/i, ''), bought, badges.join(', ')]),
      url,
      imageUrl,
      price,
      currency: 'INR',
      rating,
      reviewCount,
      badges,
      detailLines: [bought, rating ? `${rating.toFixed(1)} stars` : '', reviewCount ? `${reviewCount} reviews` : ''].filter(Boolean),
      magicScore: rating * reviewCount,
    });
  }
  return uniqueByUrl(products).slice(0, MAX_RESULTS_PER_PLATFORM);
}

function buildFlipkartUrl(query: string, filters: Required<MarketSearchFilters>): string {
  const url = new URL('https://www.flipkart.com/search');
  url.searchParams.set('q', query);
  if (filters.sortBy === 'price_asc') url.searchParams.set('sort', 'price_asc');
  if (filters.sortBy === 'price_desc') url.searchParams.set('sort', 'price_desc');
  if (filters.sortBy === 'rating_desc' || filters.sortBy === 'review_count_desc') url.searchParams.set('sort', 'popularity');
  return url.toString();
}

function parseFlipkart(html: string): MarketProduct[] {
  const domProducts = parseFlipkartDomCards(html);
  if (domProducts.length > 0) return domProducts;

  const jsonLd = getJsonLd(html, 'jsonLD');
  const itemList = jsonLd
    .flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
    .find((entry): entry is { itemListElement?: Array<{ name?: string; url?: string; position?: number }> } => {
      return Boolean(entry && typeof entry === 'object' && 'itemListElement' in entry);
    });
  const initial = extractBalancedJson(html, 'window.__INITIAL_STATE__') as { answerBox?: unknown } | null;
  const priceByTitle = new Map<string, number>();
  collectFlipkartAnswerPrices(initial?.answerBox, priceByTitle);

  return uniqueByUrl((itemList?.itemListElement ?? []).map((entry, index) => {
    const title = cleanText(entry.name ?? '');
    const url = absoluteUrl(entry.url ?? '', 'https://www.flipkart.com');
    const price = priceByTitle.get(title.toLowerCase()) ?? 0;
    return {
      id: `flipkart-${entry.position ?? index}`,
      platform: 'flipkart' as const,
      platformLabel: PLATFORM_LABELS.flipkart,
      title,
      description: cleanDescription([title]),
      url,
      imageUrl: '',
      price,
      currency: 'INR',
      rating: 0,
      reviewCount: 0,
      badges: [],
      detailLines: [price > 0 ? 'Price captured from Flipkart result data' : 'Open product for full details'],
      magicScore: 0,
    };
  }).filter((product) => product.title && product.url)).slice(0, MAX_RESULTS_PER_PLATFORM);
}

function parseFlipkartDomCards(html: string): MarketProduct[] {
  const products: MarketProduct[] = [];
  const cardRegex = /<div\s+data-id=["']([^"']+)["'][^>]*>([\s\S]*?)(?=<div\s+data-id=["']|<script type=["']application\/ld\+json|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = cardRegex.exec(html)) !== null && products.length < MAX_RESULTS_PER_PLATFORM) {
    const productId = match[1];
    const block = match[2];
    const title =
      cleanText(block.match(/<a[^>]+title=["']([^"']+)["']/i)?.[1] ?? '') ||
      cleanText(block.match(/<img[^>]+alt=["']([^"']+)["']/i)?.[1] ?? '');
    const href = block.match(/<a[^>]+href=["']([^"']+\/p\/[^"']+)["']/i)?.[1] ?? '';
    const url = absoluteUrl(href, 'https://www.flipkart.com');
    if (!title || !url) continue;

    const imageUrl = secureImageUrl(block.match(/<img[^>]+(?:class=["'][^"']*UCc1lI[^"']*["'][^>]+)?src=["']([^"']+)["']/i)?.[1] ?? '', url);
    const price = parsePrice(block.match(/<div[^>]+class=["'][^"']*hZ3P6w[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '');
    const rating = Number.parseFloat(cleanText(block.match(/<div[^>]+class=["'][^"']*MKiFS6[^"']*["'][^>]*>([\d.]+)/i)?.[1] ?? '')) || 0;
    const reviewCount = parseShortNumber(block.match(/<span[^>]+class=["'][^"']*PvbNMB[^"']*["'][^>]*>\(?([^<()]+)\)?<\/span>/i)?.[1] ?? '');
    const lower = cleanText(block).toLowerCase();
    const badges = [
      /fa_9e47c1|fassured|FIdGa1/i.test(block) ? 'Assured' : '',
      lower.includes('super deals') || lower.includes('off') ? 'Deal' : '',
      lower.includes('only few left') ? 'Low stock' : '',
    ].filter(Boolean);
    const color = cleanText(block.match(/<div[^>]+class=["'][^"']*U_GKRr[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '');

    products.push({
      id: `flipkart-${productId}`,
      platform: 'flipkart',
      platformLabel: PLATFORM_LABELS.flipkart,
      title,
      description: cleanDescription([title, color, badges.join(', ')]),
      url,
      imageUrl,
      price,
      currency: 'INR',
      rating,
      reviewCount,
      badges,
      detailLines: [color, rating ? `${rating.toFixed(1)} stars` : '', reviewCount ? `${reviewCount} reviews` : ''].filter(Boolean),
      magicScore: rating * reviewCount,
    });
  }
  return uniqueByUrl(products);
}

function collectFlipkartAnswerPrices(value: unknown, out: Map<string, number>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectFlipkartAnswerPrices(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.title === 'string' && Array.isArray(record.values)) {
    const price = parsePrice(String(record.values[0] ?? ''));
    if (price > 0) out.set(cleanText(record.title).toLowerCase(), price);
  }
  for (const child of Object.values(record)) collectFlipkartAnswerPrices(child, out);
}

function buildMyntraUrl(query: string, filters: Required<MarketSearchFilters>): string {
  const slug = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'products';
  const url = new URL(`https://www.myntra.com/${slug}`);
  if (filters.sortBy === 'price_asc') url.searchParams.set('sort', 'price_asc');
  if (filters.sortBy === 'price_desc') url.searchParams.set('sort', 'price_desc');
  if (filters.sortBy === 'rating_desc') url.searchParams.set('sort', 'Customer Rating');
  return url.toString();
}

function parseMyntra(html: string): MarketProduct[] {
  const data = extractBalancedJson(html, 'window.__myx') as {
    searchData?: { results?: { products?: Array<Record<string, unknown>> } };
  } | null;
  const products = data?.searchData?.results?.products ?? [];

  return uniqueByUrl(products.map((product) => {
    const title = cleanText(String(product.productName ?? product.product ?? ''));
    const brand = cleanText(String(product.brand ?? ''));
    const landingPageUrl = String(product.landingPageUrl ?? '');
    const url = absoluteUrl(landingPageUrl, 'https://www.myntra.com');
    const imageUrl = secureImageUrl(String(product.searchImage ?? ''), url);
    const price = Number(product.discountedPrice ?? product.price ?? product.mrp ?? 0) || 0;
    const rating = Number(product.rating ?? 0) || 0;
    const reviewCount = Number(product.ratingCount ?? 0) || 0;
    const discount = Number(product.discountDisplayLabel ?? product.discountLabel ?? product.discount ?? 0);
    const badges = [
      Number(product.isFastFashion ?? 0) ? 'Fast fashion' : '',
      discount ? 'Deal' : '',
    ].filter(Boolean);
    const detailLines = [
      brand,
      rating ? `${rating.toFixed(1)} stars` : '',
      reviewCount ? `${reviewCount} reviews` : '',
      product.sizes ? `Sizes: ${cleanText(String(product.sizes))}` : '',
    ].filter(Boolean);

    return {
      id: `myntra-${String(product.productId ?? landingPageUrl)}`,
      platform: 'myntra' as const,
      platformLabel: PLATFORM_LABELS.myntra,
      title,
      description: cleanDescription([brand, title]),
      url,
      imageUrl,
      price,
      currency: 'INR',
      rating,
      reviewCount,
      badges,
      detailLines,
      magicScore: rating * reviewCount,
    };
  }).filter((product) => product.title && product.url)).slice(0, MAX_RESULTS_PER_PLATFORM);
}

function buildMeeshoUrl(query: string): string {
  const url = new URL('https://www.meesho.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('searchType', 'manual');
  url.searchParams.set('searchIdentifier', 'text_search');
  return url.toString();
}

function parseMeesho(html: string, sourceUrl: string): MarketProduct[] {
  const products: MarketProduct[] = [];
  const seen = new Set<string>();
  const linkRegex = /<a[^>]+href=["']([^"']*\/[^"']*\/p\/[^"']+)["'][^>]*>([\s\S]{0,5000}?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null && products.length < MAX_RESULTS_PER_PLATFORM) {
    const url = absoluteUrl(match[1], sourceUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const block = match[2];
    const title = cleanText(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? block).slice(0, 180);
    if (!title) continue;
    const price = parsePrice(block);
    const rating = Number.parseFloat(cleanText(block).match(/([\d.]+)\s*(?:stars?|rating)/i)?.[1] ?? '') || 0;
    const reviewCount = parseShortNumber(cleanText(block).match(/([\d,.KMkm]+)\s*(?:reviews?|ratings?)/i)?.[1] ?? '');
    products.push({
      id: `meesho-${products.length}-${url}`,
      platform: 'meesho',
      platformLabel: PLATFORM_LABELS.meesho,
      title,
      description: cleanDescription([title]),
      url,
      imageUrl: secureImageUrl(block.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '', sourceUrl),
      price,
      currency: 'INR',
      rating,
      reviewCount,
      badges: [],
      detailLines: [rating ? `${rating.toFixed(1)} stars` : '', reviewCount ? `${reviewCount} reviews` : ''].filter(Boolean),
      magicScore: rating * reviewCount,
    });
  }
  return products;
}

function cleanDescription(parts: string[]): string {
  const text = parts.map(cleanText).filter(Boolean).join(' | ');
  return text.length > 240 ? `${text.slice(0, 237).trim()}...` : text;
}

function normalizeFilters(filters?: MarketSearchFilters): Required<MarketSearchFilters> {
  const requestedPlatforms = filters?.platforms?.filter((platform): platform is MarketPlatform =>
    MARKET_PLATFORMS.includes(platform),
  );
  return {
    platforms: requestedPlatforms?.length ? requestedPlatforms : DEFAULT_FILTERS.platforms,
    minReviewCount: Math.max(0, Math.round(Number(filters?.minReviewCount ?? 0) || 0)),
    minRating: Math.max(0, Math.min(5, Number(filters?.minRating ?? 0) || 0)),
    bestSellerOnly: Boolean(filters?.bestSellerOnly),
    primeOnly: Boolean(filters?.primeOnly),
    amazonsChoiceOnly: Boolean(filters?.amazonsChoiceOnly),
    limitedTimeDealOnly: Boolean(filters?.limitedTimeDealOnly),
    sortBy: filters?.sortBy ?? 'relevance',
  };
}

function applyFilters(products: MarketProduct[], filters: Required<MarketSearchFilters>): MarketProduct[] {
  return products.filter((product) => {
    if (filters.minReviewCount > 0 && product.reviewCount < filters.minReviewCount) return false;
    if (filters.minRating > 0 && product.rating < filters.minRating) return false;
    if (filters.bestSellerOnly && !product.badges.some((badge) => /best/i.test(badge))) return false;
    if (filters.primeOnly && !product.badges.some((badge) => /prime|assured|fast/i.test(badge))) return false;
    if (filters.amazonsChoiceOnly && !product.badges.some((badge) => /choice/i.test(badge))) return false;
    if (filters.limitedTimeDealOnly && !product.badges.some((badge) => /deal/i.test(badge))) return false;
    return true;
  });
}

function sortProducts(products: MarketProduct[], sortBy: MarketSortValue): MarketProduct[] {
  const sorted = [...products];
  const direction = sortBy === 'price_asc' ? 1 : -1;
  const getter: Record<MarketSortValue, (product: MarketProduct) => number> = {
    relevance: () => 0,
    review_count_desc: (product) => product.reviewCount,
    rating_desc: (product) => product.rating,
    magic_score_desc: (product) => product.magicScore,
    price_desc: (product) => product.price,
    price_asc: (product) => product.price || Number.MAX_SAFE_INTEGER,
  };
  if (sortBy === 'relevance') return sorted;
  sorted.sort((a, b) => (getter[sortBy](a) - getter[sortBy](b)) * direction);
  return sorted;
}

const PLATFORM_CONFIGS: Record<MarketPlatform, PlatformConfig> = {
  amazon: { platform: 'amazon', label: PLATFORM_LABELS.amazon, buildUrl: buildAmazonUrl, parse: parseAmazon },
  flipkart: { platform: 'flipkart', label: PLATFORM_LABELS.flipkart, buildUrl: buildFlipkartUrl, parse: parseFlipkart },
  meesho: { platform: 'meesho', label: PLATFORM_LABELS.meesho, buildUrl: buildMeeshoUrl, parse: parseMeesho },
  myntra: { platform: 'myntra', label: PLATFORM_LABELS.myntra, buildUrl: buildMyntraUrl, parse: parseMyntra },
};

async function searchPlatform(config: PlatformConfig, query: string, filters: Required<MarketSearchFilters>) {
  const url = config.buildUrl(query, filters);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'accept-language': 'en-IN,en;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(PRODUCT_FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        products: [] as MarketProduct[],
        source: {
          platform: config.platform,
          label: config.label,
          ok: false,
          count: 0,
          url,
          error: `Search page returned ${response.status}`,
        },
      };
    }

    const html = await readLimitedText(response, MAX_MARKET_HTML_BYTES);
    const products = applyFilters(config.parse(html, url), filters);
    return {
      products,
      source: {
        platform: config.platform,
        label: config.label,
        ok: true,
        count: products.length,
        url,
        error: products.length === 0 ? 'No parseable products matched these filters' : undefined,
      },
    };
  } catch (error) {
    return {
      products: [] as MarketProduct[],
      source: {
        platform: config.platform,
        label: config.label,
        ok: false,
        count: 0,
        url,
        error: error instanceof Error ? error.message : 'Search failed',
      },
    };
  }
}

export async function searchMarketProducts(query: string, filters?: MarketSearchFilters): Promise<MarketSearchResponse> {
  const cleanQuery = cleanText(query).slice(0, 120);
  if (!cleanQuery) {
    return { ok: true, query: '', results: [], sources: [] };
  }

  const normalizedFilters = normalizeFilters(filters);
  const configs = normalizedFilters.platforms.map((platform) => PLATFORM_CONFIGS[platform]);
  const settled = await Promise.all(configs.map((config) => searchPlatform(config, cleanQuery, normalizedFilters)));
  const products = sortProducts(uniqueByUrl(settled.flatMap((entry) => entry.products)), normalizedFilters.sortBy).slice(0, 48);

  return {
    ok: true,
    query: cleanQuery,
    results: products,
    sources: settled.map((entry) => entry.source),
  };
}
