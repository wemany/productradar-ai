import { computeContribution, headlineContribution, type ContributionResult } from './finance';
import { formatMoney, formatPercent } from './money';
import { effectiveMatchType, isExcluded, summarizeMarketPrices, type MarketPriceSummary } from './pricing';
import type { CompetitorOffer, Confidence, FinancialInputs, ProductIdentity, SupplierReference, Verdict } from './schemas';
import { registrableDomain } from './url';

/** Umbrales del veredicto (documentados en docs/architecture.md). */
export const VERDICT_THRESHOLDS = {
  /** Por debajo de este margen de contribución (%) el caso se considera no recomendable. */
  avoidMarginPct: 8,
  /** Por debajo de este margen (%) se recomienda precaución. */
  cautionMarginPct: 20,
  /** Mínimo de precios exactos verificados para considerar "datos razonables". */
  minVerifiedForTest: 2,
} as const;

export const CONFIDENCE_THRESHOLDS = {
  high: { verified: 4, domains: 3 },
  medium: { verified: 2, domains: 2 },
} as const;

export interface VerdictInput {
  product: ProductIdentity;
  offers: CompetitorOffer[];
  currency: string;
  locale?: string;
  financials?: FinancialInputs;
  supplierReferences?: SupplierReference[];
  incompleteModules?: string[];
}

