import type { Env } from '../env';

/**
 * CORS para la extensión (`chrome-extension://<id>`).
 *
 * Importante: CORS NO es autenticación. Solo evita que páginas web arbitrarias
 * usen el gateway desde un navegador; cualquier cliente fuera del navegador
 * (curl, scripts) puede omitir o falsificar `Origin`. Por eso las solicitudes
 * sin `Origin` siguen a los demás controles (límites, código de acceso, cuotas).
 */

export const CORS_ALLOWED_HEADERS = 'Content-Type, X-ProductRadar-Access, X-ProductRadar-Install';

export function parseAllowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );
}

export type OriginCheck =
  | { kind: 'none' }
  | { kind: 'allowed'; origin: string }
  | { kind: 'forbidden' };

/** Comparación exacta con la lista blanca; sin comodines. */
export function checkOrigin(request: Request, env: Env): OriginCheck {
  const origin = request.headers.get('Origin');
  if (origin === null) return { kind: 'none' };
  return parseAllowedOrigins(env).has(origin) ? { kind: 'allowed', origin } : { kind: 'forbidden' };
}

/** Cabeceras para respuestas normales a un origen permitido. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'Retry-After',
    Vary: 'Origin',
  };
}

/** Cabeceras de respuesta a la verificación previa (OPTIONS); nunca con credenciales. */
export function preflightHeaders(origin: string, methods: string[]): Record<string, string> {
  return {
    ...corsHeaders(origin),
    'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
    'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
    'Access-Control-Max-Age': '600',
  };
}

/** Añade CORS a una respuesta ya construida. */
export function withCors(response: Response, check: OriginCheck): Response {
  const headers = new Headers(response.headers);
  if (!/\borigin\b/i.test(headers.get('Vary') ?? '')) headers.append('Vary', 'Origin');
  if (check.kind === 'allowed') {
    for (const [key, value] of Object.entries(corsHeaders(check.origin))) {
      if (key !== 'Vary') headers.set(key, value);
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
