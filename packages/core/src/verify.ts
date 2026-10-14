import { extractFromSnapshot, pickOffer, type ExtractedOffer, type ExtractedProduct, type PageSnapshot } from './extract';
import { classifyMatch, describeMatch, matchRank, normalizeGtin, type MatchResult } from './matching';
import type { MarketConfig } from './markets';
import type { CompetitorOffer, ProductIdentity } from './schemas';
import { assessMarketFit } from './search-results';
import { alphanumericKey, normalizeText, truncate } from './text';

export type FetchFailureKind = 'NO_PERMISSION' | 'BLOCKED' | 'NOT_FOUND' | 'TIMEOUT' | 'HTTP_ERROR' | 'NOT_HTML' | 'TOO_LARGE' | 'UNSAFE_URL' | 'NETWORK' | 'ABORTED';

export class PageFetchError extends Error {
  constructor(
    readonly kind: FetchFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PageFetchError';
  }
}

export const FETCH_FAILURE_MESSAGES: Record<FetchFailureKind, string> = {
  NO_PERMISSION: 'Sin permiso para leer este sitio',
  BLOCKED: 'El sitio bloqueó la lectura automática',
  NOT_FOUND: 'La página ya no existe',
  TIMEOUT: 'Tiempo de espera agotado',
  HTTP_ERROR: 'El sitio respondió con un error',
  NOT_HTML: 'La URL no es una página HTML',
  TOO_LARGE: 'La página es demasiado grande',
  UNSAFE_URL: 'URL no permitida por seguridad',
  NETWORK: 'Error de red',
  ABORTED: 'Cancelado',
};

/** Interfaz de lectura de páginas: la implementa la extensión (fetch con permisos) o el modo demo. */
export interface OfferPageFetcher {
  fetchSnapshot(url: string, signal?: AbortSignal): Promise<PageSnapshot>;
}

function bestProduct(identity: ProductIdentity, products: ExtractedProduct[]): { product?: ExtractedProduct; match?: MatchResult } {
  let best: { product?: ExtractedProduct; match?: MatchResult } = {};
  for (const product of products) {
    if (!product.name) continue;
    const match = classifyMatch(identity, {
      title: [product.name, product.model].filter(Boolean).join(' '),
      brand: product.brand,
      gtin: product.gtin,
      sku: product.sku,
      mpn: product.mpn,
    });
    const priced = product.offers.some((o) => o.price !== undefined);
    if (
      !best.match ||
      matchRank(match.matchType) < matchRank(best.match.matchType) ||
      (matchRank(match.matchType) === matchRank(best.match.matchType) && priced && !(best.product?.offers.length ?? 0))
    ) {
      best = { product, match };
    }
  }
  return best;
}

/**
 * Aplica a una oferta lo encontrado en su página: precio estructurado, moneda,
 * disponibilidad y reclasificación con datos más ricos. Si la página no publica
 * precio estructurado, se conserva el dato del buscador como no verificado.
 */
