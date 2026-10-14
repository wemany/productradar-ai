/**
 * Variables, secretos y bindings del gateway.
 *
 * Secretos (`wrangler secret put`, nunca en wrangler.jsonc ni en el repo):
 * TAVILY_API_KEY y/o BRAVE_API_KEY, ANTHROPIC_API_KEY y, opcionalmente, ACCESS_CODE.
 * Todos son opcionales: sin clave, la ruta correspondiente responde NOT_CONFIGURED.
 */

export const GATEWAY_VERSION = '0.1.0';

/** Binding de Cloudflare Rate Limiting (`ratelimits` en wrangler.jsonc). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Subconjunto de KVNamespace que usa el contador diario. */
export interface UsageKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** Los `vars` de wrangler pueden llegar como texto o como número. */
type VarValue = string | number | undefined;

export interface Env {
  TAVILY_API_KEY?: string;
  BRAVE_API_KEY?: string;
  /** "tavily" | "brave". Sin valor (o inválido): Tavily si hay su clave; si no, Brave. */
  SEARCH_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  ACCESS_CODE?: string;
  VISION_MODEL?: string;
  /** Lista separada por comas, p. ej. `chrome-extension://<id>`. */
  ALLOWED_ORIGINS?: string;
  DAILY_SEARCH_LIMIT?: VarValue;
  DAILY_VISION_LIMIT?: VarValue;
  /** Solicitudes por minuto por IP y por instalación (limitador en memoria). */
  RATE_LIMIT_PER_MINUTE?: VarValue;
  RATE_LIMITER?: RateLimitBinding;
  USAGE_KV?: UsageKv;
}

export type SearchProviderId = 'tavily' | 'brave';

export interface SearchConfig {
  provider: SearchProviderId;
  /** Vacío si el buscador elegido no tiene clave (la ruta responde NOT_CONFIGURED). */
  apiKey: string;
}

/**
 * Buscador del gateway. Un `SEARCH_PROVIDER` explícito se respeta aunque falte
 * su clave (así el error de configuración es visible en `/v1/health`).
 */
export function searchConfig(env: Env): SearchConfig {
  const wanted = (env.SEARCH_PROVIDER ?? '').trim().toLowerCase();
  const provider: SearchProviderId = wanted === 'tavily' || wanted === 'brave' ? wanted : env.TAVILY_API_KEY ? 'tavily' : 'brave';
  return { provider, apiKey: (provider === 'tavily' ? env.TAVILY_API_KEY : env.BRAVE_API_KEY) ?? '' };
}

/** Lee un entero no negativo de una variable; usa `fallback` si falta o es inválido. */
export function readLimit(value: VarValue, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Lo único que el gateway usa de `ExecutionContext`. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}
