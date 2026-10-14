import type { MarketConfig } from './markets';
import type { AdResearch, ProductIdentity, SourceEvidence } from './schemas';
import type { SearchResultItem } from './search-results';
import { cleanExternalText, truncate } from './text';
import { canonicalizeUrl, cleanUrl, getHostname, parseHttpUrl, registrableDomain } from './url';

/**
 * Investigación publicitaria con cobertura honesta.
 *
 * La API pública de Meta Ad Library solo expone anuncios políticos o de temas
 * sociales para Colombia (los comerciales solo en la UE y el Reino Unido), y
 * extraer datos del sitio web de la biblioteca viola los términos de Meta. Por
 * eso solo se construyen enlaces a las bibliotecas oficiales y los conteos
 * quedan en `null` (no verificables). No se calcula "saturación" numérica.
 *
 * Aparte, una búsqueda web restringida a redes sociales reúne menciones
 * públicas del producto. Son evidencia de conversación pública, NO anuncios.
 */

export const AD_COUNT_UNVERIFIABLE = 'Anuncios activos encontrados automáticamente: no verificable';
export const AD_HISTORY_UNAVAILABLE = 'Total histórico de anuncios/campañas: no disponible';

/** Redes donde se buscan menciones públicas. También es la lista blanca del gateway. */
export const SOCIAL_MENTION_DOMAINS = ['facebook.com', 'instagram.com', 'tiktok.com'] as const;
export type SocialMentionDomain = (typeof SOCIAL_MENTION_DOMAINS)[number];
export const MAX_SOCIAL_MENTIONS = 8;

export function adSearchTerm(identity: ProductIdentity): string {
  const brandModel = [identity.brand, identity.model].filter(Boolean).join(' ').trim();
  return (brandModel || identity.name).slice(0, 100);
}

/** Consulta de menciones: el término entre comillas (marca y modelo, o el nombre). */
export function socialMentionQuery(identity: ProductIdentity): string {
  const term = adSearchTerm(identity).replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  return `"${term}"`;
}

/** URL http(s) cuyo dominio registrable es una de las redes de `SOCIAL_MENTION_DOMAINS`. */
export function isSocialMentionUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  return (SOCIAL_MENTION_DOMAINS as readonly string[]).includes(registrableDomain(parsed.hostname));
}

/**
 * Convierte resultados del buscador en evidencias de menciones públicas (máx. 8).
 * Solo fragmentos del buscador: nunca se leen las páginas de las redes ni se
 * cuentan anuncios.
 */
export function resultsToSocialEvidence(items: Array<SearchResultItem & { query?: string }>, retrievedAt: string, max = MAX_SOCIAL_MENTIONS): SourceEvidence[] {
  const out = new Map<string, SourceEvidence>();
  for (const item of items) {
    if (out.size >= max) break;
    if (!isSocialMentionUrl(item.url)) continue;
    const url = cleanUrl(item.url);
    const key = canonicalizeUrl(item.url);
    if (!url || !key || out.has(key)) continue;
    const text = cleanExternalText(item.snippet, 600) || cleanExternalText(item.title, 300);
    out.set(key, {
      url,
      publisher: getHostname(url),
      retrievedAt,
      method: 'SEARCH_API',
      verification: 'SEARCH_SNIPPET_ONLY',
      extractedText: text ? truncate(text, 300) : undefined,
      query: item.query?.slice(0, 300),
      note: 'Mención pública encontrada por el buscador; no es un anuncio ni un conteo de anuncios.',
    });
  }
  return [...out.values()];
}

export function buildMetaAdLibraryUrl(term: string, countryCode: string): string {
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('active_status', 'active');
  url.searchParams.set('ad_type', 'all');
  url.searchParams.set('country', countryCode);
  url.searchParams.set('q', term);
  url.searchParams.set('search_type', 'keyword_unordered');
  url.searchParams.set('media_type', 'all');
  return url.toString();
}

export function buildGoogleAdsTransparencyUrl(countryCode: string): string {
  const url = new URL('https://adstransparency.google.com/');
  url.searchParams.set('region', countryCode);
  return url.toString();
}

export function buildAdResearch(identity: ProductIdentity, market: MarketConfig): AdResearch {
  const term = adSearchTerm(identity);
  return {
    links: [
      {
        platform: 'META',
        label: 'Investigar en Meta Ads Library',
        url: buildMetaAdLibraryUrl(term, market.code),
        description: `Anuncios activos en ${market.name} que coinciden con “${term}” (Facebook e Instagram). Revisa los resultados tú mismo.`,
      },
      {
        platform: 'GOOGLE',
        label: 'Centro de transparencia de anuncios de Google',
        url: buildGoogleAdsTransparencyUrl(market.code),
        description: 'Busca por anunciante o dominio de los competidores encontrados.',
      },
    ],
    activeAdsCount: null,
    historicalAdsCount: null,
    evidence: [],
    coverageNote:
      'Sin un proveedor de datos publicitarios autorizado no es posible contar anuncios activos ni históricos. Los enlaces abren las bibliotecas oficiales para que revises la actividad directamente.',
  };
}
