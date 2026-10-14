import { parseStructuredPrice, pickSnippetPrice } from './money';
import type { Availability, PriceSource } from './schemas';
import { cleanExternalText, decodeHtmlEntities, stripTags } from './text';
import { parseHttpUrl } from './url';

/**
 * Instantánea mínima de una página de producto. Se construye a partir del DOM
 * de la pestaña activa (script inyectado) o del HTML descargado. Contiene solo
 * metadatos públicos de producto: nunca formularios, cookies ni datos de usuario.
 */
export interface PageSnapshot {
  url: string;
  title?: string;
  h1?: string;
  canonical?: string;
  lang?: string;
  jsonLd: string[];
  metas: Array<{ key: string; value: string }>;
  /** Textos visibles con apariencia de precio (solo pestaña activa; heurístico). */
  priceTexts?: string[];
}

export interface ExtractedOffer {
  /** Nombre, SKU o GTIN propios de la oferta (variantes), si la página los publica. */
  name?: string;
  sku?: string;
  gtin?: string;
  price?: number;
  priceMax?: number;
  currency?: string;
  availability: Availability;
  seller?: string;
  url?: string;
  priceSource: PriceSource;
}

export interface ExtractedProduct {
  name?: string;
  brand?: string;
  model?: string;
  sku?: string;
  mpn?: string;
  gtin?: string;
  image?: string;
  description?: string;
  category?: string;
  offers: ExtractedOffer[];
  source: 'JSON_LD' | 'MICRODATA' | 'META' | 'TITLE';
}

export interface PageExtraction {
  /** Productos encontrados (JSON-LD puede listar variantes). */
  products: ExtractedProduct[];
  /** Mejor producto principal. */
  primary?: ExtractedProduct;
  /** Metadatos generales (Open Graph / título). */
  fallbackName?: string;
  fallbackImage?: string;
  /** Precio visible en el DOM (heurístico, solo como referencia). */
  visiblePrice?: { amount: number; currency: string; raw: string };
}

const MAX_HTML = 2_000_000;
const MAX_JSON_LD_BLOCKS = 25;
const MAX_JSON_LD_LENGTH = 400_000;

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = tag.match(re);
  const value = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  return value === undefined ? undefined : decodeHtmlEntities(value);
}

/** Construye una instantánea desde HTML crudo (sin DOM; funciona en workers y Node). */
export function snapshotFromHtml(htmlInput: string, url: string): PageSnapshot {
  const html = htmlInput.length > MAX_HTML ? htmlInput.slice(0, MAX_HTML) : htmlInput;
  const jsonLd: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (jsonLd.length >= MAX_JSON_LD_BLOCKS) break;
    const body = (m[1] ?? '').trim();
    if (body && body.length <= MAX_JSON_LD_LENGTH) jsonLd.push(body);
  }
  const metas: Array<{ key: string; value: string }> = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const itemprop = attr(tag, 'itemprop');
    const key = attr(tag, 'property') ?? attr(tag, 'name') ?? (itemprop ? `itemprop:${itemprop}` : undefined);
    const value = attr(tag, 'content');
    if (key && value !== undefined && isRelevantMeta(key)) metas.push({ key: key.toLowerCase(), value: value.slice(0, 1000) });
    if (metas.length > 200) break;
  }
  // Microdatos en elementos no-meta (p. ej. <span itemprop="price" content="79900">).
  for (const m of html.matchAll(/<(?:span|div|p|data|link|strong)\b[^>]*itemprop\s*=\s*["']?(priceCurrency|price|availability|gtin13|gtin|sku|brand|name)\b["']?[^>]*>/gi)) {
    const tag = m[0];
    const key = (m[1] ?? '').toLowerCase();
    const value = attr(tag, 'content') ?? attr(tag, 'href') ?? attr(tag, 'value');
    if (value) metas.push({ key: `itemprop:${key}`, value: value.slice(0, 300) });
  }
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const canonicalTag = html.match(/<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i)?.[0];
  const lang = html.match(/<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]+)/i)?.[1];
  return {
    url,
    title: title ? cleanExternalText(title, 300) : undefined,
    h1: h1 ? cleanExternalText(h1, 300) : undefined,
    canonical: canonicalTag ? attr(canonicalTag, 'href') : undefined,
    lang,
    jsonLd,
    metas,
  };
}