export function applySnapshotToOffer(
  offer: CompetitorOffer,
  snapshot: PageSnapshot,
  identity: ProductIdentity,
  market: MarketConfig,
  retrievedAt: string,
): CompetitorOffer {
  const extraction = extractFromSnapshot(snapshot, market.currency);
  const { product, match } = bestProduct(identity, extraction.products);
  const resolved: ResolvedOffer = product ? resolveOffer(product, identity, market.currency) : { ambiguous: false };
  const extractedOffer = resolved.offer;

  if (!product || !match) {
    return {
      ...offer,
      verificationError: 'La página no publica datos estructurados de producto',
      evidence: { ...offer.evidence, note: 'Página leída sin ficha de producto estructurada' },
    };
  }

  const updated: CompetitorOffer = {
    ...offer,
    title: product.name ? truncate(product.name, 300) : offer.title,
    matchType: match.matchType,
    matchReason: describeMatch(match),
    matchScore: match.score,
    gtin: product.gtin ?? offer.gtin,
    verificationError: undefined,
  };

  if (resolved.ambiguous) {
    // Varias variantes con precios distintos y ninguna atada a la identidad: no se verifica.
    return {
      ...updated,
      verificationError: 'La ficha publica varios precios (variantes) y no se pudo determinar cuál corresponde',
      evidence: { ...offer.evidence, note: 'Ficha con varias variantes de precio; no entra en la estadística' },
    };
  }

  if (extractedOffer?.price !== undefined && extractedOffer.currency) {
    updated.price = { amount: extractedOffer.price, currency: extractedOffer.currency };
    updated.priceSource = extractedOffer.priceSource;
    updated.priceText = undefined;
    updated.availability = extractedOffer.availability;
    updated.evidence = {
      ...offer.evidence,
      url: offer.url,
      retrievedAt,
      method: offer.evidence.method === 'DEMO_FIXTURE' ? 'DEMO_FIXTURE' : 'PAGE',
      verification: 'PAGE_VERIFIED',
      extractedText: truncate(`${product.name ?? ''} — ${extractedOffer.price} ${extractedOffer.currency}${product.gtin ? ` — GTIN ${product.gtin}` : ''}`, 500),
      note:
        resolved.note ??
        `Precio leído de datos estructurados (${extractedOffer.priceSource === 'PAGE_JSON_LD' ? 'JSON-LD' : extractedOffer.priceSource === 'PAGE_MICRODATA' ? 'microdatos' : 'metadatos'})`,
    };
    const fit = assessMarketFit(offer.url, market, extractedOffer.currency, `${product.name ?? ''} ${offer.evidence.extractedText ?? ''}`);
    updated.marketFit = fit.fit;
    updated.localSignals = fit.signals;
  } else if (extractedOffer?.price !== undefined) {
    updated.verificationError = 'La página publica un precio sin moneda; no se usa en la comparación';
  } else {
    updated.verificationError = 'La página no publica un precio estructurado';
    updated.evidence = { ...offer.evidence, note: 'Ficha leída, precio no disponible en datos estructurados' };
  }
  return updated;
}

export const LOWEST_PRICE_NOTE = 'Precio más bajo publicado en la ficha (varios vendedores u oferta)';

export interface ResolvedOffer {
  offer?: ExtractedOffer;
  ambiguous: boolean;
  /** Nota de evidencia cuando el precio se eligió entre varias ofertas del mismo producto. */
  note?: string;
}

/**
 * Elige la oferta que corresponde a la identidad. Si la ficha publica varios
 * precios distintos (variantes 50 ml / 100 ml, un rango de AggregateOffer…),
 * solo se acepta una oferta atada a la identidad por GTIN, SKU o nombre, o
 * varias ofertas del mismo producto (`sameProductOffer`); si no, el resultado
 * es ambiguo y el precio NO se verifica.
 */
export function resolveOffer(product: ExtractedProduct, identity: ProductIdentity, currency: string): ResolvedOffer {
  const priced = product.offers.filter((o) => o.price !== undefined && o.price > 0);
  if (priced.length === 0) return { ambiguous: false };
  const inCurrency = priced.filter((o) => o.currency === currency);
  const pool = inCurrency.length ? inCurrency : priced;
  const single = (list: ExtractedOffer[]) => new Set(list.map((o) => o.price)).size === 1 && !list.some((o) => o.priceMax !== undefined && o.priceMax !== o.price);
  if (single(pool)) return { offer: pickOffer({ ...product, offers: pool }, currency), ambiguous: false };

  const idGtin = normalizeGtin(identity.gtin);
  const idSku = identity.sku ? alphanumericKey(identity.sku) : '';
  const byCode = pool.filter(
    (o) => (idGtin !== undefined && normalizeGtin(o.gtin) === idGtin) || (idSku.length >= 4 && o.sku !== undefined && alphanumericKey(o.sku) === idSku),
  );
  if (byCode.length && single(byCode)) return { offer: byCode[0], ambiguous: false };
  const byName = pool.filter((o) => o.name && classifyMatch(identity, { title: `${product.name ?? ''} ${o.name}`, brand: product.brand }).matchType === 'EXACT');
  if (byName.length && single(byName)) return { offer: byName[0], ambiguous: false };
  const lowest = sameProductOffer(product, inCurrency);
  if (lowest) return { offer: lowest, ambiguous: false, note: LOWEST_PRICE_NOTE };
  return { ambiguous: true };
}

