import { z } from 'zod';
import type { MarketConfig } from '../markets';
import { SearchProviderError, stripSiteOperators, type SearchInput, type WebSearchProvider } from '../research';
import type { Market } from '../schemas';
import type { SearchResultItem } from '../search-results';
import { cleanExternalText } from '../text';

/**
 * Adaptador de Tavily Search API.
 * Documentación: https://docs.tavily.com/documentation/api-reference/endpoint/search
 *
 * - `POST https://api.tavily.com/search` con `Authorization: Bearer <clave>`; la
 *   clave nunca va en la URL ni en el cuerpo.
 * - `country` acepta nombres en inglés en minúscula (colombia, mexico, peru,
 *   chile) y solo aplica con `topic: 'general'`. Prioriza resultados del país;
 *   no los filtra, así que el filtrado local posterior sigue siendo necesario.
 * - `search_depth: 'basic'` cuesta 1 crédito por consulta.
 * - Restricción de dominios con `include_domains` (no con operadores `site:`).
 */

export const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/** Valores del parámetro `country` de Tavily para cada mercado. */
export const TAVILY_COUNTRY: Record<Market, string> = {
  CO: 'colombia',
  MX: 'mexico',
  PE: 'peru',
  CL: 'chile',
};

const MAX_QUERY_LENGTH = 400;
const SUPPLIER_DOMAINS = ['alibaba.com'];

const TavilyResultSchema = z
  .object({
    title: z.string().nullish(),
    url: z.string(),
    content: z.string().nullish(),
    score: z.number().nullish(),
    published_date: z.string().nullish(),
  })
  .loose();

const TavilyResponseSchema = z
  .object({
    results: z.array(z.unknown()).default([]),
  })
  .loose();

export interface TavilyRequestBody {
  query: string;
  topic: 'general';
  search_depth: 'basic';
  max_results: number;
  country: string;
  include_answer: false;
  include_raw_content: false;
  include_images: false;
  include_domains?: string[];
}

/** Dominios a restringir: los pedidos explícitamente o alibaba.com para proveedores. */
function domainsFor(input: Pick<SearchInput, 'purpose' | 'includeDomains'>): string[] | undefined {
  if (input.includeDomains?.length) return [...new Set(input.includeDomains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
  if (input.purpose === 'SUPPLIER') return SUPPLIER_DOMAINS;
  return undefined;
}

export function buildTavilyBody(input: { query: string; market: MarketConfig; count: number; purpose: SearchInput['purpose']; includeDomains?: string[] }): TavilyRequestBody {
  const domains = domainsFor(input);
  const query = (domains ? stripSiteOperators(input.query) : input.query.replace(/\s+/g, ' ').trim()).slice(0, MAX_QUERY_LENGTH);
  if (!query) throw new SearchProviderError('BAD_RESPONSE', 'La consulta quedó vacía');
  const body: TavilyRequestBody = {
    query,
    topic: 'general',
    search_depth: 'basic',
    max_results: Math.min(20, Math.max(1, Math.round(input.count))),
    country: TAVILY_COUNTRY[input.market.code],
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };
  if (domains?.length) body.include_domains = domains;
  return body;
}

/** Convierte la respuesta de Tavily al formato interno, descartando entradas inválidas. */
export function mapTavilyResponse(json: unknown): SearchResultItem[] {
  const parsed = TavilyResponseSchema.safeParse(json);
  if (!parsed.success) throw new SearchProviderError('BAD_RESPONSE', 'Respuesta del buscador con formato inesperado');
  const out: SearchResultItem[] = [];
  for (const raw of parsed.data.results) {
    const r = TavilyResultSchema.safeParse(raw);
    if (!r.success) continue;
    const item = r.data;
    out.push({
      title: cleanExternalText(item.title ?? '', 400),
      url: item.url,
      snippet: cleanExternalText(item.content ?? '', 1000),
      age: item.published_date ? item.published_date.slice(0, 100) : undefined,
    });
  }
  return out;
}

/** Texto de error de Tavily (`{ detail: { error } }`), solo para clasificar; nunca se muestra. */
function errorText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null) {
    const error = (detail as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return '';
}

export function tavilyErrorFromStatus(status: number, body?: unknown): SearchProviderError {
  if (status === 401) return new SearchProviderError('UNAUTHORIZED', 'Clave de Tavily inválida o ausente', status);
  if (status === 403) return new SearchProviderError('FORBIDDEN', 'Tavily rechazó la solicitud (plan o permisos)', status);
  // 432: límite de la clave o del plan; 433: límite de pago por uso.
  if (status === 432 || status === 433) return new SearchProviderError('QUOTA', 'Se agotaron los créditos o el límite de uso de Tavily', status);
  if (status === 429) {
    if (/usage limit|plan|credit|quota|pay-as-you-go/i.test(errorText(body))) {
      return new SearchProviderError('QUOTA', 'Se agotaron los créditos o el límite de uso de Tavily', status);
    }
    return new SearchProviderError('RATE_LIMITED', 'Límite de consultas de Tavily alcanzado; intenta en unos minutos', status);
  }
  if (status === 400 || status === 422) return new SearchProviderError('BAD_RESPONSE', 'Tavily rechazó los parámetros de la consulta', status);
  if (status >= 500) return new SearchProviderError('UPSTREAM', 'Tavily no está disponible temporalmente', status);
  return new SearchProviderError('UPSTREAM', `Error del buscador (HTTP ${status})`, status);
}

export interface TavilyOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
}

export async function tavilySearch(options: TavilyOptions, input: SearchInput, signal?: AbortSignal): Promise<SearchResultItem[]> {
  if (!options.apiKey) throw new SearchProviderError('NOT_CONFIGURED', 'Falta la clave de Tavily');
  const body = buildTavilyBody(input);
  const doFetch = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await doFetch(options.endpoint ?? TAVILY_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new SearchProviderError('TIMEOUT', 'El buscador tardó demasiado en responder');
    throw new SearchProviderError('NETWORK', 'No fue posible conectar con el buscador');
  }
  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = undefined;
    }
    throw tavilyErrorFromStatus(response.status, errorBody);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new SearchProviderError('BAD_RESPONSE', 'Respuesta del buscador no es JSON');
  }
  return mapTavilyResponse(json);
}

/** Proveedor directo (clave propia; ver advertencias en docs/privacy.md). */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = 'tavily-direct';
  readonly label = 'Tavily Search API (clave propia)';
  constructor(private readonly options: TavilyOptions) {}

  search(input: SearchInput, signal?: AbortSignal): Promise<SearchResultItem[]> {
    return tavilySearch(this.options, input, signal);
  }
}