const RELEVANT_META = /^(og:|product:|twitter:title|twitter:image|description$|itemprop:|price|pricecurrency|availability|gtin|sku|brand|name$|image$)/i;
function isRelevantMeta(key: string): boolean {
  return RELEVANT_META.test(key);
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function parseJsonLdBlock(raw: string): Json | undefined {
  const cleaned = raw
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
    .replace(/\/\/\s*\]\]>\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as Json;
  } catch {
    // Algunos sitios incluyen saltos de línea literales dentro de strings.
    try {
      return JSON.parse(cleaned.replace(/[\r\n\t]+/g, ' ')) as Json;
    } catch {
      return undefined;
    }
  }
}

function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function types(node: { [key: string]: Json }): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^https?:\/\/schema\.org\//i, ''));
}

function firstString(value: Json | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
  }
  if (isObject(value)) return firstString(value['name'] ?? value['url'] ?? value['@id'] ?? value['contentUrl']);
  return undefined;
}

function imageOf(value: Json | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = imageOf(v);
      if (s) return s;
    }
  }
  if (isObject(value)) return firstString(value['url'] ?? value['contentUrl'] ?? value['@id']);
  return undefined;
}

export function mapAvailability(value: string | undefined): Availability {
  if (!value) return 'UNKNOWN';
  const v = value.toLowerCase();
  if (/(instock|in_stock|in stock|onlineonly|limitedavailability|instoreonly|presale|preorder)/.test(v)) return 'IN_STOCK';
  if (/(outofstock|out_of_stock|out of stock|soldout|discontinued|backorder)/.test(v)) return 'OUT_OF_STOCK';
  return 'UNKNOWN';
}

/** Solo códigos ISO 4217 ("COP"); un "$" no identifica la moneda. */
export function isoCurrency(value: string | undefined): string | undefined {
  const upper = value?.trim().toUpperCase();
  return upper && /^[A-Z]{3}$/.test(upper) ? upper : undefined;
}

