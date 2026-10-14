import { readLimit, type Env } from '../env';
import { HttpError } from '../http';

/**
 * Límite de frecuencia por IP (`CF-Connecting-IP`, que fija Cloudflare) y por
 * identificador de instalación.
 *
 * - Limitador en memoria (ventana deslizante): siempre activo, pero es por
 *   isolate; Cloudflare puede ejecutar muchos isolates, así que es aproximado.
 * - Binding `RATE_LIMITER` (Cloudflare Rate Limiting), si está configurado:
 *   añade un límite compartido por ubicación. También es aproximado.
 *
 * Sin cuentas de usuario esto no es infalible: frena abusos casuales y protege
 * el presupuesto, no a un atacante con muchas IP.
 */

export const INSTALL_HEADER = 'X-ProductRadar-Install';
/** Formato del id anónimo de instalación (p. ej. un UUID). */
export const INSTALL_ID_PATTERN = /^[a-z0-9_-]{8,64}$/i;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;
const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 5_000;

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys = MAX_TRACKED_KEYS,
  ) {}

  /** Registra un intento. Devuelve 0 si se permite o los segundos que hay que esperar. */
  hit(key: string, limit: number, now = Date.now()): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    this.hits.delete(key);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil(((recent[0] ?? now) + this.windowMs - now) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Memoria acotada: se descartan las claves menos recientes (orden de inserción del Map).
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    return 0;
  }

  reset(): void {
    this.hits.clear();
  }
}

const memoryLimiter = new SlidingWindowLimiter(WINDOW_MS);

/** Solo para pruebas: el estado vive mientras viva el isolate. */
export function resetRateLimitState(): void {
  memoryLimiter.reset();
}

/** Agrupa IPv6 por prefijo /64 (un mismo cliente suele controlar todo el /64). */
export function clientIpKey(request: Request): string {
  const ip = (request.headers.get('CF-Connecting-IP') ?? '').trim().toLowerCase();
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

function rateLimited(retryAfterSeconds: number): HttpError {
  return new HttpError(429, 'RATE_LIMITED', 'Demasiadas solicitudes; espera un momento e intenta de nuevo', {
    'Retry-After': String(retryAfterSeconds),
  });
}

/**
 * Aplica los límites por IP y, si viene, por instalación.
 * El id de instalación NO es autenticación: lo genera el cliente y puede
 * cambiarse; solo sirve para repartir mejor el límite entre usuarios que
 * comparten IP (NAT, redes móviles).
 */
export async function enforceRateLimit(request: Request, env: Env): Promise<void> {
  const perMinute = Math.max(1, readLimit(env.RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT_PER_MINUTE));
  const keys = [`ip:${clientIpKey(request)}`];
  const install = request.headers.get(INSTALL_HEADER);
  if (install !== null) {
    if (!INSTALL_ID_PATTERN.test(install)) throw new HttpError(400, 'BAD_REQUEST', 'Identificador de instalación inválido');
    keys.push(`install:${install.toLowerCase()}`);
  }
  for (const key of keys) {
    const wait = memoryLimiter.hit(key, perMinute);
    if (wait > 0) throw rateLimited(wait);
    if (!env.RATE_LIMITER) continue;
    let success = true;
    try {
      ({ success } = await env.RATE_LIMITER.limit({ key }));
    } catch {
      // Si el binding falla, se sigue con el limitador en memoria (mejor esfuerzo).
      console.warn('RATE_LIMITER no disponible; se usa solo el límite en memoria');
    }
    if (!success) throw rateLimited(60);
  }
}
