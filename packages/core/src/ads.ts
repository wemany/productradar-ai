import type { MarketConfig } from './markets';
import type { AdResearch, ProductIdentity } from './schemas';

/**
 * Investigación publicitaria con cobertura honesta.
 *
 * La API pública de Meta Ad Library no ofrece acceso general a todos los
 * anuncios comerciales del país ni a su histórico completo. Por eso el MVP
 * solo construye enlaces a las bibliotecas oficiales y deja los conteos en
 * `null` (no verificables). No se calcula "saturación" numérica.
 */

export const AD_COUNT_UNVERIFIABLE = 'Anuncios activos encontrados automáticamente: no verificable';
export const AD_HISTORY_UNAVAILABLE = 'Total histórico de anuncios/campañas: no disponible';

export function adSearchTerm(identity: ProductIdentity): string {
  const brandModel = [identity.brand, identity.model].filter(Boolean).join(' ').trim();
  return (brandModel || identity.name).slice(0, 100);
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
