import { z } from 'zod';
import {
  SearchAlibabaRequestSchema,
  SearchMarketRequestSchema,
  SearchProviderError,
  SearchResultItemSchema,
  getMarketConfig,
  isAlibabaUrl,
  parseHttpUrl,
  registrableDomain,
  stripSiteOperators,
  type ApiError,
  type Market,
  type SearchInput,
  type SearchMarketResponse,
  type SearchResultItem,
} from '@productradar/core';
import { braveWebSearch } from '@productradar/core/providers/brave';
import { tavilySearch } from '@productradar/core/providers/tavily';
import { searchConfig, type Env, type SearchConfig, type SearchProviderId, type WaitUntil } from '../env';
import { HttpError, jsonResponse, readJsonBody } from '../http';
import { checkQuota, recordUsage } from '../security/quota';

/**
 * Búsquedas web vía Tavily o Brave Search API (`SEARCH_PROVIDER`). El gateway
 * solo llama al endpoint fijo del buscador elegido (lo construye el adaptador
 * de core); nunca descarga URLs que envíe el usuario, así que no funciona como
 * proxy abierto. `includeDomains` solo admite la lista fija del contrato.
 */

type Item = z.infer<typeof SearchResultItemSchema>;

/** Las búsquedas son pequeñas: 6 consultas × 300 caracteres caben de sobra. */
const SEARCH_BODY_LIMIT = 16 * 1024;
const DEFAULT_COUNT = 10;
const ALIBABA_COUNT = 10;
const CONCURRENCY = 3;
const CACHE_TTL_SECONDS = 6 * 60 * 60;

const PROVIDERS: Record<SearchProviderId, { name: string; secret: string }> = {
  tavily: { name: 'Tavily', secret: 'TAVILY_API_KEY' },
  brave: { name: 'Brave', secret: 'BRAVE_API_KEY' },
};

interface SearchJob {
  query: string;
  market: Market;
  count: number;
  purpose: SearchInput['purpose'];
  includeDomains?: string[];
}

interface SearchDeps {
  request: Request;
  env: Env;
  ctx: WaitUntil;
  search: SearchConfig;
  /** Llamadas reales al buscador (las respuestas en caché no cuentan para el presupuesto). */
  upstreamCalls: number;
}

const notConfigured = () => new HttpError(503, 'NOT_CONFIGURED', 'La búsqueda no está disponible en este servidor');

/** Buscador configurado con su clave; si falta la clave, 503 sin llamar a nadie. */
function requireSearch(env: Env): SearchConfig {
  const config = searchConfig(env);
  if (!config.apiKey) throw notConfigured();
  return config;
}

/** Ajusta cada resultado al contrato de la API; descarta los que no cumplen. */
function sanitizeItem(item: SearchResultItem): Item | null {
  if (item.url.length > 2048 || !parseHttpUrl(item.url)) return null;
  const product = item.structuredProduct;
  const parsed = SearchResultItemSchema.safeParse({
    ...item,
    age: item.age?.slice(0, 100),
    structuredProduct: product ? { ...product, gtin: product.gtin && /^\d{8,14}$/.test(product.gtin) ? product.gtin : undefined } : undefined,
  });
  return parsed.success ? parsed.data : null;
}

/** Con `includeDomains`, solo pasan resultados de esos dominios (también subdominios). */
function inDomains(url: string, domains: string[] | undefined): boolean {
  if (!domains?.length) return true;
  const parsed = parseHttpUrl(url);
  return parsed ? domains.includes(registrableDomain(parsed.hostname)) : false;
}

/** Lo que se usa de la Cache API de Workers (`caches.default`). */
interface EdgeCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

/** `caches.default` solo existe en Workers; en Node (pruebas) no hay caché. */
function getCache(): EdgeCache | null {
  if (typeof caches === 'undefined') return null;
  return (caches as unknown as { default?: EdgeCache }).default ?? null;
}

