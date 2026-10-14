import { emptyFinancialInputs } from './finance';
import { extractFromSnapshot, type PageSnapshot } from './extract';
import { getMarketConfig, type MarketConfig } from './markets';
import { classifyMatch, describeMatch } from './matching';
import { createReport, recomputeReport } from './report';
import type { CompetitorOffer, Market, ProductIdentity, ResearchReport } from './schemas';
import { assessMarketFit, classifyResultUrl, sellerName } from './search-results';
import { cleanExternalText, normalizeText, stableId, truncate } from './text';
import { canonicalizeUrl, cleanUrl, getHostname, registrableDomain } from './url';
import { applySnapshotToOffer } from './verify';

/**
 * Investigación asistida (sin claves): no hay buscador automático. El usuario
 * abre la búsqueda pública de cada tienda en una pestaña nueva, elige una
 * ficha y la agrega. La extensión nunca descarga las páginas de resultados;
 * solo lee la ficha que el usuario agrega, tras su clic.
 */

export const ASSISTED_SEARCH_PROVIDER = 'Investigación asistida (fichas agregadas por ti)';

export interface StoreSearchLink {
  store: string;
  url: string;
  host: string;
  /** Patrón de permiso opcional para leer las fichas de esa tienda. */
  origin: string;
  /** Marketplace internacional (no es comercio local). */
  international?: boolean;
}

interface StoreTemplate {
  store: string;
  origin: string;
  international?: boolean;
  build: (query: { encoded: string; plus: string; slug: string }) => string;
}

const ML = (tld: string): StoreTemplate['build'] => (q) => `https://listado.mercadolibre.${tld}/${q.slug}`;

/**
 * Búsquedas públicas de cada tienda. Las de Colombia se comprobaron el
 * 2026-10-14 (una solicitud por tienda, estado 200 tras redirecciones).
 */
const STORE_TEMPLATES: Record<Market, StoreTemplate[]> = {
  CO: [
    { store: 'Mercado Libre Colombia', origin: 'https://*.mercadolibre.com.co/*', build: ML('com.co') },
    { store: 'Éxito', origin: 'https://www.exito.com/*', build: (q) => `https://www.exito.com/s?q=${q.encoded}` },
    { store: 'Falabella Colombia', origin: 'https://www.falabella.com.co/*', build: (q) => `https://www.falabella.com.co/falabella-co/search?Ntt=${q.plus}` },
    { store: 'Alkosto', origin: 'https://www.alkosto.com/*', build: (q) => `https://www.alkosto.com/search?text=${q.plus}` },
    { store: 'Ktronix', origin: 'https://www.ktronix.com/*', build: (q) => `https://www.ktronix.com/search?text=${q.plus}` },
    { store: 'Homecenter', origin: 'https://www.homecenter.com.co/*', build: (q) => `https://www.homecenter.com.co/homecenter-co/search?Ntt=${q.plus}` },
    { store: 'Olímpica', origin: 'https://www.olimpica.com/*', build: (q) => `https://www.olimpica.com/${q.encoded}?_q=${q.encoded}&map=ft` },
    { store: 'Amazon (internacional)', origin: 'https://www.amazon.com/*', international: true, build: (q) => `https://www.amazon.com/s?k=${q.plus}` },
  ],
  // México, Perú y Chile: patrones NO verificados con una solicitud real; revisar antes de depender de ellos.
  MX: [
    { store: 'Mercado Libre México', origin: 'https://*.mercadolibre.com.mx/*', build: ML('com.mx') },
    { store: 'Liverpool', origin: 'https://www.liverpool.com.mx/*', build: (q) => `https://www.liverpool.com.mx/tienda?s=${q.plus}` },
    { store: 'Walmart México', origin: 'https://www.walmart.com.mx/*', build: (q) => `https://www.walmart.com.mx/search?q=${q.plus}` },
    { store: 'Amazon México', origin: 'https://www.amazon.com.mx/*', build: (q) => `https://www.amazon.com.mx/s?k=${q.plus}` },
  ],
  PE: [
    { store: 'Mercado Libre Perú', origin: 'https://*.mercadolibre.com.pe/*', build: ML('com.pe') },
    { store: 'Falabella Perú', origin: 'https://www.falabella.com.pe/*', build: (q) => `https://www.falabella.com.pe/falabella-pe/search?Ntt=${q.plus}` },
    { store: 'Ripley Perú', origin: 'https://simple.ripley.com.pe/*', build: (q) => `https://simple.ripley.com.pe/search/${q.encoded}` },
  ],
  CL: [
    { store: 'Mercado Libre Chile', origin: 'https://*.mercadolibre.cl/*', build: ML('cl') },
    { store: 'Falabella Chile', origin: 'https://www.falabella.com/*', build: (q) => `https://www.falabella.com/falabella-cl/search?Ntt=${q.plus}` },
    { store: 'Paris', origin: 'https://www.paris.cl/*', build: (q) => `https://www.paris.cl/search/?q=${q.plus}` },
    { store: 'Ripley Chile', origin: 'https://simple.ripley.cl/*', build: (q) => `https://simple.ripley.cl/search/${q.encoded}` },
  ],
};