export interface VerdictResult {
  verdict: Verdict;
  reasons: string[];
  risks: string[];
  confidence: Confidence;
  confidenceReasons: string[];
  market: MarketPriceSummary;
  contribution?: ContributionResult;
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  TEST: 'Interesante para probar',
  CAUTION: 'Precaución',
  AVOID: 'No recomendable bajo estos supuestos',
  INSUFFICIENT_DATA: 'Datos insuficientes',
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  LOW: 'Confianza de evidencia baja',
  MEDIUM: 'Confianza de evidencia media',
  HIGH: 'Confianza de evidencia alta',
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function computeConfidence(input: VerdictInput, market: MarketPriceSummary): { confidence: Confidence; reasons: string[] } {
  const reasons: string[] = [];
  const active = input.offers.filter((o) => !isExcluded(o));
  const verifiedCount = market.verified?.count ?? 0;
  const verifiedDomains = market.verified?.domains ?? 0;
  const snippetOnly = active.filter((o) => o.evidence.verification === 'SEARCH_SNIPPET_ONLY').length;
  const failed = active.filter((o) => o.verificationError).length;
  const variants = active.filter((o) => effectiveMatchType(o) === 'VARIANT').length;
  const identityStrong = Boolean(input.product.gtin || input.product.model || input.product.brand);

  reasons.push(
    verifiedCount > 0
      ? `${plural(verifiedCount, 'precio exacto verificado', 'precios exactos verificados')} en ${plural(verifiedDomains, 'dominio', 'dominios')}`
      : 'Ningún precio exacto verificado en página',
  );
  if (snippetOnly) reasons.push(`${plural(snippetOnly, 'oferta', 'ofertas')} solo con datos del buscador (no verificadas)`);
  if (failed) reasons.push(`${plural(failed, 'página no se pudo', 'páginas no se pudieron')} leer`);
  if (variants) reasons.push(`${plural(variants, 'variante distinta', 'variantes distintas')} separada${variants === 1 ? '' : 's'} de la comparación`);
  if (!identityStrong) reasons.push('Producto sin marca, modelo ni GTIN confirmados');
  if (input.product.uncertainties.length) reasons.push(`${plural(input.product.uncertainties.length, 'duda abierta', 'dudas abiertas')} sobre la identidad`);
  if (market.outliers.length) reasons.push(`${plural(market.outliers.length, 'precio atípico', 'precios atípicos')} que conviene revisar`);
  reasons.push('Cantidad de anuncios: no verificable con datos disponibles');

  let confidence: Confidence = 'LOW';
  if (
    verifiedCount >= CONFIDENCE_THRESHOLDS.high.verified &&
    verifiedDomains >= CONFIDENCE_THRESHOLDS.high.domains &&
    identityStrong &&
    input.product.uncertainties.length <= 1 &&
    market.outliers.length === 0
  ) {
    confidence = 'HIGH';
  } else if (verifiedCount >= CONFIDENCE_THRESHOLDS.medium.verified && verifiedDomains >= CONFIDENCE_THRESHOLDS.medium.domains) {
    confidence = 'MEDIUM';
  }
  return { confidence, reasons };
}

export function computeVerdict(input: VerdictInput): VerdictResult {
  const locale = input.locale ?? 'es-CO';
  const money = (n: number) => formatMoney(n, input.currency, locale);
  const market = summarizeMarketPrices(input.offers, input.currency);
  const { confidence, reasons: confidenceReasons } = computeConfidence(input, market);
  const reasons: string[] = [];
  const risks: string[] = [];

  const active = input.offers.filter((o) => !isExcluded(o));
  const exactAny = active.filter((o) => effectiveMatchType(o) === 'EXACT');
  const verifiedCount = market.verified?.count ?? 0;

  // Riesgos generales (independientes del costo)
  if (verifiedCount < VERDICT_THRESHOLDS.minVerifiedForTest) {
    risks.push(`Pocos precios exactos verificados (${verifiedCount}). La comparación de mercado es frágil.`);
  }
  const variants = active.filter((o) => effectiveMatchType(o) === 'VARIANT').length;
  if (variants >= 2) risks.push('Hay varias versiones/presentaciones del producto en el mercado: confirma cuál vas a vender.');
  if (input.product.uncertainties.length) risks.push(`Identidad con dudas: ${input.product.uncertainties.slice(0, 2).join('; ')}`);
  if (market.outliers.length) risks.push('Algunos precios verificados son atípicos; revisa que sean el mismo producto.');
  const highMoq = (input.supplierReferences ?? []).filter((s) => (s.moq ?? 0) >= 500);
  if (highMoq.length) risks.push('Algunos proveedores de Alibaba exigen pedido mínimo alto (≥ 500 unidades).');
  if (input.incompleteModules?.length) risks.push(`Módulos incompletos: ${input.incompleteModules.join(', ')}.`);
  const foreign = active.filter((o) => o.marketFit === 'FOREIGN').length;
  if (foreign) risks.push(`${plural(foreign, 'resultado corresponde', 'resultados corresponden')} a vendedores internacionales.`);

  if (!input.financials) {
    reasons.push('Completa la calculadora (precio de venta y costo) para obtener una recomendación.');
    return { verdict: 'INSUFFICIENT_DATA', reasons, risks, confidence, confidenceReasons, market };
  }

  const contribution = computeContribution(input.financials);
  if (contribution.status === 'INVALID') {
    return { verdict: 'INSUFFICIENT_DATA', reasons: ['Revisa los valores de la calculadora.', ...contribution.errors], risks, confidence, confidenceReasons, market, contribution };
  }
  if (contribution.status === 'MISSING_PRICE') {
    return { verdict: 'INSUFFICIENT_DATA', reasons: ['Define tu precio de venta propuesto.'], risks, confidence, confidenceReasons, market, contribution };
  }
  if (contribution.status === 'MISSING_COST') {
    return { verdict: 'INSUFFICIENT_DATA', reasons: ['Añade tu costo de compra para evaluar rentabilidad.'], risks, confidence, confidenceReasons, market, contribution };
  }
  if (exactAny.length === 0) {
    reasons.push('No encontramos ofertas del mismo producto en las fuentes consultadas; eso no significa que no haya competencia.');
    return { verdict: 'INSUFFICIENT_DATA', reasons, risks, confidence, confidenceReasons, market, contribution };
  }

  const headline = headlineContribution(contribution);
  if (!headline) {
    return { verdict: 'INSUFFICIENT_DATA', reasons: ['No fue posible calcular la contribución.'], risks, confidence, confidenceReasons, market, contribution };
  }

  const label = headline.adsIncluded ? 'con publicidad' : 'antes de publicidad';
  if (headline.amount <= 0) {
    reasons.push(`Con estos supuestos pierdes ${money(Math.abs(headline.amount))} por pedido (${label}).`);
    if (contribution.breakEvenCpa !== undefined && contribution.breakEvenCpa > 0) {
      reasons.push(`Para no perder, el CPA debe ser menor que ${money(contribution.breakEvenCpa)}.`);
    } else {
      reasons.push('Aun sin publicidad el pedido no cubre sus costos: necesitas subir el precio o bajar el costo.');
    }
    return { verdict: 'AVOID', reasons, risks, confidence, confidenceReasons, market, contribution };
  }
  if (headline.pct < VERDICT_THRESHOLDS.avoidMarginPct) {
    reasons.push(
      `Margen de contribución ${label} de ${formatPercent(headline.pct, locale)}: demasiado estrecho para absorber devoluciones, descuentos o un CPA mayor.`,
    );
    reasons.push('Mejora el caso negociando costo, subiendo precio o reduciendo envío.');
    return { verdict: 'AVOID', reasons, risks, confidence, confidenceReasons, market, contribution };
  }

  const cautions: string[] = [];
  if (!headline.adsIncluded) {
    cautions.push(`Sin CPA: la contribución ${money(headline.amount)} es antes de publicidad. CPA máximo de equilibrio: ${money(contribution.breakEvenCpa ?? 0)}.`);
  }
  if (headline.pct < VERDICT_THRESHOLDS.cautionMarginPct) {
    cautions.push(`Margen de contribución de ${formatPercent(headline.pct, locale)}: positivo pero ajustado.`);
  }
  if (verifiedCount < VERDICT_THRESHOLDS.minVerifiedForTest) {
    cautions.push('Menos de 2 precios exactos verificados: la referencia de mercado es débil.');
  }
  const price = input.financials.sellingPrice ?? 0;
  if (market.verified) {
    if (price > market.verified.max * 1.1) {
      cautions.push(`Tu precio (${money(price)}) supera el máximo verificado (${money(market.verified.max)}).`);
    } else if (price > market.verified.median * 1.25) {
      cautions.push(`Tu precio está más de 25 % por encima de la mediana verificada (${money(market.verified.median)}).`);
    }
  }
  if (input.financials.productCostSource === 'SUPPLIER_REFERENCE') {
    cautions.push('El costo usado es una referencia indicativa de proveedor, no una cotización confirmada.');
  }
  if (input.product.uncertainties.length) cautions.push('La identidad del producto tiene dudas sin resolver.');

  if (cautions.length) {
    reasons.push(`Contribución ${label} positiva: ${money(headline.amount)} por pedido (${formatPercent(headline.pct, locale)}).`, ...cautions);
    return { verdict: 'CAUTION', reasons, risks, confidence, confidenceReasons, market, contribution };
  }

  reasons.push(`Contribución con publicidad de ${money(headline.amount)} por pedido (${formatPercent(headline.pct, locale)}).`);
  reasons.push(`${plural(verifiedCount, 'precio exacto verificado', 'precios exactos verificados')} en ${plural(market.verified?.domains ?? 0, 'dominio', 'dominios')}.`);
  if (market.verified) reasons.push(`Tu precio está dentro del rango verificado (${money(market.verified.min)} – ${money(market.verified.max)}).`);
  reasons.push('Sugerencia: prueba con un lote pequeño y un presupuesto de pauta acotado.');
  return { verdict: 'TEST', reasons, risks, confidence, confidenceReasons, market, contribution };
}

/** Dominios distintos (utilidad para mensajes). */
export function distinctDomains(offers: CompetitorOffer[]): number {
  return new Set(offers.map((o) => registrableDomain(o.url))).size;
}

export const VERDICT_DISCLAIMER =
  'Esta recomendación depende de tus supuestos y de la cobertura de las fuentes consultadas. No garantiza ventas, demanda ni rentabilidad.';
