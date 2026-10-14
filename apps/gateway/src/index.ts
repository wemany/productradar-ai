import type { ExecutionContext } from '@cloudflare/workers-types';
import type { Env, WaitUntil } from './env';
import { HttpError, emptyResponse, errorResponse } from './http';
import { handleHealth } from './routes/health';
import { handleIdentifyImage } from './routes/identify';
import { handleSearchAlibaba, handleSearchMarket } from './routes/search';
import { hasValidAccess } from './security/access';
import { checkOrigin, preflightHeaders, withCors, type OriginCheck } from './security/cors';
import { enforceRateLimit } from './security/rate-limit';

/**
 * Gateway de ProductRadar AI (Cloudflare Worker).
 *
 * Guarda las claves de Brave Search y Anthropic para que nunca viajen dentro de
 * la extensión. No es un proxy abierto: solo llama a los endpoints fijos de
 * Brave y Anthropic, nunca a URLs que envíe el cliente.
 *
 * Orden de controles: origen (CORS) → ruta/método → límite de frecuencia →
 * código de acceso → validación del cuerpo → presupuesto diario → proveedor.
 * El límite va antes del código de acceso para frenar intentos de adivinarlo.
 */

type Handler = (request: Request, env: Env, ctx: WaitUntil) => Response | Promise<Response>;

interface Route {
  method: 'GET' | 'POST';
  handler: Handler;
  /** `/v1/health` es público para que el cliente sepa si debe pedir código. */
  requiresAccess: boolean;
}

const ROUTES: Record<string, Route> = {
  '/v1/health': { method: 'GET', handler: (_request, env) => handleHealth(env), requiresAccess: false },
  '/v1/search-market': { method: 'POST', handler: handleSearchMarket, requiresAccess: true },
  '/v1/search-alibaba': { method: 'POST', handler: handleSearchAlibaba, requiresAccess: true },
  '/v1/identify-image': { method: 'POST', handler: handleIdentifyImage, requiresAccess: true },
};

async function route(request: Request, env: Env, ctx: WaitUntil, origin: OriginCheck): Promise<Response> {
  const { pathname } = new URL(request.url);
  const match = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : undefined;

  if (request.method === 'OPTIONS') {
    // Solo se responde la verificación previa a orígenes de la lista blanca.
    if (origin.kind !== 'allowed') throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Origen no permitido');
    if (!match) throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada');
    return emptyResponse(204, preflightHeaders(origin.origin, [match.method]));
  }
  if (!match) throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada');
  if (request.method !== match.method) {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método no permitido', { Allow: `${match.method}, OPTIONS` });
  }
  await enforceRateLimit(request, env);
  if (match.requiresAccess && !(await hasValidAccess(request, env))) {
    throw new HttpError(401, 'ACCESS_DENIED', 'Código de acceso inválido o ausente');
  }
  return match.handler(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = checkOrigin(request, env);
    let response: Response;
    try {
      // Un navegador con un origen no permitido se corta antes de cualquier otro trabajo.
      if (origin.kind === 'forbidden') throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Origen no permitido');
      response = await route(request, env, ctx, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        response = errorResponse(error.status, error.code, error.message, error.headers);
      } else {
        // Nunca se registran cuerpos (pueden contener la imagen) ni cabeceras con secretos.
        console.error('Error interno del gateway:', error instanceof Error ? error.name : typeof error);
        response = errorResponse(500, 'INTERNAL', 'Error interno del servicio');
      }
    }
    return withCors(response, origin);
  },
};
