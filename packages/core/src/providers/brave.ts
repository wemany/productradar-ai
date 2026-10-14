import { z } from 'zod';
import type { MarketConfig } from '../markets';
import { SearchProviderError, stripSiteOperators, type SearchInput, type WebSearchProvider } from '../research';
import type { SearchResultItem } from '../search-results';
import { cleanExternalText } from '../text';

/**
 * Adaptador de Brave Web Search API.
 * Documentación: https://api-dashboard.search.brave.com/api-reference/web/search/get
 *
 * Nota de cobertura: Brave no lista `CO` ni `PE` entre los países admitidos;
 * para esos mercados se usa `country=ALL` con `search_lang=es` y la
 * regionalización depende de la consulta y del filtrado posterior.
 */

export const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

const BraveProductSchema = z
  .object({
    name: z.string().optional(),
    price: z.union([z.string(), z.number()]).optional(),
    offers: z
      .array(
        z
          .object({
            price: z.union([z.string(), z.number()]).optional(),
            priceCurrency: z.string().optional(),
          })
          .loose(),
      )
      .optional(),
    gtin13: z.string().optional(),
    gtin12: z.string().optional(),
    gtin: z.string().optional(),
  })
  .loose();

const BraveWebResultSchema = z
  .object({
    title: z.string().default(''),
    url: z.string(),
    description: z.string().optional(),
    extra_snippets: z.array(z.string()).optional(),
    age: z.string().optional(),
    profile: z.object({ name: z.string().optional() }).loose().optional(),
    product: BraveProductSchema.optional(),
    product_cluster: z.array(BraveProductSchema).optional(),
  })
  .loose();

const BraveResponseSchema = z
  .object({
    web: z.object({ results: z.array(z.unknown()).default([]) }).loose().optional(),
  })
  .loose();

/** Convierte la respuesta de Brave al formato interno, descartando entradas inválidas. */
export function mapBraveResponse(json: unknown): SearchResultItem[] {
  const parsed = BraveResponseSchema.safeParse(json);
  if (!parsed.success) throw new SearchProviderError('BAD_RESPONSE', 'Respuesta del buscador con formato inesperado');
  const out: SearchResultItem[] = [];
  for (const raw of parsed.data.web?.results ?? []) {
    const r = BraveWebResultSchema.safeParse(raw);
    if (!r.success) continue;
    const item = r.data;
    const product = item.product ?? item.product_cluster?.[0];
    const offer = product?.offers?.[0];
    const price = offer?.price ?? product?.price;
    out.push({
      title: cleanExternalText(item.title, 400),
      url: item.url,
      snippet: cleanExternalText(item.description ?? '', 1000),
      extraSnippets: item.extra_snippets?.slice(0, 5).map((s) => cleanExternalText(s, 600)),
      publisherName: item.profile?.name ? cleanExternalText(item.profile.name, 120) : undefined,
      age: item.age,
      structuredProduct: product
        ? {
            name: product.name ? cleanExternalText(product.name, 300) : undefined,
            price: price !== undefined ? String(price).slice(0, 40) : undefined,
            currency: offer?.priceCurrency?.toUpperCase().slice(0, 3),
            gtin: product.gtin13 ?? product.gtin12 ?? product.gtin,
          }
        : undefined,
    });
  }
  return out;
}

const MAX_QUERY_LENGTH = 400;

/**
 * Brave no tiene un parámetro de dominios: se quitan los `site:` existentes y se
 * añade `(site:a OR site:b …)` al final, recortando antes la consulta base para
 * que el operador nunca quede truncado.
 */
export function braveQueryWithDomains(query: string, domains?: string[]): string {
  const clean = [...new Set((domains ?? []).map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9.-]+$/.test(d)))];
  if (!clean.length) return query.slice(0, MAX_QUERY_LENGTH);
  const clause = clean.length === 1 ? `site:${clean[0]}` : `(${clean.map((d) => `site:${d}`).join(' OR ')})`;
  const base = stripSiteOperators(query)
    .slice(0, MAX_QUERY_LENGTH - clause.length - 1)
    .trim();
  return base ? `${base} ${clause}` : clause;
}

export function buildBraveUrl(
  input: { query: string; market: MarketConfig; count: number; extraSnippets?: boolean; includeDomains?: string[] },
  endpoint = BRAVE_ENDPOINT,
): string {
  const url = new URL(endpoint);
  url.searchParams.set('q', braveQueryWithDomains(input.query, input.includeDomains));
  url.searchParams.set('count', String(Math.min(20, Math.max(1, input.count))));
  url.searchParams.set('country', input.market.braveCountry);
  url.searchParams.set('search_lang', input.market.searchLang);
  if (input.market.braveUiLang) url.searchParams.set('ui_lang', input.market.braveUiLang);
  url.searchParams.set('safesearch', 'moderate');
  url.searchParams.set('text_decorations', 'false');
  url.searchParams.set('result_filter', 'web');
  if (input.extraSnippets !== false) url.searchParams.set('extra_snippets', 'true');
  return url.toString();
}

export function braveErrorFromStatus(status: number, body?: unknown): SearchProviderError {
  // Brave responde 422 con código SUBSCRIPTION_TOKEN_INVALID cuando la clave no es válida.
  const code = typeof body === 'object' && body !== null ? (body as { error?: { code?: unknown } }).error?.code : undefined;
  if (status === 401 || code === 'SUBSCRIPTION_TOKEN_INVALID') return new SearchProviderError('UNAUTHORIZED', 'Clave de Brave Search inválida o ausente', status);
  if (status === 403) return new SearchProviderError('FORBIDDEN', 'Brave Search rechazó la solicitud (plan o permisos)', status);
  if (status === 429) return new SearchProviderError('RATE_LIMITED', 'Límite de consultas de Brave alcanzado; intenta en unos minutos', status);
  if (status === 422) return new SearchProviderError('BAD_RESPONSE', 'Brave rechazó los parámetros de la consulta', status);
  if (status >= 500) return new SearchProviderError('UPSTREAM', 'Brave Search no está disponible temporalmente', status);
  return new SearchProviderError('UPSTREAM', `Error del buscador (HTTP ${status})`, status);
}

export interface BraveOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  extraSnippets?: boolean;
  endpoint?: string;
}

export async function braveWebSearch(options: BraveOptions, input: SearchInput, signal?: AbortSignal): Promise<SearchResultItem[]> {
  if (!options.apiKey) throw new SearchProviderError('NOT_CONFIGURED', 'Falta la clave de Brave Search');
  const doFetch = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 12_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await doFetch(buildBraveUrl({ ...input, extraSnippets: options.extraSnippets }, options.endpoint), {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Subscription-Token': options.apiKey },
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new SearchProviderError('TIMEOUT', 'El buscador tardó demasiado en responder');
    throw new SearchProviderError('NETWORK', 'No fue posible conectar con el buscador');
  }
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw braveErrorFromStatus(response.status, body);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new SearchProviderError('BAD_RESPONSE', 'Respuesta del buscador no es JSON');
  }
  return mapBraveResponse(json);
}

/** Proveedor directo (clave propia del desarrollador; ver advertencias en docs/privacy.md). */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = 'brave-direct';
  readonly label = 'Brave Search API (clave propia)';
  constructor(private readonly options: BraveOptions) {}

  search(input: SearchInput, signal?: AbortSignal): Promise<SearchResultItem[]> {
    return braveWebSearch(this.options, input, signal);
  }
}
