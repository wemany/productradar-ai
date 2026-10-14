import { resultsToSocialEvidence, SOCIAL_MENTION_DOMAINS, socialMentionQuery } from './ads';
import { resultsToSupplierReferences } from './alibaba';
import { getMarketConfig, type MarketConfig } from './markets';
import { matchRank } from './matching';
import { buildAlibabaQuery, buildMarketQueries } from './queries';
import { createReport, recomputeReport } from './report';
import type { CompetitorOffer, FinancialInputs, Market, ModuleKey, ModuleStatus, ProductIdentity, ResearchReport } from './schemas';
import { resultsToOffers, type SearchResultItem } from './search-results';
import { applySnapshotToOffer, failOffer, PageFetchError, type OfferPageFetcher } from './verify';

export interface SearchInput {
  query: string;
  market: MarketConfig;
  count: number;
  /** MARKET: tiendas del país · SUPPLIER: alibaba.com · SOCIAL: menciones públicas en redes. */
  purpose: 'MARKET' | 'SUPPLIER' | 'SOCIAL';
  /**
   * Restringe la búsqueda a estos dominios. Tavily usa `include_domains`; Brave
   * añade operadores `site:` a la consulta. El gateway solo acepta una lista fija.
   */
  includeDomains?: string[];
}

/**
 * Quita operadores `site:` (y los `OR`/`|` que quedan sueltos) de una consulta,
 * para que la restricción de dominios la decida quien llama y no el texto.
 */
