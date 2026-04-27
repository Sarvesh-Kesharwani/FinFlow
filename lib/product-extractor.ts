export interface ProductDetails {
  title: string;
  price: number;
  currency: string;
  sourcePlatform: string;
  imageUrl: string;
  returnable: boolean;
  returnDays?: number;
}

function cleanText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const regex = /([:@\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    out[key] = cleanText(value);
  }
  return out;
}

function getMetas(html: string): Array<Record<string, string>> {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  return tags.map(parseAttrs);
}

function getMetaValue(metas: Array<Record<string, string>>, keys: string[]): string {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const meta of metas) {
    const key = (meta.property ?? meta.name ?? meta.itemprop ?? '').toLowerCase();
    if (!key || !wanted.has(key)) continue;
    if (meta.content) return meta.content;
  }
  return '';
}

function parsePrice(raw: string): number {
  if (!raw) return 0;
  const normalized = raw.replace(/[, ]/g, '').match(/(\d+(\.\d+)?)/);
  if (!normalized) return 0;
  const value = Number(normalized[1]);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

function parseReturnPolicy(html: string): { returnable: boolean; returnDays?: number } {
  const text = cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
  const lower = text.toLowerCase();

  if (/\b(non[-\s]?returnable|not\s+returnable|no\s+returns?|returns?\s+not\s+available)\b/i.test(text)) {
    return { returnable: false };
  }

  const returnWindow =
    text.match(/(\d{1,3})\s*(?:days?|day)\s+(?:returnable|replacement|returns?|replacement\/return)/i) ||
    text.match(/(?:returnable|replacement|returns?|replacement\/return)\s+(?:within|in|for)?\s*(\d{1,3})\s*(?:days?|day)/i) ||
    text.match(/(\d{1,3})\s*(?:days?|day)\s+(?:free\s+)?(?:returns?|replacement)/i);

  if (returnWindow?.[1]) {
    const days = Number(returnWindow[1]);
    if (Number.isFinite(days) && days > 0) return { returnable: true, returnDays: Math.round(days) };
  }

  if (lower.includes('returnable') || lower.includes('replacement') || lower.includes('return window')) {
    return { returnable: true };
  }

  return { returnable: false };
}

function platformFromHost(hostname: string): string {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  if (host.includes('amazon')) return 'Amazon';
  if (host.includes('flipkart')) return 'Flipkart';
  if (host.includes('myntra')) return 'Myntra';
  if (host.includes('technosport')) return 'Technosport';
  if (host.includes('ajio')) return 'Ajio';
  if (host.includes('meesho')) return 'Meesho';
  return host.split('.')[0] || 'Online Store';
}

function extractMatch(html: string, pattern: RegExp): string {
  const match = html.match(pattern);
  return match?.[1] ? cleanText(match[1]) : '';
}

function titleFromUrl(url: URL): string {
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  const amazonDpIndex = segments.findIndex((segment) => segment.toLowerCase() === 'dp');
  if (amazonDpIndex > 0) {
    const productSlug = segments[amazonDpIndex - 1]
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (productSlug) return cleanText(productSlug);
  }

  const segment = segments.at(-1);
  if (!segment) return 'Product';
  const clean = segment.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').trim();
  return clean ? cleanText(clean) : 'Product';
}

function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const out: Array<Record<string, unknown>> = [];

  for (const script of scripts) {
    const jsonText = script.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
        }
      } else if (parsed && typeof parsed === 'object') {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  return out;
}

function findProductNode(nodes: Array<Record<string, unknown>>): Record<string, unknown> | null {
  const stack = [...nodes];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const typeValue = current['@type'];
    if (typeof typeValue === 'string' && typeValue.toLowerCase() === 'product') return current;
    if (Array.isArray(typeValue) && typeValue.some((value) => String(value).toLowerCase() === 'product')) return current;

    for (const value of Object.values(current)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') stack.push(item as Record<string, unknown>);
        }
      } else {
        stack.push(value as Record<string, unknown>);
      }
    }
  }

  return null;
}

export async function extractProductDetails(url: string): Promise<ProductDetails> {
  const parsedUrl = new URL(url);
  const sourcePlatform = platformFromHost(parsedUrl.hostname);
  let title = titleFromUrl(parsedUrl);
  let price = 0;
  let currency = 'INR';
  let imageUrl = '';
  let returnable = false;
  let returnDays: number | undefined;

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'accept-language': 'en-IN,en;q=0.9',
      },
      cache: 'no-store',
    });

    if (response.ok) {
      const html = await response.text();
      const metas = getMetas(html);
      const returnPolicy = parseReturnPolicy(html);
      returnable = returnPolicy.returnable;
      returnDays = returnPolicy.returnDays;

      const ogTitle = getMetaValue(metas, ['og:title', 'twitter:title']);
      if (ogTitle) title = cleanText(ogTitle);
      imageUrl = getMetaValue(metas, ['og:image', 'twitter:image', 'image']);

      if (!ogTitle) {
        const domTitle =
          extractMatch(html, /id=["']productTitle["'][^>]*>\s*([\s\S]*?)\s*<\/span>/i) ||
          extractMatch(html, /<title>([^<]+)<\/title>/i);
        if (domTitle) {
          title = domTitle.replace(/\s*:\s*Amazon\.[^|<]+$/i, '').trim();
        }
      }

      const directPrice = getMetaValue(metas, ['product:price:amount', 'og:price:amount', 'twitter:data1', 'price']);
      const directCurrency = getMetaValue(metas, ['product:price:currency', 'og:price:currency', 'currency']);

      if (directPrice) price = parsePrice(directPrice);
      if (directCurrency) currency = directCurrency.toUpperCase();

      if (price <= 0) {
        const jsonLdNodes = extractJsonLd(html);
        const productNode = findProductNode(jsonLdNodes);
        if (productNode) {
          const productName = typeof productNode.name === 'string' ? productNode.name : '';
          if (productName) title = cleanText(productName);

          const offers = productNode.offers as unknown;
          if (offers && typeof offers === 'object') {
            const offer = Array.isArray(offers) ? offers[0] : offers;
            if (offer && typeof offer === 'object') {
              const offerObj = offer as Record<string, unknown>;
              const offerPrice = String(offerObj.price ?? '').trim();
              const offerCurrency = String(offerObj.priceCurrency ?? '').trim();
              if (offerPrice) price = parsePrice(offerPrice);
              if (offerCurrency) currency = offerCurrency.toUpperCase();
            }
          }
        }
      }

      if (price <= 0) {
        const structuredPrice =
          extractMatch(html, /"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
          extractMatch(html, /class=["'][^"']*a-price-whole[^"']*["'][^>]*>\s*([^<]+)/i) ||
          extractMatch(html, /class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*\u20B9\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
        if (structuredPrice) {
          price = parsePrice(structuredPrice);
          currency = 'INR';
        }
      }

      if (price <= 0) {
        const pageText = html.slice(0, 200000);
        const rupeeMatch = pageText.match(/(?:\u20B9|Rs\.?|INR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
        if (rupeeMatch?.[1]) {
          const parsed = parsePrice(rupeeMatch[1]);
          if (parsed >= 10) {
            price = parsed;
            currency = 'INR';
          }
        }
      }
    }
  } catch {
    // Keep best-effort fallback from URL.
  }

  return {
    title: title || 'Product',
    price,
    currency: currency || 'INR',
    sourcePlatform,
    imageUrl,
    returnable,
    returnDays,
  };
}
