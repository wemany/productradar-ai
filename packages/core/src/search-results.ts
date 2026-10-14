import { describeMatch, classifyMatch, matchRank } from './matching';
import { INTERNATIONAL_MARKETPLACES, type MarketConfig } from './markets';
import { parseStructuredPrice, pickSnippetPrice } from './money';
import type { CompetitorOffer, DiscardedResult, MarketFit, ProductIdentity, SourceEvidence } from './schemas';
import { cleanExternalText, normalizeText, stableId, truncate } from './text';
import { canonicalizeUrl, checkPublicUrl, cleanUrl, getHostname, parseHttpUrl, registrableDomain } from './url';

/** Resultado normalizado de cualquier proveedor de búsqueda web. */
export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  extraSnippets?: string[];
  publisherName?: string;
  age?: string;
  /** Datos de producto que el propio buscador extrajo de la página (si los ofrece). */
  structuredProduct?: {
    name?: string;
    price?: string;
    currency?: string;
    gtin?: string;
  };
}

export type ResultKind = 'PRODUCT_PAGE' | 'LISTING_PAGE' | 'CONTENT' | 'SOCIAL' | 'UNSAFE' | 'CANDIDATE';

const SOCIAL_DOMAINS = new Set([
  'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'pinterest.com', 'reddit.com', 'quora.com', 'wikipedia.org', 'linkedin.com', 'threads.net', 'whatsapp.com',
]);

const CONTENT_PATH = /\/(blog|blogs|noticias|news|revista|magazine|articulos-de-interes|review|reviews|resena|resenas|comparativa|guia|guias|tutorial|foro|forum|preguntas)(\/|$)/i;
const CONTENT_TITLE = /\b(review|resena|opiniones|comparativa|vs\.?|como elegir|mejores|top \d+|que es|guia|analisis|unboxing)\b/;
const LISTING_PATH = /(\/search|\/buscar|\/busqueda|\/s\?|[?&](q|k|query|search|text)=|\/catalogsearch\/|\/categoria\/|\/categorias\/|\/category\/|\/categories\/|\/listado|\/tag\/|\/marca\/)/i;

export function classifyResultUrl(url: string): { kind: ResultKind; reason?: string } {
  const safety = checkPublicUrl(url, { allowHttp: true });
  if (!safety.ok) return { kind: 'UNSAFE', reason: safety.reason };
  const parsed = parseHttpUrl(url);
  if (!parsed) return { kind: 'UNSAFE', reason: 'URL inválida' };
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const domain = registrableDomain(host);
  if (SOCIAL_DOMAINS.has(domain) || [...SOCIAL_DOMAINS].some((d) => host.endsWith(`.${d}`))) {
    return { kind: 'SOCIAL', reason: 'Red social, video o foro' };
  }
  const path = `${parsed.pathname}${parsed.search}`;
  // Mercado Libre: articulo.* y /p/ son fichas; listado.* son búsquedas.
  if (domain.startsWith('mercadolibre.') || domain.startsWith('mercadolivre.')) {
    if (host.startsWith('listado.')) return { kind: 'LISTING_PAGE', reason: 'Página de resultados de Mercado Libre' };
    if (host.startsWith('articulo.') || /\/p\/[A-Z]{3}\d+/i.test(parsed.pathname) || /\/[A-Z]{3}-?\d{6,}/i.test(parsed.pathname)) {
      return { kind: 'PRODUCT_PAGE' };
    }
  }
  if (/\/products?\/[^/]+/i.test(parsed.pathname) || /\/(p|dp|producto|productos|item|articulo)\/[^/]+/i.test(parsed.pathname) || /\/p$/i.test(parsed.pathname)) {
    return { kind: 'PRODUCT_PAGE' };
  }
  if (CONTENT_PATH.test(path)) return { kind: 'CONTENT', reason: 'Artículo o blog, no una oferta' };
  if (LISTING_PATH.test(path) || /\/collections\/[^/]+\/?$/i.test(parsed.pathname)) {
    return { kind: 'LISTING_PAGE', reason: 'Listado o búsqueda, sin oferta concreta' };
  }
  if (parsed.pathname === '/' || parsed.pathname === '') return { kind: 'LISTING_PAGE', reason: 'Página de inicio, sin oferta concreta' };
  return { kind: 'CANDIDATE' };
}

export function sellerName(url: string, market: MarketConfig, publisherName?: string): string {
  const domain = registrableDomain(url);
  const known = market.knownRetailers[domain] ?? INTERNATIONAL_MARKETPLACES[domain];
  if (known) return known;
  const profile = publisherName ? cleanExternalText(publisherName, 80) : '';
  if (profile && profile.length > 1 && !/^https?:/i.test(profile)) return profile;
  const host = getHostname(url);
  return host || domain || 'Tienda';
}

