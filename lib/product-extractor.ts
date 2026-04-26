export interface ProductDetails {
  title: string;
  price: number;
  currency: string;
  sourcePlatform: string;
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
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
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

function titleFromUrl(url: URL): string {
  const segment = url.pathname
    .split('/')
    .filter(Boolean)
    .pop();
  if (!segment) return 'Product';
  const clean = decodeURIComponent(segment).replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').trim();
  return clean ? cleanText(clean) : 'Product';
}

function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const out: Array<Record<string, unknown>> = [];

  for (const script of scripts) {
    const jsonText = script
      .replace(/<script[^>]*>/i, '')
      .replace(/<\/script>/i, '')
      .trim();
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
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
    const t = current['@type'];
    if (typeof t === 'string' && t.toLowerCase() === 'product') return current;
    if (Array.isArray(t) && t.some((v) => String(v).toLowerCase() === 'product')) return current;

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object') stack.push(item as Record<string, unknown>);
          }
        } else {
          stack.push(value as Record<string, unknown>);
        }
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

      const ogTitle = getMetaValue(metas, ['og:title', 'twitter:title']);
      if (ogTitle) title = cleanText(ogTitle);

      const directPrice =
        getMetaValue(metas, ['product:price:amount', 'og:price:amount', 'twitter:data1', 'price']) ||
        '';
      const directCurrency =
        getMetaValue(metas, ['product:price:currency', 'og:price:currency', 'currency']) || '';

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
        const pageText = html.slice(0, 200000);
        const rupeeMatch = pageText.match(/(?:₹|Rs\.?|INR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
        if (rupeeMatch?.[1]) {
          price = parsePrice(rupeeMatch[1]);
          currency = 'INR';
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
  };
}
