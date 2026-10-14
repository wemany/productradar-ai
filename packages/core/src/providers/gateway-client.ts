import { z } from 'zod';
import {
  ApiErrorSchema,
  HealthResponseSchema,
  IdentifyImageResponseSchema,
  SearchAlibabaResponseSchema,
  SearchMarketResponseSchema,
  type HealthResponse,
  type IdentifyImageRequest,
  type VisionResult,
} from '../api';
import { SearchProviderError, type SearchInput, type WebSearchProvider } from '../research';
import type { SearchResultItem } from '../search-results';
import { parseHttpUrl } from '../url';

/**
 * Cliente del gateway (Cloudflare Worker). El gateway guarda las claves de
 * búsqueda e IA; la extensión nunca las contiene.
 */

export interface GatewayOptions {
  baseUrl: string;
  /** Código de acceso de demostración (no es autenticación fuerte). */
  accessCode?: string;
  /** Identificador anónimo de instalación, usado solo para cuotas. */
  installId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function normalizeGatewayUrl(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !isLocal) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function call<T>(options: GatewayOptions, path: string, init: { method: 'GET' | 'POST'; body?: unknown }, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const base = normalizeGatewayUrl(options.baseUrl);
  if (!base) throw new GatewayError('NOT_CONFIGURED', 'URL del gateway inválida (debe ser https)');
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.accessCode) headers['X-ProductRadar-Access'] = options.accessCode;
  if (options.installId) headers['X-ProductRadar-Install'] = options.installId;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(`${base}${path}`, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: combined,
      credentials: 'omit',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new GatewayError('TIMEOUT', 'El servicio tardó demasiado en responder');
    throw new GatewayError('NETWORK', 'No fue posible conectar con el servicio de ProductRadar');
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new GatewayError('BAD_RESPONSE', `Respuesta no válida del servicio (HTTP ${response.status})`, response.status);
  }
  if (!response.ok) {
    const err = z.object({ error: ApiErrorSchema }).safeParse(json);
    throw new GatewayError(err.success ? err.data.error.code : 'HTTP_ERROR', err.success ? err.data.error.message : `Error del servicio (HTTP ${response.status})`, response.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new GatewayError('BAD_RESPONSE', 'Respuesta del servicio con formato inesperado');
  return parsed.data;
}

function toSearchError(error: unknown): unknown {
  if (!(error instanceof GatewayError)) return error;
  const map: Record<string, SearchProviderError['code']> = {
    UNAUTHORIZED: 'UNAUTHORIZED',
    ACCESS_DENIED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    FORBIDDEN_ORIGIN: 'FORBIDDEN',
    RATE_LIMITED: 'RATE_LIMITED',
    QUOTA_EXCEEDED: 'QUOTA',
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    TIMEOUT: 'TIMEOUT',
    NETWORK: 'NETWORK',
  };
  return new SearchProviderError(map[error.code] ?? 'UPSTREAM', error.message, error.status);
}

export function gatewayHealth(options: GatewayOptions, signal?: AbortSignal): Promise<HealthResponse> {
  return call(options, '/v1/health', { method: 'GET' }, HealthResponseSchema, signal);
}

export async function gatewayIdentifyImage(options: GatewayOptions, request: IdentifyImageRequest, signal?: AbortSignal): Promise<{ result: VisionResult; model: string }> {
  return call(options, '/v1/identify-image', { method: 'POST', body: request }, IdentifyImageResponseSchema, signal);
}

export class GatewaySearchProvider implements WebSearchProvider {
  readonly id = 'gateway';
  readonly label = 'Servicio ProductRadar (Brave Search API)';
  constructor(private readonly options: GatewayOptions) {}

  async search(input: SearchInput, signal?: AbortSignal): Promise<SearchResultItem[]> {
    try {
      if (input.purpose === 'SUPPLIER') {
        const res = await call(this.options, '/v1/search-alibaba', { method: 'POST', body: { query: input.query, market: input.market.code } }, SearchAlibabaResponseSchema, signal);
        return res.items;
      }
      const res = await call(
        this.options,
        '/v1/search-market',
        { method: 'POST', body: { queries: [input.query], market: input.market.code, count: input.count } },
        SearchMarketResponseSchema,
        signal,
      );
      const first = res.results[0];
      if (!first) return [];
      if (!first.ok) throw new GatewayError(first.error?.code ?? 'UPSTREAM', first.error?.message ?? 'La consulta falló');
      return first.items ?? [];
    } catch (error) {
      throw toSearchError(error);
    }
  }
}
