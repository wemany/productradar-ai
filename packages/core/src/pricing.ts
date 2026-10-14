import type { CompetitorOffer, MatchType } from './schemas';
import { registrableDomain } from './url';

/** Tipo de coincidencia efectivo tras las correcciones manuales del usuario. */
export function effectiveMatchType(offer: CompetitorOffer): MatchType {
  if (offer.userOverride === 'EXACT') return 'EXACT';
  return offer.matchType;
}

export function isExcluded(offer: CompetitorOffer): boolean {
  return offer.userOverride === 'EXCLUDED';
}

export type ExclusionReason =
  | 'EXCLUDED_BY_USER'
  | 'NOT_EXACT'
  | 'NOT_PAGE_VERIFIED'
  | 'NO_PRICE'
  | 'OTHER_CURRENCY';

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  EXCLUDED_BY_USER: 'Excluidas por ti',
  NOT_EXACT: 'Variantes o productos parecidos',
  NOT_PAGE_VERIFIED: 'Precio sin verificar en la página',
  NO_PRICE: 'Sin precio',
  OTHER_CURRENCY: 'En otra moneda',
};

/**
 * Regla de oro: una oferta entra en mínimo/mediana/máximo solo si
 * es el mismo producto (o así lo marcó el usuario), su precio se verificó en
 * la página, está en la moneda del mercado y no fue excluida.
 */
export function exclusionReason(offer: CompetitorOffer, currency: string): ExclusionReason | null {
  if (isExcluded(offer)) return 'EXCLUDED_BY_USER';
  if (effectiveMatchType(offer) !== 'EXACT') return 'NOT_EXACT';
  if (!offer.price || offer.price.amount <= 0) return 'NO_PRICE';
  if (offer.evidence.verification !== 'PAGE_VERIFIED') return 'NOT_PAGE_VERIFIED';
  if (offer.price.currency !== currency) return 'OTHER_CURRENCY';
  return null;
}

export function isComparableVerified(offer: CompetitorOffer, currency: string): boolean {
  return exclusionReason(offer, currency) === null;
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export interface PriceStats {
  currency: string;
  count: number;
  min: number;
  median: number;
  max: number;
  /** Dominios distintos que aportan precio. */
  domains: number;
  prices: number[];
}

function statsFrom(prices: Array<{ amount: number; url: string }>, currency: string): PriceStats | null {
  if (prices.length === 0) return null;
  const amounts = prices.map((p) => p.amount).sort((a, b) => a - b);
  return {
    currency,
    count: amounts.length,
    min: amounts[0] ?? 0,
    median: median(amounts),
    max: amounts[amounts.length - 1] ?? 0,
    domains: new Set(prices.map((p) => registrableDomain(p.url))).size,
    prices: amounts,
  };
}

export interface MarketPriceSummary {
  /** Estadística principal: solo precios verificados y comparables. */
  verified: PriceStats | null;
  /** Referencia secundaria: mismo producto con precio solo visible en el buscador. */
  snippetReference: PriceStats | null;
  exclusions: Array<{ reason: ExclusionReason; count: number }>;
  /** Ofertas verificadas cuyo precio es atípico frente a la mediana (posible error de coincidencia). */
  outliers: string[];
  totalFound: number;
}

export function summarizeMarketPrices(offers: CompetitorOffer[], currency: string): MarketPriceSummary {
  const verified: Array<{ amount: number; url: string; id: string }> = [];
  const snippet: Array<{ amount: number; url: string }> = [];
  const counts = new Map<ExclusionReason, number>();
  for (const offer of offers) {
    const reason = exclusionReason(offer, currency);
    if (reason === null && offer.price) {
      verified.push({ amount: offer.price.amount, url: offer.url, id: offer.id });
      continue;
    }
    if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    if (
      reason === 'NOT_PAGE_VERIFIED' &&
      offer.price &&
      offer.price.currency === currency &&
      offer.evidence.verification === 'SEARCH_SNIPPET_ONLY'
    ) {
      snippet.push({ amount: offer.price.amount, url: offer.url });
    }
  }
  const verifiedStats = statsFrom(verified, currency);
  const outliers: string[] = [];
  if (verifiedStats && verifiedStats.count >= 3) {
    for (const v of verified) {
      if (v.amount < verifiedStats.median * 0.4 || v.amount > verifiedStats.median * 2.5) outliers.push(v.id);
    }
  }
  return {
    verified: verifiedStats,
    snippetReference: statsFrom(snippet, currency),
    exclusions: [...counts.entries()].map(([reason, count]) => ({ reason, count })),
    outliers,
    totalFound: offers.length,
  };
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

/** Distribución sencilla para la gráfica del reporte. */
export function histogram(values: number[], bins = 6): HistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const n = Math.max(1, Math.min(bins, values.length));
  const width = (max - min) / n;
  const out: HistogramBin[] = Array.from({ length: n }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const v of values) {
    const idx = Math.min(n - 1, Math.floor((v - min) / width));
    const bin = out[idx];
    if (bin) bin.count += 1;
  }
  return out;
}
