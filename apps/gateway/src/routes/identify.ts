import type { z } from 'zod';
import { API_LIMITS, IdentifyImageRequestSchema, type IdentifyImageResponseSchema } from '@productradar/core';
import { DEFAULT_VISION_MODEL, VisionProviderError, identifyWithClaude, type VisionImage } from '@productradar/core/providers/anthropic-vision';
import type { Env, WaitUntil } from '../env';
import { HttpError, jsonResponse, readJsonBody } from '../http';
import { checkQuota, recordUsage } from '../security/quota';

/**
 * Identificación de producto por foto con Claude.
 * Privacidad: la imagen solo se reenvía a la API de Anthropic. Nunca se
 * registra, se guarda ni se cachea (ni siquiera en los mensajes de error).
 */

type IdentifyImageResponse = z.infer<typeof IdentifyImageResponseSchema>;

interface MappedError {
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

const VISION_ERRORS: Record<VisionProviderError['code'], MappedError> = {
  NOT_CONFIGURED: { status: 503, code: 'NOT_CONFIGURED', message: 'La identificación por foto no está disponible en este servidor' },
  // Clave del servidor inválida: es un fallo de configuración, no del usuario. No se dan detalles de la clave.
  UNAUTHORIZED: { status: 503, code: 'NOT_CONFIGURED', message: 'La identificación por foto no está disponible por un problema de configuración del servidor' },
  RATE_LIMITED: { status: 429, code: 'RATE_LIMITED', message: 'El servicio de IA está ocupado; intenta de nuevo en un minuto', retryAfterSeconds: 30 },
  OVERLOADED: { status: 503, code: 'OVERLOADED', message: 'El servicio de IA está saturado; intenta de nuevo en unos minutos', retryAfterSeconds: 30 },
  REFUSED: { status: 422, code: 'REFUSED', message: 'No fue posible analizar esta imagen; prueba con otra foto' },
  NOT_A_PRODUCT: { status: 422, code: 'NOT_A_PRODUCT', message: 'La imagen no parece mostrar un producto; prueba con otra foto' },
  BAD_OUTPUT: { status: 502, code: 'BAD_OUTPUT', message: 'La IA devolvió una respuesta no válida; intenta de nuevo' },
  BAD_REQUEST: { status: 400, code: 'BAD_REQUEST', message: 'El servicio de IA rechazó la imagen; prueba con otra foto' },
  UPSTREAM: { status: 502, code: 'UPSTREAM', message: 'El servicio de IA no está disponible temporalmente' },
};

function toHttpError(error: unknown): HttpError {
  if (error instanceof VisionProviderError) {
    if (error.code === 'UNAUTHORIZED') console.error('Anthropic rechazó la clave; revisa ANTHROPIC_API_KEY');
    const mapped = VISION_ERRORS[error.code];
    const headers: Record<string, string> = mapped.retryAfterSeconds ? { 'Retry-After': String(mapped.retryAfterSeconds) } : {};
    return new HttpError(mapped.status, mapped.code, mapped.message, headers);
  }
  console.error('Error inesperado en identificación:', error instanceof Error ? error.name : typeof error);
  return new HttpError(502, 'UPSTREAM', VISION_ERRORS.UPSTREAM.message);
}

const SIGNATURES: Record<VisionImage['mimeType'], (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/webp': (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
};

/**
 * Comprobación barata antes de pagar una llamada a la IA: relleno base64 solo
 * al final y firma binaria acorde al tipo declarado.
 */
export function looksLikeImage(imageBase64: string, mimeType: VisionImage['mimeType']): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) return false;
  try {
    const head = atob(imageBase64.slice(0, 16));
    return SIGNATURES[mimeType](Uint8Array.from(head, (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
}

export async function handleIdentifyImage(request: Request, env: Env, ctx: WaitUntil): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) throw toHttpError(new VisionProviderError('NOT_CONFIGURED', 'sin clave'));
  const body = await readJsonBody(request, IdentifyImageRequestSchema, API_LIMITS.maxBodyBytes);
  if (!looksLikeImage(body.imageBase64, body.mimeType)) {
    throw new HttpError(400, 'BAD_REQUEST', 'La imagen no es válida o no coincide con el tipo declarado');
  }
  await checkQuota(env, 'vision', 1);
  try {
    const { result, model } = await identifyWithClaude(
      { apiKey: env.ANTHROPIC_API_KEY, model: env.VISION_MODEL || DEFAULT_VISION_MODEL },
      { imageBase64: body.imageBase64, mimeType: body.mimeType },
    );
    const response: IdentifyImageResponse = { result, model };
    return jsonResponse(response);
  } catch (error) {
    throw toHttpError(error);
  } finally {
    // Cuenta cada intento: también los fallidos consumen capacidad del proveedor.
    ctx.waitUntil(recordUsage(env, 'vision', 1));
  }
}