/** Texto de búsqueda para las tiendas: marca + modelo si existen; si no, el nombre. */
export function assistedQuery(identity: ProductIdentity): string {
  const brand = identity.brand?.trim() ?? '';
  const model = identity.model?.trim() ?? '';
  const text = brand && model ? (normalizeText(model).includes(normalizeText(brand)) ? model : `${brand} ${model}`) : identity.name;
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Enlaces a las búsquedas públicas de las tiendas del país (solo para abrir en una pestaña nueva). */
export function buildStoreSearchLinks(identity: ProductIdentity, market: MarketConfig): StoreSearchLink[] {
  const text = assistedQuery(identity);
  const query = {
    encoded: encodeURIComponent(text),
    plus: encodeURIComponent(text).replace(/%20/g, '+'),
    slug: normalizeText(text).replace(/\s+/g, '-') || 'producto',
  };
  return STORE_TEMPLATES[market.code].map((t) => {
    const url = t.build(query);
    return { store: t.store, url, host: getHostname(url), origin: t.origin, ...(t.international ? { international: true } : {}) };
  });
}

/** Búsqueda pública de Alibaba (la abre el usuario; sus precios son indicativos). */
export function buildAlibabaSearchUrl(identity: ProductIdentity): string {
  const brandModel = [identity.brand, identity.model].map((v) => v?.trim()).filter(Boolean).join(' ');
  const text = identity.englishName?.trim() || brandModel || identity.name.trim();
  return `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(text)}`;
}

export function isAssistedReport(report: ResearchReport): boolean {
  return report.mode === 'assisted';
}

export function assistedVerifyMessage(offers: CompetitorOffer[]): string {
  const verified = offers.filter((o) => o.evidence.verification === 'PAGE_VERIFIED').length;
  const added = offers.length === 1 ? '1 ficha agregada' : `${offers.length} fichas agregadas`;
  return `${added}, ${verified} con precio verificado`;
}

/** Crea el reporte de una investigación asistida, sin ofertas: el usuario las agrega después. */
export function createAssistedReport(product: ProductIdentity, country: Market, startedAt = new Date().toISOString()): ResearchReport {
  const report = createReport({
    product,
    country,
    isDemo: false,
    searchProvider: ASSISTED_SEARCH_PROVIDER,
    startedAt,
    financials: emptyFinancialInputs(getMarketConfig(country).currency),
  });
  return recomputeReport({
    ...report,
    mode: 'assisted',
    status: 'PARTIAL',
    finishedAt: startedAt,
    modules: {
      identify: { status: 'OK', message: 'Identidad confirmada por el usuario' },
      search: { status: 'SKIPPED', message: 'Búsqueda automática no configurada: agrega fichas desde las tiendas' },
      verify: { status: 'OK', message: assistedVerifyMessage([]) },
      suppliers: { status: 'SKIPPED', message: 'Requiere buscador web: usa el enlace a Alibaba' },
      ads: { status: 'OK', message: 'Enlaces a bibliotecas oficiales listos; cantidad de anuncios no verificable' },
      analysis: { status: 'OK' },
    },
    notes: [
      'Investigación asistida: las ofertas son solo las fichas que agregaste tú (una muestra), no todas las tiendas del país. Cada precio se lee de la ficha al agregarla.',
    ],
  });
}

const NOT_PRODUCT = 'Esta página no parece una ficha de producto (no publica datos estructurados).';

/**
 * Convierte la ficha que el usuario agregó en una oferta. El precio solo queda
 * verificado (PAGE_VERIFIED) con datos estructurados y moneda ISO sin
 * ambigüedad, con la misma regla de `applySnapshotToOffer`. Nunca inventa precios.
 */
export function offerFromSnapshot(
  snapshot: PageSnapshot,
  identity: ProductIdentity,
  market: MarketConfig,
  retrievedAt: string,
): { offer?: CompetitorOffer; error?: string } {
  const url = cleanUrl(snapshot.url);
  const key = canonicalizeUrl(snapshot.url);
  if (!url || !key) return { error: 'La pestaña no tiene una dirección web válida (http o https).' };
  if (registrableDomain(url) === 'alibaba.com') {
    return { error: 'Alibaba es un proveedor, no un competidor: usa la sección «Referencias de Alibaba» para sus precios indicativos.' };
  }
  const { kind } = classifyResultUrl(url);
  if (kind === 'UNSAFE') return { error: 'Esta dirección no se puede usar como fuente.' };
  if (kind === 'LISTING_PAGE') return { error: 'Esta página es un listado o una búsqueda, no una ficha: abre la ficha de un producto y vuelve a intentarlo.' };

  // Fichas solo con microdatos y sin og:title (p. ej. Alkosto o Ktronix): el título visible (h1) nombra el
  // producto; `itemprop:name` suele ser el de la marca. El precio sigue exigiendo datos estructurados.
  const hasTitleMeta = snapshot.metas.some((m) => m.key === 'og:title' || m.key === 'twitter:title');
  const page: PageSnapshot = !hasTitleMeta && snapshot.h1 ? { ...snapshot, metas: [{ key: 'og:title', value: snapshot.h1 }, ...snapshot.metas] } : snapshot;

  const extraction = extractFromSnapshot(page, market.currency);
  const ogType = page.metas.find((m) => m.key === 'og:type')?.value ?? '';
  const productSignal =
    extraction.products.some((p) => p.name && (p.source === 'JSON_LD' || p.source === 'MICRODATA' || p.offers.length > 0)) || /product/i.test(ogType);
  if (!productSignal) return { error: NOT_PRODUCT };

  const title = cleanExternalText(extraction.primary?.name ?? extraction.fallbackName ?? snapshot.title ?? '', 300) || url;
  const match = classifyMatch(identity, { title, brand: extraction.primary?.brand, gtin: extraction.primary?.gtin });
  const fit = assessMarketFit(url, market, undefined, title);
  const base: CompetitorOffer = {
    id: `o_${stableId(key)}`,
    seller: sellerName(url, market),
    domain: registrableDomain(url),
    title,
    url,
    matchType: match.matchType,
    matchReason: describeMatch(match),
    matchScore: match.score,
    availability: 'UNKNOWN',
    marketFit: fit.fit,
    localSignals: fit.signals,
    evidence: {
      url,
      publisher: truncate(getHostname(url), 200),
      retrievedAt,
      method: 'PAGE',
      verification: 'UNAVAILABLE',
      note: 'Ficha agregada por ti desde una pestaña abierta',
    },
  };
  return { offer: applySnapshotToOffer(base, page, identity, market, retrievedAt) };
}

/** Agrega (o reemplaza, si ya estaba) una ficha y recalcula el reporte. */
export function addOfferToReport(report: ResearchReport, offer: CompetitorOffer): ResearchReport {
  const key = canonicalizeUrl(offer.url);
  const index = report.offers.findIndex((o) => canonicalizeUrl(o.url) === key);
  const offers = [...report.offers];
  if (index >= 0) {
    // Se conserva la decisión manual del usuario (exacta / excluida) sobre esa ficha.
    offers[index] = { ...offer, userOverride: report.offers[index]?.userOverride };
  } else {
    offers.push(offer);
  }
  return recomputeReport({
    ...report,
    offers,
    modules: { ...report.modules, verify: { status: 'OK', message: assistedVerifyMessage(offers) } },
  });
}