/** Clave sintética GET en el propio host del Worker; nunca se descarga. */
async function cacheKey(request: Request, provider: SearchProviderId, job: SearchJob): Promise<string> {
  const raw = JSON.stringify([`${provider}-v1`, job.purpose, job.market, job.count, job.query, job.includeDomains ?? []]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${new URL(request.url).origin}/__cache/${provider}/${hex}`;
}

async function readCached(cache: EdgeCache, key: string): Promise<Item[] | null> {
  try {
    const hit = await cache.match(key);
    if (!hit) return null;
    const parsed = z.array(SearchResultItemSchema).safeParse(await hit.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function searchUpstream(deps: SearchDeps, job: SearchJob): Promise<Item[]> {
  const { provider, apiKey } = deps.search;
  const cache = getCache();
  const key = cache ? await cacheKey(deps.request, provider, job) : null;
  if (cache && key) {
    const cached = await readCached(cache, key);
    if (cached) return cached;
  }
  deps.upstreamCalls++;
  const input: SearchInput = { query: job.query, market: getMarketConfig(job.market), count: job.count, purpose: job.purpose, includeDomains: job.includeDomains };
  const raw = provider === 'tavily' ? await tavilySearch({ apiKey }, input) : await braveWebSearch({ apiKey }, input);
  const items = raw
    .filter((r) => inDomains(r.url, job.includeDomains))
    .map(sanitizeItem)
    .filter((i): i is Item => i !== null);
  if (cache && key) {
    const response = new Response(JSON.stringify(items), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
    });
    deps.ctx.waitUntil(cache.put(key, response).catch(() => undefined));
  }
  return items;
}

/** Errores del buscador → `{ code, message }` en español, sin detalles de la clave ni del cuerpo remoto. */
function toApiError(error: unknown, provider: SearchProviderId): ApiError {
  if (error instanceof SearchProviderError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
      case 'FORBIDDEN':
      case 'NOT_CONFIGURED':
        // Problema de la clave del servidor, no del usuario: se registra sin datos sensibles.
        console.error(`${PROVIDERS[provider].name} rechazó la solicitud (${error.code}); revisa ${PROVIDERS[provider].secret} y el plan`);
        return { code: 'NOT_CONFIGURED', message: 'La búsqueda no está disponible por un problema de configuración del servidor' };
      case 'RATE_LIMITED':
        return { code: 'RATE_LIMITED', message: 'El buscador alcanzó su límite temporal; intenta en unos minutos' };
      case 'QUOTA':
        return { code: 'QUOTA_EXCEEDED', message: 'Se agotó la cuota del buscador' };
      case 'TIMEOUT':
        return { code: 'TIMEOUT', message: 'El buscador tardó demasiado en responder' };
      default:
        return { code: 'UPSTREAM', message: 'El buscador no está disponible temporalmente' };
    }
  }
  console.error('Error inesperado en la búsqueda:', error instanceof Error ? error.name : typeof error);
  return { code: 'UPSTREAM', message: 'Error inesperado del buscador' };
}

const STATUS_BY_CODE: Record<string, number> = { NOT_CONFIGURED: 503, RATE_LIMITED: 429, QUOTA_EXCEEDED: 429, TIMEOUT: 504 };

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function handleSearchMarket(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
  const search = requireSearch(env);
  const body = await readJsonBody(request, SearchMarketRequestSchema, SEARCH_BODY_LIMIT);
  await checkQuota(env, 'search', body.queries.length);
  const deps: SearchDeps = { request, env, ctx, search, upstreamCalls: 0 };
  const count = body.count ?? DEFAULT_COUNT;
  // Solo dominios de la lista fija (ya validados por el esquema): menciones públicas en redes.
  const includeDomains = body.includeDomains ? [...new Set<string>(body.includeDomains)] : undefined;
  const purpose: SearchJob['purpose'] = includeDomains ? 'SOCIAL' : 'MARKET';
  // Consultas repetidas en la misma solicitud comparten una sola llamada.
  const inflight = new Map<string, Promise<Item[]>>();
  const results = await mapWithConcurrency(body.queries, CONCURRENCY, async (query): Promise<SearchMarketResponse['results'][number]> => {
    let pending = inflight.get(query);
    if (!pending) {
      pending = searchUpstream(deps, { query, market: body.market, count, purpose, includeDomains });
      inflight.set(query, pending);
    }
    try {
      return { query, ok: true, items: await pending };
    } catch (error) {
      return { query, ok: false, error: toApiError(error, search.provider) };
    }
  });
  ctx.waitUntil(recordUsage(env, 'search', deps.upstreamCalls));
  const response: SearchMarketResponse = { results };
  return jsonResponse(response);
}

/**
 * Fuerza la búsqueda a alibaba.com: elimina cualquier operador `site:` y los
 * `OR`/`|` que podrían ampliar la búsqueda a otros dominios, y antepone
 * `site:alibaba.com` (con Tavily, el adaptador lo convierte en
 * `include_domains`). Aun así, los resultados se filtran por dominio después.
 */
export function buildAlibabaSiteQuery(userQuery: string): string {
  const cleaned = stripSiteOperators(userQuery);
  if (!cleaned) throw new HttpError(400, 'BAD_REQUEST', 'La consulta de proveedores está vacía');
  return `site:alibaba.com ${cleaned}`;
}

export async function handleSearchAlibaba(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
  const search = requireSearch(env);
  const body = await readJsonBody(request, SearchAlibabaRequestSchema, SEARCH_BODY_LIMIT);
  const query = buildAlibabaSiteQuery(body.query);
  await checkQuota(env, 'search', 1);
  const deps: SearchDeps = { request, env, ctx, search, upstreamCalls: 0 };
  let items: Item[];
  try {
    items = await searchUpstream(deps, { query, market: body.market, count: ALIBABA_COUNT, purpose: 'SUPPLIER' });
  } catch (error) {
    const apiError = toApiError(error, search.provider);
    const status = STATUS_BY_CODE[apiError.code] ?? 502;
    throw new HttpError(status, apiError.code, apiError.message, status === 429 ? { 'Retry-After': '60' } : {});
  } finally {
    ctx.waitUntil(recordUsage(env, 'search', deps.upstreamCalls));
  }
  return jsonResponse({ items: items.filter((item) => isAlibabaUrl(item.url)) });
}
