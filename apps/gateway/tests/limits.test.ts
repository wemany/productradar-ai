import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlidingWindowLimiter, clientIpKey, resetRateLimitState } from '../src/security/rate-limit';
import { usageKey } from '../src/security/quota';
import { constantTimeEqual } from '../src/security/access';
import { braveBody, call, fakeKv, jsonReply, makeEnv, mockFetch } from './helpers';

beforeEach(() => resetRateLimitState());

describe('límite de frecuencia', () => {
  it('429 RATE_LIMITED con Retry-After al superar el límite por IP', async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MINUTE: '3' });
    const headers = { 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 3; i++) expect((await call('/v1/health', { headers, env })).status).toBe(200);
    const { status, json, response } = await call('/v1/health', { headers, env });
    expect(status).toBe(429);
    expect(json.error?.code).toBe('RATE_LIMITED');
    const retry = Number(response.headers.get('Retry-After'));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
    // Otra IP no se ve afectada.
    expect((await call('/v1/health', { headers: { 'CF-Connecting-IP': '203.0.113.8' }, env })).status).toBe(200);
  });

  it('se aplica antes del código de acceso (frena intentos de adivinarlo)', async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MINUTE: '2', ACCESS_CODE: 'secreto' });
    const opts = { body: { queries: ['x'], market: 'CO' }, headers: { 'CF-Connecting-IP': '198.51.100.1', 'X-ProductRadar-Access': 'intento' }, env };
    expect((await call('/v1/search-market', opts)).status).toBe(401);
    expect((await call('/v1/search-market', opts)).status).toBe(401);
    expect((await call('/v1/search-market', opts)).status).toBe(429);
  });

  it('limita también por id de instalación aunque cambie la IP', async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MINUTE: '2' });
    const install = 'b3c1f0a2-7d4e-4c1b-9a8f-0123456789ab';
    for (const ip of ['192.0.2.1', '192.0.2.2']) {
      expect((await call('/v1/health', { headers: { 'CF-Connecting-IP': ip, 'X-ProductRadar-Install': install }, env })).status).toBe(200);
    }
    const { status } = await call('/v1/health', { headers: { 'CF-Connecting-IP': '192.0.2.3', 'X-ProductRadar-Install': install }, env });
    expect(status).toBe(429);
  });

  it('400 con un id de instalación mal formado', async () => {
    for (const install of ['corto', 'con espacios 12345', 'x'.repeat(65), '../../etc']) {
      const { status, json } = await call('/v1/health', { headers: { 'X-ProductRadar-Install': install } });
      expect(status).toBe(400);
      expect(json.error?.code).toBe('BAD_REQUEST');
    }
  });

  it('usa el binding RATE_LIMITER cuando existe', async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({ success: !key.startsWith('ip:') }));
    const { status, response } = await call('/v1/health', { headers: { 'CF-Connecting-IP': '203.0.113.50' }, env: makeEnv({ RATE_LIMITER: { limit } }) });
    expect(status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(limit).toHaveBeenCalledWith({ key: 'ip:203.0.113.50' });
  });

  it('si el binding falla, sigue con el límite en memoria', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const limit = vi.fn(async () => {
      throw new Error('binding caído');
    });
    expect((await call('/v1/health', { env: makeEnv({ RATE_LIMITER: { limit } }) })).status).toBe(200);
  });

  it('agrupa IPv6 por /64', () => {
    const req = (ip: string) => new Request('https://x.test', { headers: { 'CF-Connecting-IP': ip } });
    expect(clientIpKey(req('2001:db8:abcd:12:1::5'))).toBe('2001:db8:abcd:12::/64');
    expect(clientIpKey(req('2001:0db8:abcd:0012:ffff:0:0:1'))).toBe('2001:db8:abcd:12::/64');
    expect(clientIpKey(req('2001:db8::1'))).toBe('2001:db8:0:0::/64');
    expect(clientIpKey(req('203.0.113.9'))).toBe('203.0.113.9');
    expect(clientIpKey(req(''))).toBe('unknown');
  });

  it('la ventana deslizante libera cupo al pasar el tiempo', () => {
    const limiter = new SlidingWindowLimiter(60_000, 2);
    expect(limiter.hit('a', 2, 0)).toBe(0);
    expect(limiter.hit('a', 2, 10_000)).toBe(0);
    expect(limiter.hit('a', 2, 20_000)).toBe(40);
    expect(limiter.hit('a', 2, 60_001)).toBe(0);
    // Memoria acotada: con maxKeys = 2 se descarta la clave más antigua.
    limiter.hit('b', 2, 60_002);
    limiter.hit('c', 2, 60_003);
    expect(limiter.hit('a', 1, 60_004)).toBe(0);
  });
});

describe('presupuesto diario de búsquedas (KV)', () => {
  it('cuenta llamadas reales a Brave y devuelve 429 QUOTA_EXCEEDED al agotarse', async () => {
    const kv = fakeKv();
    const env = makeEnv({ USAGE_KV: kv, DAILY_SEARCH_LIMIT: '3' });
    const fetchMock = mockFetch(() => jsonReply(braveBody([{ title: 'x', url: 'https://x.com.co/p' }])));
    expect((await call('/v1/search-market', { body: { queries: ['a', 'b'], market: 'CO' }, env })).status).toBe(200);
    expect(kv.store.get(usageKey('search'))).toBe('2');
    // 2 usadas + 2 pedidas > 3 → se rechaza sin llamar a Brave.
    const { status, json } = await call('/v1/search-market', { body: { queries: ['c', 'd'], market: 'CO' }, env });
    expect(status).toBe(429);
    expect(json.error?.code).toBe('QUOTA_EXCEEDED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await call('/v1/search-alibaba', { body: { query: 'earbuds', market: 'CO' }, env })).status).toBe(200);
    expect(kv.store.get(usageKey('search'))).toBe('3');
    expect((await call('/v1/search-alibaba', { body: { query: 'earbuds', market: 'CO' }, env })).status).toBe(429);
  });

  it('sin USAGE_KV no se aplica (mejor esfuerzo)', async () => {
    mockFetch(() => jsonReply(braveBody([])));
    const env = makeEnv({ DAILY_SEARCH_LIMIT: '0' });
    expect((await call('/v1/search-market', { body: { queries: ['a'], market: 'CO' }, env })).status).toBe(200);
  });
});

describe('comparación en tiempo constante', () => {
  it('compara por contenido, no por longitud', async () => {
    expect(await constantTimeEqual('abc', 'abc')).toBe(true);
    expect(await constantTimeEqual('abc', 'abd')).toBe(false);
    expect(await constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(await constantTimeEqual('', 'a')).toBe(false);
  });
});
