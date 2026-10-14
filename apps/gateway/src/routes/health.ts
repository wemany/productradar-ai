import type { HealthResponse } from '@productradar/core';
import { GATEWAY_VERSION, searchConfig, type Env } from '../env';
import { jsonResponse } from '../http';

/** Estado público del servicio: solo booleanos y el nombre del buscador, nunca valores de secretos. */
export function handleHealth(env: Env): Response {
  const search = searchConfig(env);
  const body: HealthResponse = {
    ok: true,
    version: GATEWAY_VERSION,
    providers: { search: Boolean(search.apiKey), vision: Boolean(env.ANTHROPIC_API_KEY) },
    searchProvider: search.provider,
    accessCodeRequired: Boolean(env.ACCESS_CODE),
  };
  return jsonResponse(body);
}
