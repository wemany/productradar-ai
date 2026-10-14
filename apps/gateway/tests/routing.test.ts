import { HealthResponseSchema } from '@productradar/core';
import { describe, expect, it } from 'vitest';
import { EXTENSION_ORIGIN, call, makeEnv } from './helpers';

describe('health', () => {
  it('informa proveedores y código de acceso sin exponer secretos', async () => {
    const env = makeEnv({ ACCESS_CODE: 'codigo-super-secreto' });
    const { status, json, response } = await call('/v1/health', { env });
    expect(status).toBe(200);
    expect(HealthResponseSchema.parse(json)).toEqual({
      ok: true,
      version: '0.1.0',
      providers: { search: true, vision: true },
      searchProvider: 'brave',
      accessCodeRequired: true,
    });
    const raw = JSON.stringify(json);
    for (const secret of ['codigo-super-secreto', 'test-brave-key', 'test-anthropic-key']) expect(raw).not.toContain(secret);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('marca proveedores ausentes cuando faltan las claves', async () => {
    const { json } = await call('/v1/health', { env: makeEnv({ BRAVE_API_KEY: undefined, ANTHROPIC_API_KEY: '' }) });
    expect(HealthResponseSchema.parse(json).providers).toEqual({ search: false, vision: false });
    expect(json.accessCodeRequired).toBe(false);
  });

  it.each([
    [{ TAVILY_API_KEY: 'test-tavily-key' }, 'tavily', true],
    [{ TAVILY_API_KEY: 'test-tavily-key', BRAVE_API_KEY: undefined }, 'tavily', true],
    [{ TAVILY_API_KEY: 'test-tavily-key', SEARCH_PROVIDER: 'brave' }, 'brave', true],
    [{ SEARCH_PROVIDER: 'tavily' }, 'tavily', false],
    [{ SEARCH_PROVIDER: ' Brave ' }, 'brave', true],
    [{ SEARCH_PROVIDER: 'otro' }, 'brave', true],
    [{ BRAVE_API_KEY: undefined }, 'brave', false],
  ])('elige el buscador según SEARCH_PROVIDER y las claves (%o)', async (overrides, provider, search) => {
    const { json } = await call('/v1/health', { env: makeEnv(overrides) });
    const health = HealthResponseSchema.parse(json);
    expect([health.searchProvider, health.providers.search]).toEqual([provider, search]);
    expect(JSON.stringify(json)).not.toContain('test-tavily-key');
  });

  it('es público aunque haya código de acceso', async () => {
    const { status } = await call('/v1/health', { env: makeEnv({ ACCESS_CODE: 'x' }) });
    expect(status).toBe(200);
  });
});

describe('rutas', () => {
  it('404 para rutas desconocidas', async () => {
    const { status, json } = await call('/v1/nada');
    expect(status).toBe(404);
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('no trata propiedades heredadas como rutas', async () => {
    expect((await call('/constructor')).status).toBe(404);
  });

  it('405 con método incorrecto', async () => {
    const { status, json, response } = await call('/v1/search-market', { method: 'GET' });
    expect(status).toBe(405);
    expect(json.error?.code).toBe('METHOD_NOT_ALLOWED');
    expect(response.headers.get('Allow')).toContain('POST');
    expect((await call('/v1/health', { method: 'POST', body: {} })).status).toBe(405);
  });
});

describe('CORS', () => {
  it('responde la verificación previa a un origen permitido', async () => {
    const { status, response } = await call('/v1/search-market', {
      method: 'OPTIONS',
      headers: { Origin: EXTENSION_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    expect(status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(EXTENSION_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-ProductRadar-Access');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-ProductRadar-Install');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Vary')).toContain('Origin');
  });

  it('rechaza la verificación previa de otros orígenes o sin origen', async () => {
    const denied = await call('/v1/search-market', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(denied.status).toBe(403);
    expect(denied.json.error?.code).toBe('FORBIDDEN_ORIGIN');
    expect(denied.response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const noOrigin = await call('/v1/search-market', { method: 'OPTIONS' });
    expect(noOrigin.status).toBe(403);
  });

  it('403 FORBIDDEN_ORIGIN para solicitudes con un Origin no permitido', async () => {
    for (const origin of ['https://evil.example', 'chrome-extension://otra', 'null']) {
      const { status, json, response } = await call('/v1/health', { headers: { Origin: origin } });
      expect(status).toBe(403);
      expect(json.error?.code).toBe('FORBIDDEN_ORIGIN');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('con ALLOWED_ORIGINS vacío rechaza cualquier Origin', async () => {
    const { status } = await call('/v1/health', { headers: { Origin: EXTENSION_ORIGIN }, env: makeEnv({ ALLOWED_ORIGINS: '' }) });
    expect(status).toBe(403);
  });

  it('admite varios orígenes separados por comas y añade CORS a la respuesta', async () => {
    const env = makeEnv({ ALLOWED_ORIGINS: ` https://otro.example , ${EXTENSION_ORIGIN} ` });
    const { status, response } = await call('/v1/health', { headers: { Origin: EXTENSION_ORIGIN }, env });
    expect(status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(EXTENSION_ORIGIN);
  });

  it('las solicitudes sin Origin (curl) pasan a los demás controles', async () => {
    const { status, response } = await call('/v1/health');
    expect(status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('los errores a un origen permitido también llevan CORS', async () => {
    const { status, response } = await call('/v1/nada', { headers: { Origin: EXTENSION_ORIGIN } });
    expect(status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(EXTENSION_ORIGIN);
  });
});

describe('código de acceso', () => {
  const env = makeEnv({ ACCESS_CODE: 'demo-2026' });
  const body = { queries: ['audífonos'], market: 'CO' };

  it('401 ACCESS_DENIED sin cabecera o con código incorrecto', async () => {
    const attempts: Array<Record<string, string>> = [{}, { 'X-ProductRadar-Access': 'demo-2025' }, { 'X-ProductRadar-Access': 'demo-2026x' }];
    for (const headers of attempts) {
      const { status, json } = await call('/v1/search-market', { body, headers, env });
      expect(status).toBe(401);
      expect(json.error?.code).toBe('ACCESS_DENIED');
      expect(JSON.stringify(json)).not.toContain('demo-2026');
    }
  });

  it('acepta el código correcto (luego aplica validación normal)', async () => {
    const { status, json } = await call('/v1/search-market', { body: { queries: [], market: 'CO' }, headers: { 'X-ProductRadar-Access': 'demo-2026' }, env });
    expect(status).toBe(400);
    expect(json.error?.code).toBe('BAD_REQUEST');
  });
});
