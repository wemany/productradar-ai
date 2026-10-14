import { API_LIMITS } from '@productradar/core';
import { describe, expect, it } from 'vitest';
import { BASE, call, mockFetch, send } from './helpers';

describe('validación del cuerpo', () => {
  it('415 si el Content-Type no es JSON', async () => {
    const { status, json } = await call('/v1/search-market', {
      raw: JSON.stringify({ queries: ['x'], market: 'CO' }),
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(status).toBe(415);
    expect(json.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('acepta application/json con charset', async () => {
    mockFetch(() => new Response(JSON.stringify({ web: { results: [] } }), { headers: { 'Content-Type': 'application/json' } }));
    const { status } = await call('/v1/search-market', {
      raw: JSON.stringify({ queries: ['x'], market: 'CO' }),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(status).toBe(200);
  });

  it('413 por Content-Length antes de leer el cuerpo', async () => {
    const { status, json } = await call('/v1/identify-image', {
      raw: '{}',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(API_LIMITS.maxBodyBytes + 1) },
    });
    expect(status).toBe(413);
    expect(json.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('413 también al leer, aunque no haya Content-Length', async () => {
    const big = JSON.stringify({ imageBase64: 'A'.repeat(API_LIMITS.maxBodyBytes + 10), mimeType: 'image/jpeg', market: 'CO' });
    const { status } = await call('/v1/identify-image', { raw: big, headers: { 'Content-Type': 'application/json' } });
    expect(status).toBe(413);
  });

  it('corta la lectura de un cuerpo en streaming sin Content-Length', async () => {
    const chunk = new TextEncoder().encode('a'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > API_LIMITS.maxBodyBytes * 4) return controller.close();
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      },
    });
    const init = { method: 'POST', body: stream, headers: { 'Content-Type': 'application/json' }, duplex: 'half' };
    const request = new Request(`${BASE}/v1/identify-image`, init as RequestInit);
    expect(request.headers.get('Content-Length')).toBeNull();
    const { status } = await send(request);
    expect(status).toBe(413);
    expect(sent).toBeLessThan(API_LIMITS.maxBodyBytes * 2);
  });

  it('las búsquedas tienen un límite de cuerpo mucho menor', async () => {
    const { status } = await call('/v1/search-market', { body: { queries: ['x'], market: 'CO', padding: 'x'.repeat(40_000) } });
    expect(status).toBe(413);
  });

  it('400 con JSON inválido', async () => {
    const { status, json } = await call('/v1/search-market', { raw: '{"queries": [', headers: { 'Content-Type': 'application/json' } });
    expect(status).toBe(400);
    expect(json.error).toEqual({ code: 'BAD_REQUEST', message: 'El cuerpo no es JSON válido' });
  });

  it('400 con mensaje breve en español cuando falla el esquema', async () => {
    const cases = [
      { queries: [], market: 'CO' },
      { queries: Array.from({ length: 7 }, (_, i) => `q${i}`), market: 'CO' },
      { queries: ['x'], market: 'AR' },
      { queries: ['x'.repeat(301)], market: 'CO' },
      { queries: ['x'], market: 'CO', count: 50 },
    ];
    for (const body of cases) {
      const { status, json } = await call('/v1/search-market', { body });
      expect(status).toBe(400);
      expect(json.error?.code).toBe('BAD_REQUEST');
      expect(json.error?.message).toMatch(/^Solicitud inválida/);
      expect(json.error?.message).not.toMatch(/at |Error:|ZodError/);
    }
  });
});
