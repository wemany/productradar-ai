import { extractHardAttributes } from './attributes';
import { extractFromSnapshot, pickOffer, type PageSnapshot } from './extract';
import type { ProductIdentity } from './schemas';
import { cleanExternalText, normalizeText } from './text';
import { cleanUrl, nameFromUrlSlug, parseHttpUrl } from './url';

/** Atributos sugeridos a partir del nombre (editables por el usuario). */
export function suggestedAttributes(name: string): Record<string, string> {
  const a = extractHardAttributes(name);
  const out: Record<string, string> = {};
  if (a.storageGb) out['Capacidad'] = a.storageGb >= 1000 && a.storageGb % 1000 === 0 ? `${a.storageGb / 1000} TB` : `${a.storageGb} GB`;
  if (a.volumeMl) out['Volumen'] = a.volumeMl >= 1000 && a.volumeMl % 1000 === 0 ? `${a.volumeMl / 1000} L` : `${a.volumeMl} ml`;
  if (a.weightG) out['Peso/contenido'] = a.weightG >= 1000 && a.weightG % 1000 === 0 ? `${a.weightG / 1000} kg` : `${a.weightG} g`;
  if (a.packCount && a.packCount > 1) out['Unidades por paquete'] = String(a.packCount);
  if (a.screenInches) out['Pantalla'] = `${a.screenInches}"`;
  if (a.batteryMah) out['Batería'] = `${a.batteryMah} mAh`;
  return out;
}

/** Quita sufijos de tienda del título ("Producto | Tienda", "Producto - Tienda"). */
export function cleanPageTitle(title: string): string {
  const parts = title.split(/\s+[|–—]\s+|\s+-\s+(?=[^-]*$)/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return title.trim();
  return parts.reduce((a, b) => (b.length > a.length ? b : a), '');
}

/**
 * Construye una identidad EDITABLE a partir de la página analizada.
 * Prioriza datos estructurados; si no existen, usa h1/título y lo indica
 * como duda. El precio de la página se guarda solo como referencia.
 */
export function identityFromSnapshot(snapshot: PageSnapshot, marketCurrency: string): ProductIdentity {
  const extraction = extractFromSnapshot(snapshot, marketCurrency);
  const primary = extraction.primary;
  const sourceUrl = cleanUrl(snapshot.canonical && parseHttpUrl(snapshot.canonical) ? snapshot.canonical : snapshot.url) ?? undefined;
  const titleName = extraction.fallbackName ? cleanPageTitle(extraction.fallbackName) : undefined;
  const slugName = nameFromUrlSlug(snapshot.url);
  const name = cleanExternalText(primary?.name || titleName || slugName || '', 300);

  let identifiedBy: ProductIdentity['identifiedBy'] = 'URL_SLUG';
  if (primary?.source === 'JSON_LD' || primary?.source === 'MICRODATA') identifiedBy = 'PAGE_STRUCTURED_DATA';
  else if (primary || titleName) identifiedBy = 'PAGE_METADATA';

  const uncertainties: string[] = [];
  if (identifiedBy !== 'PAGE_STRUCTURED_DATA') uncertainties.push('La página no publica datos estructurados de producto: revisa el nombre y los atributos.');
  if (identifiedBy === 'URL_SLUG') uncertainties.push('Nombre deducido de la dirección web.');
  if (!primary?.brand) uncertainties.push('La página no indica la marca.');

  const otherNames = [...new Set(extraction.products.map((p) => p.name).filter((n): n is string => Boolean(n) && normalizeText(n ?? '') !== normalizeText(name)))];
  if (otherNames.length) uncertainties.push('La página lista varias variantes: confirma la presentación exacta.');

  const offer = pickOffer(primary, marketCurrency);
  const sourcePrice =
    offer?.price !== undefined && offer.currency
      ? { amount: offer.price, currency: offer.currency }
      : extraction.visiblePrice
        ? { amount: extraction.visiblePrice.amount, currency: extraction.visiblePrice.currency }
        : undefined;

  const attributes = suggestedAttributes(name);
  if (primary?.category) attributes['Categoría'] = cleanExternalText(primary.category, 80);

  const image = primary?.image ?? extraction.fallbackImage;
  return {
    name: name || 'Producto sin nombre',
    brand: primary?.brand,
    model: primary?.model && primary.model !== primary.name ? primary.model : undefined,
    gtin: primary?.gtin && /^\d{8,14}$/.test(primary.gtin) ? primary.gtin : undefined,
    sku: primary?.sku ?? primary?.mpn,
    attributes,
    sourceUrl,
    imageUrl: image && parseHttpUrl(image)?.protocol === 'https:' ? image : undefined,
    sourcePrice,
    searchQueries: [],
    uncertainties,
    identifiedBy,
    alternatives: otherNames.slice(0, 3).map((n) => ({ name: cleanExternalText(n, 200) })),
  };
}

/** Identidad mínima cuando no se pudo leer la página: solo la URL, marcada como dudosa. */
export function identityFromUrlOnly(url: string, reason: string): ProductIdentity {
  return {
    name: nameFromUrlSlug(url) ?? '',
    attributes: {},
    sourceUrl: cleanUrl(url) ?? undefined,
    searchQueries: [],
    uncertainties: [reason, 'Nombre deducido de la dirección web: corrígelo antes de buscar.'],
    identifiedBy: 'URL_SLUG',
  };
}
