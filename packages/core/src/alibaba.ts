import { classifyMatch, describeMatch, matchRank, stripModel, type MatchResult } from './matching';
import { findPrices } from './money';
import type { MatchType, ProductIdentity, SourceEvidence, SupplierReference } from './schemas';
import type { SearchResultItem } from './search-results';
import { cleanExternalText, normalizeText, stableId, truncate } from './text';
import { canonicalizeUrl, cleanUrl, getHostname, parseHttpUrl } from './url';

export const MAX_SUPPLIER_REFERENCES = 5;

/**
 * Etiquetas para proveedores: se comparan contra la descripción GENÉRICA, así
 * que nunca se afirma que sea "el mismo producto" de la marca del usuario.
 */
export const SUPPLIER_MATCH_LABELS: Record<MatchType, string> = {
  EXACT: 'Coincide con la descripción genérica',
  VARIANT: 'Variante o presentación distinta',
  SIMILAR: 'Producto parecido',
  UNRELATED: 'Coincidencia incierta',
};

/** Solo dominios de alibaba.com (no AliExpress ni otros servicios del grupo). */
export function isAlibabaUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed || parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'alibaba.com' || host.endsWith('.alibaba.com');
}

export function alibabaKind(url: string): SupplierReference['kind'] {
  const parsed = parseHttpUrl(url);
  if (!parsed) return 'LISTING';
  return /\/product-detail\/|\/product\/\d+|\/p-detail\//i.test(parsed.pathname) ? 'PRODUCT' : 'LISTING';
}

export interface AlibabaSnippetData {
  priceMin?: number;
  priceMax?: number;
  priceText?: string;
  moq?: number;
  moqUnit?: string;
  incoterm?: string;
}

const MOQ_PATTERNS: RegExp[] = [
  /(?:min(?:imum)?\.?\s*order(?:\s*quantity)?|moq|pedido\s*m[ií]nimo|cantidad\s*m[ií]nima(?:\s*de\s*pedido)?)\s*[:：]?\s*(\d[\d,.]*)\s*([a-zA-Záéíóú]+)?/i,
  /(\d[\d,.]*)\s*([a-zA-Záéíóú]+)?\s*\(\s*(?:min\.?\s*order|moq|pedido\s*m[ií]nimo)\s*\)/i,
];

/** Extrae rango de precio publicado, MOQ e incoterm de un título/fragmento de Alibaba. */
export function parseAlibabaSnippet(text: string): AlibabaSnippetData {
  const out: AlibabaSnippetData = {};
  const prices = findPrices(text, { marketCurrency: 'USD', dollarMeansUsd: true }).filter((p) => p.currency === 'USD');
  const first = prices[0];
  if (first) {
    out.priceMin = first.amount;
    out.priceMax = first.maxAmount;
    out.priceText = first.raw;
  }
  for (const re of MOQ_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const value = Number((m[1] ?? '').replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      if (Number.isFinite(value) && value >= 1 && value < 10_000_000) {
        out.moq = Math.round(value);
        const unit = m[2]?.toLowerCase();
        if (unit && /^(pieces?|pcs|units?|sets?|pairs?|piezas?|unidades?|kilograms?|kg|bags?|boxes?|cartons?|meters?|rolls?)$/.test(unit)) out.moqUnit = unit;
      }
      break;
    }
  }
  const incoterm = text.match(/\b(FOB|EXW|CIF|CFR|DDP|DAP|FCA)\b/);
  if (incoterm) out.incoterm = incoterm[1];
  return out;
}

/**
 * Coincidencia para proveedores: se compara contra el producto GENÉRICO (sin
 * marca, modelo ni códigos), porque los fabricantes OEM no publican la marca
 * del vendedor. Se prueba con el nombre en inglés y en español y se toma el mejor.
 */