export function stripSiteOperators(query: string): string {
  return query
    .replace(/[-+]?\bsite:[^\s)"]*/gi, ' ')
    .replace(/(^|\s)(?:OR|\|)(?=\s|$)/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Proveedor de búsqueda web (gateway, Tavily o Brave con clave propia, o demo). */
export interface WebSearchProvider {
  readonly id: string;
  readonly label: string;
  /** true para fixtures de demostración. */
  readonly isDemo?: boolean;
  search(input: SearchInput, signal?: AbortSignal): Promise<SearchResultItem[]>;
}

export class SearchProviderError extends Error {
  constructor(
    readonly code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'UPSTREAM' | 'TIMEOUT' | 'NETWORK' | 'BAD_RESPONSE' | 'NOT_CONFIGURED' | 'QUOTA',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

export interface ResearchProviders {
  search: WebSearchProvider;
  fetcher?: OfferPageFetcher;
}

export interface RunResearchOptions {
  product: ProductIdentity;
  country: Market;
  providers: ResearchProviders;
  signal?: AbortSignal;
  isDemo?: boolean;
  reportId?: string;
  financials?: FinancialInputs;
  maxQueries?: number;
  resultsPerQuery?: number;
  maxPagesToVerify?: number;
  concurrency?: number;
  /**
   * Se llama con las URLs que se quieren leer. Devuelve un predicado con las
   * URLs autorizadas (el usuario puede negar el permiso). Si no se define,
   * se intenta leer todas.
   */
  requestVerification?: (urls: string[]) => Promise<(url: string) => boolean>;
  onUpdate?: (report: ResearchReport) => void;
  now?: () => Date;
}

class Cancelled extends Error {}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Cancelled('Investigación cancelada');
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      throwIfAborted(signal);
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function errorMessage(error: unknown): string {
  if (error instanceof SearchProviderError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 280);
  return 'Error desconocido';
}

/**
 * Orquesta la investigación completa con resultados parciales progresivos.
 * Cada módulo informa su estado; un fallo en un módulo no invalida los demás.
 */
export async function runResearch(options: RunResearchOptions): Promise<ResearchReport> {
  const now = options.now ?? (() => new Date());
  const market = getMarketConfig(options.country);
  const { signal } = options;
  let report = createReport({
    product: options.product,
    country: options.country,
    isDemo: Boolean(options.isDemo),
    searchProvider: options.providers.search.label,
    id: options.reportId,
    startedAt: now().toISOString(),
    financials: options.financials,
  });

  const emit = () => options.onUpdate?.(report);
  const setModule = (key: ModuleKey, status: ModuleStatus, message?: string) => {
    report = { ...report, modules: { ...report.modules, [key]: { status, message } } };
    emit();
  };

  try {
    setModule('identify', 'OK', 'Identidad confirmada por el usuario');

    // 2. Búsqueda de competidores
    setModule('search', 'RUNNING');
    const edited = options.product.searchQueries.map((q) => q.trim()).filter(Boolean);
    const queries = edited.length ? [...new Set(edited)].slice(0, 6) : buildMarketQueries(options.product, market, options.maxQueries ?? 5);
    const items: Array<SearchResultItem & { query: string }> = [];
    let failures = 0;
    let lastError = '';
    for (const query of queries) {
      throwIfAborted(signal);
      try {
        const found = await options.providers.search.search({ query, market, count: options.resultsPerQuery ?? 10, purpose: 'MARKET' }, signal);
        items.push(...found.map((f) => ({ ...f, query })));
        report = { ...report, queries: [...report.queries, { query, purpose: 'MARKET', ok: true, resultCount: found.length }] };
        const converted = resultsToOffers(items, options.product, market, now().toISOString(), options.isDemo ? 'DEMO_FIXTURE' : 'SEARCH_API');
        report = { ...report, offers: converted.offers, discarded: converted.discarded };
        emit();
      } catch (error) {
        if (signal?.aborted) throw new Cancelled('Investigación cancelada');
        failures += 1;
        lastError = errorMessage(error);
        report = { ...report, queries: [...report.queries, { query, purpose: 'MARKET', ok: false, resultCount: 0, error: lastError }] };
        emit();
        if (error instanceof SearchProviderError && ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_CONFIGURED', 'QUOTA'].includes(error.code)) break;
      }
    }
    const searchFailedAll = failures > 0 && failures === report.queries.filter((q) => q.purpose === 'MARKET').length;
    if (searchFailedAll) {
      setModule('search', 'FAILED', `La búsqueda falló: ${lastError}`);
    } else if (failures > 0) {
      setModule('search', 'PARTIAL', `${failures} de ${queries.length} consultas fallaron. Última causa: ${lastError}`);
    } else {
      setModule(
        'search',
        'OK',
        report.offers.length
          ? `${report.offers.length} páginas candidatas en la muestra (${report.discarded.length} descartadas)`
          : 'No encontramos ofertas verificables en las fuentes consultadas',
      );
    }

    // 3. Verificación en páginas
    throwIfAborted(signal);
    const fetcher = options.providers.fetcher;
    const candidates = report.offers
      .filter((o) => o.matchType !== 'UNRELATED')
      .sort((a, b) => matchRank(a.matchType) - matchRank(b.matchType) || b.matchScore - a.matchScore)
      .slice(0, options.maxPagesToVerify ?? 10);
    if (!fetcher) {
      setModule('verify', 'SKIPPED', 'La lectura de páginas no está disponible en este modo');
    } else if (candidates.length === 0) {
      setModule('verify', searchFailedAll ? 'SKIPPED' : 'OK', 'No hay páginas candidatas para verificar');
    } else {
      setModule('verify', 'RUNNING', `Verificando ${candidates.length} páginas…`);
      const allowed = options.requestVerification ? await options.requestVerification(candidates.map((c) => c.url)) : () => true;
      throwIfAborted(signal);
      const toFetch = candidates.filter((c) => allowed(c.url));
      const denied = candidates.length - toFetch.length;
      let verified = 0;
      let failed = 0;
      await mapWithConcurrency(
        toFetch,
        options.concurrency ?? 3,
        async (offer) => {
          let updated: CompetitorOffer;
          try {
            const snapshot = await fetcher.fetchSnapshot(offer.url, signal);
            updated = applySnapshotToOffer(offer, snapshot, options.product, market, now().toISOString());
            if (updated.evidence.verification === 'PAGE_VERIFIED') verified += 1;
          } catch (error) {
            if (signal?.aborted) throw new Cancelled('Investigación cancelada');
            updated = failOffer(offer, error);
            failed += 1;
            if (!(error instanceof PageFetchError)) updated.verificationError = updated.verificationError ?? 'No fue posible leer la página';
          }
          report = { ...report, offers: report.offers.map((o) => (o.id === updated.id ? updated : o)) };
          emit();
        },
        signal,
      );
      if (denied > 0) {
        report = {
          ...report,
          offers: report.offers.map((o) =>
            candidates.some((c) => c.id === o.id) && !allowed(o.url) ? { ...o, verificationError: 'No verificada: no se concedió permiso para leer el sitio' } : o,
          ),
        };
      }
      const parts = [`${verified} de ${candidates.length} con precio verificado en la página`];
      if (failed) parts.push(`${failed} no se pudieron leer`);
      if (denied) parts.push(`${denied} sin permiso`);
      const status: ModuleStatus = verified === 0 && toFetch.length > 0 && failed === toFetch.length ? 'FAILED' : failed > 0 || denied > 0 ? 'PARTIAL' : 'OK';
      setModule('verify', toFetch.length === 0 ? 'PARTIAL' : status, parts.join(' · '));
    }

    // 4. Alibaba
    throwIfAborted(signal);
    if (searchFailedAll) {
      setModule('suppliers', 'SKIPPED', 'Omitido porque el buscador no respondió');
    } else {
      setModule('suppliers', 'RUNNING');
      const query = buildAlibabaQuery(options.product);
      try {
        const found = await options.providers.search.search({ query, market, count: 10, purpose: 'SUPPLIER' }, signal);
        const refs = resultsToSupplierReferences(
          found.map((f) => ({ ...f, query })),
          options.product,
          now().toISOString(),
          options.isDemo ? 'DEMO_FIXTURE' : 'SEARCH_API',
        );
        report = {
          ...report,
          supplierReferences: refs,
          queries: [...report.queries, { query, purpose: 'SUPPLIER', ok: true, resultCount: found.length }],
        };
        const withPrice = refs.filter((r) => r.priceMin).length;
        setModule(
          'suppliers',
          'OK',
          refs.length ? `${refs.length} referencias públicas (${withPrice} con precio visible)` : 'Sin precios de abastecimiento verificables',
        );
      } catch (error) {
        if (signal?.aborted) throw new Cancelled('Investigación cancelada');
        report = { ...report, queries: [...report.queries, { query, purpose: 'SUPPLIER', ok: false, resultCount: 0, error: errorMessage(error) }] };
        setModule('suppliers', 'FAILED', `No fue posible consultar Alibaba: ${errorMessage(error)}`);
      }
    }

    // 5. Publicidad: enlaces oficiales + menciones públicas en redes (no son anuncios)
    throwIfAborted(signal);
    if (options.isDemo || options.providers.search.isDemo || searchFailedAll) {
      setModule('ads', 'OK', 'Enlaces a bibliotecas oficiales listos; cantidad de anuncios no verificable');
    } else {
      setModule('ads', 'RUNNING');
      const query = socialMentionQuery(options.product);
      try {
        const found = await options.providers.search.search(
          { query, market, count: 10, purpose: 'SOCIAL', includeDomains: [...SOCIAL_MENTION_DOMAINS] },
          signal,
        );
        const evidence = resultsToSocialEvidence(
          found.map((f) => ({ ...f, query })),
          now().toISOString(),
        );
        // Los conteos siguen en null: una mención no es un anuncio.
        report = {
          ...report,
          adResearch: { ...report.adResearch, evidence, activeAdsCount: null, historicalAdsCount: null },
          queries: [...report.queries, { query, purpose: 'SOCIAL', ok: true, resultCount: found.length }],
        };
        setModule('ads', 'OK', `Enlaces a bibliotecas oficiales listos · ${evidence.length} menciones públicas (no son conteo de anuncios)`);
      } catch (error) {
        if (signal?.aborted) throw new Cancelled('Investigación cancelada');
        // Paso complementario: su fallo no vuelve parcial el reporte ni afecta el veredicto.
        const message = errorMessage(error).slice(0, 200);
        report = { ...report, queries: [...report.queries, { query, purpose: 'SOCIAL', ok: false, resultCount: 0, error: message }] };
        setModule('ads', 'OK', `Enlaces a bibliotecas oficiales listos · no fue posible consultar menciones públicas (${message})`);
      }
    }

    // 6. Análisis
    setModule('analysis', 'RUNNING');
    report = recomputeReport(report);
    setModule('analysis', 'OK');
    const modules = Object.values(report.modules);
    const status: ResearchReport['status'] =
      report.modules.search.status === 'FAILED' && report.offers.length === 0
        ? 'FAILED'
        : modules.some((m) => m.status === 'FAILED' || m.status === 'PARTIAL')
          ? 'PARTIAL'
          : 'COMPLETE';
    report = recomputeReport({ ...report, status, finishedAt: now().toISOString() });
    emit();
    return report;
  } catch (error) {
    const cancelled = error instanceof Cancelled || signal?.aborted;
    const modules = Object.fromEntries(
      Object.entries(report.modules).map(([k, v]) => [k, v.status === 'RUNNING' || v.status === 'PENDING' ? { status: 'SKIPPED' as const, message: cancelled ? 'Cancelado' : undefined } : v]),
    ) as ResearchReport['modules'];
    report = recomputeReport({
      ...report,
      modules,
      status: cancelled ? 'CANCELLED' : 'FAILED',
      finishedAt: now().toISOString(),
      notes: [...report.notes, cancelled ? 'Investigación cancelada por el usuario: resultados parciales.' : `Error inesperado: ${errorMessage(error)}`],
    });
    emit();
    return report;
  }
}
