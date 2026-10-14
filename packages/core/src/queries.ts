import { extractHardAttributes } from './attributes';
import { identityText } from './matching';
import type { MarketConfig } from './markets';
import type { ProductIdentity } from './schemas';

const MAX_QUERY_LENGTH = 200;

function clean(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

function presentation(identity: ProductIdentity): string | undefined {
  const a = extractHardAttributes(identityText(identity));
  if (a.packCount && a.packCount > 1) return `x${a.packCount}`;
  if (a.volumeMl) return a.volumeMl >= 1000 && a.volumeMl % 1000 === 0 ? `${a.volumeMl / 1000} L` : `${a.volumeMl} ml`;
  if (a.storageGb) return a.storageGb >= 1000 && a.storageGb % 1000 === 0 ? `${a.storageGb / 1000} TB` : `${a.storageGb} GB`;
  if (a.weightG) return a.weightG >= 1000 && a.weightG % 1000 === 0 ? `${a.weightG / 1000} kg` : `${a.weightG} g`;
  return undefined;
}

/**
 * Genera 3–6 consultas de búsqueda para el mercado a partir de la identidad
 * confirmada. Siempre incluye el país; no depende solo de dominios locales.
 */
export function buildMarketQueries(identity: ProductIdentity, market: MarketConfig, max = 5): string[] {
  const country = market.name;
  const name = identity.name.trim();
  const brandModel = [identity.brand, identity.model].filter(Boolean).join(' ').trim();
  const nameHasBrandModel = brandModel && name.toLowerCase().includes(brandModel.toLowerCase());
  const core = identity.model ? (nameHasBrandModel ? name : `${brandModel} ${name}`) : name;
  const pres = presentation(identity);
  const firstAttr = Object.values(identity.attributes).find((v) => v && v.length <= 40);

  const queries: string[] = [];
  if (identity.brand && identity.model) queries.push(`"${brandModel}" comprar ${country} precio`);
  queries.push(`${core} precio ${market.currency} tienda ${country}`);
  if (identity.gtin) queries.push(`"${identity.gtin}"`);
  if (pres && !core.toLowerCase().includes(pres.toLowerCase())) queries.push(`${core} ${pres} online ${country}`);
  if (firstAttr && !core.toLowerCase().includes(firstAttr.toLowerCase())) queries.push(`${core} ${firstAttr} ${country}`);
  queries.push(`${core} comprar ${country}`);
  queries.push(`${core} ${country} envío`);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries.map(clean)) {
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= Math.max(3, Math.min(6, max))) break;
  }
  return out;
}

/** Consulta para referencias públicas de Alibaba (búsqueda web, sin API privada). */
export function buildAlibabaQuery(identity: ProductIdentity): string {
  const base = identity.alibabaQuery?.trim() || identity.englishName?.trim() || [identity.brand, identity.model].filter(Boolean).join(' ') || identity.name;
  const withoutSite = base.replace(/site:\S+/gi, '').trim();
  return clean(`site:alibaba.com ${withoutSite}`);
}