export function supplierMatch(identity: ProductIdentity, title: string, snippet: string): { matchType: MatchType; reason: string } {
  const generic = { ...identity, brand: undefined, model: undefined, gtin: undefined, sku: undefined };
  const spanishName = stripModel(identity.brand ? identity.name.replace(new RegExp(identity.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ') : identity.name, identity.model)
    .replace(/\s+/g, ' ')
    .trim();
  const names = [identity.englishName, spanishName].filter((n): n is string => Boolean(n && n.trim()));
  let best: MatchResult | undefined;
  for (const name of names) {
    const r = classifyMatch({ ...generic, name }, { title, text: snippet });
    if (!best || matchRank(r.matchType) < matchRank(best.matchType) || (r.matchType === best.matchType && r.score > best.score)) best = r;
  }
  const result = best ?? classifyMatch(generic, { title, text: snippet });
  const notes: string[] = [];
  if (identity.brand && normalizeText(`${title} ${snippet}`).includes(normalizeText(identity.brand))) {
    notes.push(`Menciona la marca ${identity.brand}: verifica originalidad y autorización de la marca`);
  }
  if (result.matchType === 'UNRELATED') {
    return { matchType: 'UNRELATED', reason: [...notes, 'Coincidencia incierta: comparte pocos términos (puede estar en otro idioma); revísala manualmente'].join(' · ') };
  }
  return { matchType: result.matchType, reason: [...notes, describeMatch(result)].join(' · ') };
}

/**
 * Convierte resultados de búsqueda `site:alibaba.com` en referencias públicas.
 * Los precios son indicativos (sujetos a negociación y volumen), en la moneda
 * publicada, y nunca incluyen flete, seguro, aranceles ni IVA.
 */
export function resultsToSupplierReferences(
  items: Array<SearchResultItem & { query?: string }>,
  identity: ProductIdentity,
  retrievedAt: string,
  method: SourceEvidence['method'] = 'SEARCH_API',
): SupplierReference[] {
  const refs = new Map<string, SupplierReference>();
  for (const item of items) {
    if (!isAlibabaUrl(item.url)) continue;
    const url = cleanUrl(item.url);
    const key = canonicalizeUrl(item.url);
    if (!url || !key) continue;
    const title = cleanExternalText(item.title, 300);
    const snippet = cleanExternalText([item.snippet, ...(item.extraSnippets ?? [])].join(' · '), 600);
    const data = parseAlibabaSnippet(`${title} · ${snippet}`);
    const match = supplierMatch(identity, title, snippet);
    const ref: SupplierReference = {
      id: `s_${stableId(key)}`,
      title: title || url,
      url,
      kind: alibabaKind(url),
      priceMin: data.priceMin !== undefined ? { amount: data.priceMin, currency: 'USD' } : undefined,
      priceMax: data.priceMax !== undefined ? { amount: data.priceMax, currency: 'USD' } : undefined,
      priceText: data.priceText,
      moq: data.moq,
      moqUnit: data.moqUnit,
      incoterm: data.incoterm,
      matchType: match.matchType,
      matchReason: match.reason,
      evidence: {
        url,
        publisher: getHostname(url),
        retrievedAt,
        method,
        verification: data.priceMin !== undefined ? 'SEARCH_SNIPPET_ONLY' : 'UNAVAILABLE',
        extractedText: snippet ? truncate(snippet, 500) : undefined,
        query: item.query,
        note: 'Precio indicativo visible en el buscador; no es costo puesto en destino.',
      },
    };
    if (!refs.has(key)) refs.set(key, ref);
  }
  return [...refs.values()]
    .sort(
      (a, b) =>
        matchRank(a.matchType) - matchRank(b.matchType) ||
        Number(b.priceMin !== undefined) - Number(a.priceMin !== undefined) ||
        Number(b.kind === 'PRODUCT') - Number(a.kind === 'PRODUCT'),
    )
    .slice(0, MAX_SUPPLIER_REFERENCES);
}