export function assessMarketFit(url: string, market: MarketConfig, priceCurrency: string | undefined, text: string): { fit: MarketFit; signals: string[] } {
  const signals: string[] = [];
  const host = getHostname(url);
  const domain = registrableDomain(url);
  let score = 0;
  if (market.knownRetailers[domain]) {
    signals.push(`Comercio conocido en ${market.name}`);
    score += 3;
  }
  const strongTld = market.localTlds[0];
  if (strongTld && host.endsWith(strongTld)) {
    signals.push(`Dominio ${strongTld}`);
    score += 2;
  } else if (market.localTlds.slice(1).some((t) => host.endsWith(t))) {
    signals.push(`Dominio ${market.localTlds.slice(1).find((t) => host.endsWith(t))} (también usado fuera del país)`);
    score += 1;
  }
  if (priceCurrency === market.currency) {
    signals.push(`Precio en ${market.currency}`);
    score += 2;
  }
  const normalized = normalizeText(text);
  if (normalized.includes(normalizeText(market.name))) {
    signals.push(`Menciona ${market.name}`);
    score += 1;
  }
  if (INTERNATIONAL_MARKETPLACES[domain]) {
    signals.push('Marketplace internacional');
    return { fit: 'FOREIGN', signals };
  }
  if (priceCurrency && priceCurrency !== market.currency && score < 3) return { fit: 'FOREIGN', signals: [...signals, `Precio en ${priceCurrency}`] };
  if (score >= 3) return { fit: 'LOCAL', signals };
  if (score >= 1) return { fit: 'LIKELY_LOCAL', signals };
  return { fit: 'UNKNOWN', signals };
}

export interface ConvertedResults {
  offers: CompetitorOffer[];
  discarded: DiscardedResult[];
}

/**
 * Convierte resultados de búsqueda en ofertas candidatas. El precio, si aparece,
 * queda marcado como SEARCH_SNIPPET_ONLY: todavía no se verificó en la página.
 */
export function resultsToOffers(
  items: Array<SearchResultItem & { query?: string }>,
  identity: ProductIdentity,
  market: MarketConfig,
  retrievedAt: string,
  method: SourceEvidence['method'] = 'SEARCH_API',
): ConvertedResults {
  const offers = new Map<string, CompetitorOffer>();
  const discarded: DiscardedResult[] = [];
  const seenDiscarded = new Set<string>();

  for (const item of items) {
    // `key` solo deduplica (sin www); `url` conserva el host original para abrir y leer la ficha.
    const key = canonicalizeUrl(item.url);
    const url = cleanUrl(item.url);
    const title = cleanExternalText(item.title, 300);
    if (!key || !url) continue;
    const { kind, reason } = classifyResultUrl(item.url);
    const domain = registrableDomain(url);
    if (domain.endsWith('alibaba.com')) continue; // Alibaba se trata como proveedor, no competidor local.
    if (kind === 'SOCIAL' || kind === 'CONTENT' || kind === 'LISTING_PAGE' || kind === 'UNSAFE') {
      if (!seenDiscarded.has(key)) {
        seenDiscarded.add(key);
        discarded.push({ url, title: title || url, reason: reason ?? 'Descartado' });
      }
      continue;
    }
    if (CONTENT_TITLE.test(normalizeText(title))) {
      if (!seenDiscarded.has(key)) {
        seenDiscarded.add(key);
        discarded.push({ url, title, reason: 'Contenido informativo, no una oferta' });
      }
      continue;
    }

    const snippetText = cleanExternalText([item.snippet, ...(item.extraSnippets ?? [])].join(' · '), 600);
    let price: CompetitorOffer['price'];
    let priceSource: CompetitorOffer['priceSource'];
    let priceText: string | undefined;
    const structured = item.structuredProduct;
    const structuredCurrency = structured?.currency?.toUpperCase();
    const structuredAmount = structured?.price ? parseStructuredPrice(structured.price, structuredCurrency) : null;
    if (structuredAmount !== null && structuredCurrency && /^[A-Z]{3}$/.test(structuredCurrency)) {
      price = { amount: structuredAmount, currency: structuredCurrency };
      priceSource = 'SEARCH_STRUCTURED';
      priceText = truncate(`${structured?.price} ${structuredCurrency}`, 100);
    } else {
      const snippetPrice = pickSnippetPrice(`${title} · ${snippetText}`, { marketCurrency: market.currency }, market.currency);
      if (snippetPrice) {
        price = snippetPrice.price;
        priceSource = 'SEARCH_SNIPPET';
        priceText = truncate(`${snippetPrice.raw}${snippetPrice.distinctPrices > 1 ? ` (el fragmento contiene ${snippetPrice.distinctPrices} precios)` : ''}`, 120);
      }
    }

    const match = classifyMatch(identity, { title, text: snippetText, gtin: structured?.gtin });
    const fit = assessMarketFit(url, market, price?.currency, `${title} ${snippetText}`);
    const evidence: SourceEvidence = {
      url,
      publisher: truncate(getHostname(url), 200),
      retrievedAt,
      method,
      verification: price ? 'SEARCH_SNIPPET_ONLY' : 'UNAVAILABLE',
      extractedText: snippetText ? truncate(snippetText, 500) : undefined,
      query: item.query ? truncate(item.query, 300) : undefined,
    };
    const offer: CompetitorOffer = {
      id: `o_${stableId(key)}`,
      seller: sellerName(url, market, item.publisherName),
      domain,
      title: title || url,
      url,
      matchType: match.matchType,
      matchReason: describeMatch(match),
      matchScore: match.score,
      price,
      priceSource,
      priceText,
      availability: 'UNKNOWN',
      gtin: structured?.gtin,
      marketFit: fit.fit,
      localSignals: fit.signals,
      evidence,
    };
    const existing = offers.get(key);
    if (!existing || (!existing.price && offer.price) || matchRank(offer.matchType) < matchRank(existing.matchType)) {
      offers.set(key, offer);
    }
  }

  const sorted = [...offers.values()].sort(
    (a, b) => matchRank(a.matchType) - matchRank(b.matchType) || Number(Boolean(b.price)) - Number(Boolean(a.price)) || b.matchScore - a.matchScore,
  );
  return { offers: sorted, discarded };
}
