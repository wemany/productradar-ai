import type { Env } from '../env';

/**
 * Código de acceso opcional (`ACCESS_CODE`, definido con `wrangler secret put`).
 * Es una barrera de demostración compartida, no una cuenta de usuario: quien
 * tenga el código puede usar el gateway hasta los límites y cuotas configurados.
 */

export const ACCESS_HEADER = 'X-ProductRadar-Access';

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/**
 * Comparación en tiempo constante: se comparan los resúmenes SHA-256 (misma
 * longitud siempre), así ni el contenido ni la longitud del código se filtran
 * por tiempos de respuesta.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= (ha[i] ?? 0) ^ (hb[i] ?? 0);
  return diff === 0;
}

export async function hasValidAccess(request: Request, env: Env): Promise<boolean> {
  if (!env.ACCESS_CODE) return true;
  const provided = request.headers.get(ACCESS_HEADER);
  if (!provided) return false;
  return constantTimeEqual(provided, env.ACCESS_CODE);
}