/**
 * Varias ofertas del MISMO producto (no variantes) → precio actual más bajo.
 * Regla conservadora basada en fichas reales revisadas el 2026-10-14:
 * - Éxito publica una oferta por vendedor (seller distinto, misma URL, sin
 *   nombre ni SKU por oferta) en una ficha con SKU propio.
 * - Falabella publica dos ofertas idénticas (mismo SKU y vendedor) que solo
 *   difieren en el precio: el de oferta y el normal (tachado en la página).
 * Sin vendedor ni código por oferta, dos precios pueden ser 50 ml y 100 ml, así
 * que no se acepta; tampoco con señales de variante: nombre, SKU, GTIN o URL
 * distintos entre ofertas (ahí aparecen tallas y capacidades), condición no
 * nueva, nodo ProductGroup o tres o más precios de un mismo vendedor (p. ej.
 * un precio con tarjeta). Un AggregateOffer sin detalle solo se acepta si
 * resume varias ofertas (offerCount > 1) de un producto con GTIN válido.
 */
function sameProductOffer(product: ExtractedProduct, offers: ExtractedOffer[]): ExtractedOffer | undefined {
  if (product.variantGroup || offers.length === 0) return undefined;
  if (offers.some((o) => o.condition !== undefined && o.condition !== 'NEW')) return undefined;
  if (offers.some((o) => o.priceMax !== undefined || o.offerCount !== undefined)) {
    const [aggregate] = offers;
    return offers.length === 1 && aggregate && (aggregate.offerCount ?? 0) > 1 && normalizeGtin(product.gtin) ? aggregate : undefined;
  }
  const varies = (pick: (o: ExtractedOffer) => string | undefined) => new Set(offers.map((o) => pick(o) ?? '')).size > 1;
  if (
    offers.length < 2 ||
    varies((o) => o.name && normalizeText(o.name)) ||
    varies((o) => o.sku && alphanumericKey(o.sku)) ||
    varies((o) => normalizeGtin(o.gtin) ?? o.gtin) ||
    varies((o) => o.url?.trim())
  ) {
    return undefined;
  }
  const sellers = offers.map((o) => normalizeText(o.seller ?? ''));
  const multiSeller = Boolean(product.gtin || product.sku) && sellers.every(Boolean) && new Set(sellers).size === offers.length;
  const [first, second] = offers;
  const saleAndList =
    offers.length === 2 && Boolean(first?.sku || first?.gtin) && new Set(sellers).size === 1 && !varies((o) => o.availability);
  if (saleAndList && first && second) {
    const [sale, list] = (first.price ?? 0) <= (second.price ?? 0) ? [first, second] : [second, first];
    return { ...sale, listPrice: sale.listPrice ?? list.price };
  }
  if (!multiSeller) return undefined;
  // Nunca el precio de una oferta agotada si hay otra disponible (o sin dato de disponibilidad).
  const available = offers.filter((o) => o.availability !== 'OUT_OF_STOCK');
  return (available.length ? available : offers).reduce((best, o) => ((o.price ?? Infinity) < (best.price ?? Infinity) ? o : best));
}

export function failOffer(offer: CompetitorOffer, error: unknown): CompetitorOffer {
  const message =
    error instanceof PageFetchError
      ? `${FETCH_FAILURE_MESSAGES[error.kind]}${error.status ? ` (HTTP ${error.status})` : ''}`
      : 'No fue posible leer la página';
  return { ...offer, verificationError: message };
}
