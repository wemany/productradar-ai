import type { HealthResponse } from '@productradar/core';
import { GATEWAY_VERSION, type Env } from '../env';
import { jsonResponse } from '../http';

/** Estado público del servicio: solo booleanos, nunca valores de secretos. */
export function handleHealth(env: Env): Response {
  const body: HealthResponse = {
    ok: true,
    version: GATEWAY_VERSION,
    providers: { search: Boolean(env.BRAVE_API_KEY), vision: Boolean(env.ANTHROPIC_API_KEY) },
    accessCodeRequired: Boolean(env.ACCESS_CODE),
  };
  return jsonResponse(body);
}