function offersFrom(value: Json | undefined, depth = 0): ExtractedOffer[] {
  if (depth > 4 || value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((v) => offersFrom(v, depth + 1)).slice(0, 50);
  if (!isObject(value)) return [];
  const t = types(value);
  let currency = firstString(value['priceCurrency']);
  let priceRaw: Json | undefined = value['price'];
  const spec = value['priceSpecification'];
  if (priceRaw === undefined && spec !== undefined) {
    const specs = Array.isArray(spec) ? spec : [spec];
    for (const s of specs) {
      if (isObject(s) && s['price'] !== undefined) {
        priceRaw = s['price'];
        currency = currency ?? firstString(s['priceCurrency']);
        break;
      }
    }
  }
  const result: ExtractedOffer[] = [];
  const cur = isoCurrency(currency);
  if (t.includes('AggregateOffer') || value['lowPrice'] !== undefined) {
    const low = parseStructuredPrice(value['lowPrice'] ?? priceRaw ?? null, cur);
    const high = parseStructuredPrice(value['highPrice'] ?? null, cur);
    if (low !== null) {
      result.push({
        price: low,
        priceMax: high !== null && high > low ? high : undefined,
        currency: cur,
        availability: mapAvailability(firstString(value['availability'])),
        priceSource: 'PAGE_JSON_LD',
      });
    }
    const nested = offersFrom(value['offers'], depth + 1);
    return [...result, ...nested];
  }
  const price = parseStructuredPrice(priceRaw ?? null, cur);
  if (price !== null) {
    result.push({
      name: cleanExternalText(firstString(value['name']), 200) || undefined,
      sku: cleanExternalText(firstString(value['sku']), 120) || undefined,
      gtin: (firstString(value['gtin13']) ?? firstString(value['gtin']) ?? firstString(value['gtin12']))?.replace(/\D/g, '') || undefined,
      price,
      currency: cur,
      availability: mapAvailability(firstString(value['availability'])),
      seller: firstString(value['seller']),
      url: firstString(value['url']),
      priceSource: 'PAGE_JSON_LD',
    });
  }
  return result;
}

function productFromNode(node: { [key: string]: Json }): ExtractedProduct {
  const gtin =
    firstString(node['gtin13']) ?? firstString(node['gtin']) ?? firstString(node['gtin12']) ?? firstString(node['gtin14']) ?? firstString(node['gtin8']);
  const offers = offersFrom(node['offers']);
  return {
    name: cleanExternalText(firstString(node['name']), 300) || undefined,
    brand: cleanExternalText(firstString(node['brand']) ?? firstString(node['manufacturer']), 120) || undefined,
    model: cleanExternalText(firstString(node['model']), 120) || undefined,
    sku: cleanExternalText(firstString(node['sku']), 120) || undefined,
    mpn: cleanExternalText(firstString(node['mpn']), 120) || undefined,
    gtin: gtin?.replace(/\D/g, '') || undefined,
    image: imageOf(node['image']),
    description: cleanExternalText(firstString(node['description']), 500) || undefined,
    category: cleanExternalText(firstString(node['category']), 200) || undefined,
    offers,
    source: 'JSON_LD',
  };
}

/** Recorre JSON-LD (incluido @graph y nodos anidados) y devuelve los productos. */
export function productsFromJsonLd(blocks: string[]): ExtractedProduct[] {
  const products: ExtractedProduct[] = [];
  let visited = 0;
  const walk = (value: Json | undefined, depth: number) => {
    if (depth > 7 || visited > 2000 || value === undefined || value === null) return;
    visited += 1;
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    if (!isObject(value)) return;
    const t = types(value);
    if (t.some((x) => x === 'Product' || x === 'IndividualProduct' || x === 'ProductModel' || x === 'Vehicle')) {
      products.push(productFromNode(value));
    }
    if (t.includes('ProductGroup')) {
      const group = productFromNode(value);
      const variants = value['hasVariant'];
      const variantList = Array.isArray(variants) ? variants : variants ? [variants] : [];
      const variantProducts = variantList.filter(isObject).map((v) => {
        const p = productFromNode(v);
        return { ...p, brand: p.brand ?? group.brand, image: p.image ?? group.image };
      });
      if (group.offers.length || variantProducts.length === 0) products.push(group);
      products.push(...variantProducts);
      return;
    }
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'about']) {
      if (key in value) walk(value[key], depth + 1);
    }
  };
  for (const block of blocks.slice(0, MAX_JSON_LD_BLOCKS)) walk(parseJsonLdBlock(block), 0);
  return products;
}

function metaValue(snapshot: PageSnapshot, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const found = snapshot.metas.find((m) => m.key === key.toLowerCase());
    if (found && found.value.trim()) return found.value.trim();
  }
  return undefined;
}

function productFromMeta(snapshot: PageSnapshot): ExtractedProduct | undefined {
  const amount = metaValue(snapshot, 'product:price:amount', 'og:price:amount', 'itemprop:price', 'price');
  const currency = isoCurrency(metaValue(snapshot, 'product:price:currency', 'og:price:currency', 'itemprop:pricecurrency', 'pricecurrency'));
  const fromItemprop = Boolean(metaValue(snapshot, 'itemprop:price')) && !metaValue(snapshot, 'product:price:amount', 'og:price:amount');
  const price = parseStructuredPrice(amount ?? null, currency);
  const name = metaValue(snapshot, 'og:title', 'twitter:title', 'itemprop:name');
  if (price === null && !name) return undefined;
  const offers: ExtractedOffer[] =
    price !== null
      ? [
          {
            price,
            currency,
            availability: mapAvailability(metaValue(snapshot, 'product:availability', 'og:availability', 'itemprop:availability')),
            priceSource: fromItemprop ? 'PAGE_MICRODATA' : 'PAGE_META',
          },
        ]
      : [];
  return {
    name: name ? cleanExternalText(name, 300) : undefined,
    brand: cleanExternalText(metaValue(snapshot, 'product:brand', 'og:brand', 'itemprop:brand'), 120) || undefined,
    sku: cleanExternalText(metaValue(snapshot, 'product:retailer_item_id', 'itemprop:sku'), 120) || undefined,
    gtin: metaValue(snapshot, 'product:gtin', 'itemprop:gtin13', 'itemprop:gtin')?.replace(/\D/g, '') || undefined,
    image: metaValue(snapshot, 'og:image', 'og:image:secure_url', 'twitter:image'),
    description: cleanExternalText(metaValue(snapshot, 'og:description', 'description'), 500) || undefined,
    offers,
    source: fromItemprop ? 'MICRODATA' : 'META',
  };
}

function absolutize(maybeUrl: string | undefined, base: string): string | undefined {
  if (!maybeUrl) return undefined;
  try {
    const u = new URL(maybeUrl, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Extrae productos y ofertas de una instantánea, priorizando JSON-LD > microdatos/meta > título. */
export function extractFromSnapshot(snapshot: PageSnapshot, marketCurrency: string): PageExtraction {
  const fromJsonLd = productsFromJsonLd(snapshot.jsonLd);
  const fromMeta = productFromMeta(snapshot);
  const products = [...fromJsonLd];
  if (fromMeta && (fromJsonLd.length === 0 || fromJsonLd.every((p) => p.offers.length === 0))) {
    if (fromJsonLd.length && fromMeta.offers.length) {
      // Completar el producto JSON-LD sin precio con el precio de los metadatos.
      const first = fromJsonLd[0];
      if (first) first.offers = fromMeta.offers;
    } else if (!fromJsonLd.length) {
      products.push(fromMeta);
    }
  }
  for (const p of products) p.image = absolutize(p.image, snapshot.url);

  const primary = products.find((p) => p.name && p.offers.length) ?? products.find((p) => p.name) ?? products[0];
  const fallbackName = cleanExternalText(snapshot.h1 || metaValue(snapshot, 'og:title') || snapshot.title, 300) || undefined;
  const fallbackImage = absolutize(metaValue(snapshot, 'og:image', 'og:image:secure_url', 'twitter:image'), snapshot.url);

  let visiblePrice: PageExtraction['visiblePrice'];
  for (const text of snapshot.priceTexts ?? []) {
    const found = pickSnippetPrice(stripTags(text), { marketCurrency });
    if (found) {
      visiblePrice = { amount: found.price.amount, currency: found.price.currency, raw: found.raw };
      break;
    }
  }
  return { products, primary, fallbackName, fallbackImage, visiblePrice };
}

/** Elige la oferta más útil: misma moneda del mercado y disponible primero. */
export function pickOffer(product: ExtractedProduct | undefined, marketCurrency: string): ExtractedOffer | undefined {
  if (!product) return undefined;
  const priced = product.offers.filter((o) => o.price !== undefined && o.price > 0);
  const ranked = [...priced].sort((a, b) => {
    const score = (o: ExtractedOffer) => (o.currency === marketCurrency ? 0 : o.currency ? 2 : 1) + (o.availability === 'OUT_OF_STOCK' ? 0.5 : 0);
    return score(a) - score(b);
  });
  return ranked[0];
}

/** Valida el host de la página analizada para mostrarlo como fuente. */
export function publisherFromUrl(url: string): string {
  return parseHttpUrl(url)?.hostname.replace(/^www\./, '') ?? 'desconocido';
}
