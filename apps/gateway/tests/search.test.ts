import { SearchAlibabaResponseSchema, SearchMarketResponseSchema } from '@productradar/core';
import { describe, expect, it, vi } from 'vitest';
import { buildAlibabaSiteQuery } from '../src/routes/search';
import { braveBody, call, fetchedHosts, jsonReply, makeEnv, mockFetch } from './helpers';

describe('POST /v1/search-market', () => {
  it('mapea la respuesta de Brave al contrato de la API', async () => {
    const fetchMock = mockFetch(() =>
      jsonReply(braveBody([{ title: 'Audífonos XYZ - Tienda', url: 'https://tienda.com.co/audifonos-xyz', description: 'Audífonos <b>XYZ</b> a $ 129.900' }])),
    );
    const { status, json } = await call('/v1/search-market', { body: { queries: ['audífonos xyz'], market: 'CO' } });
    expect(status).toBe(200);
    const parsed = SearchMarketResponseSchema.parse(json);
    expect(parsed.results).toHaveLength(1);
    const first = parsed.results[0];
    expect(first?.ok).toBe(true);
    expect(first?.query).toBe('audífonos xyz');
    expect(first?.items?.[0]).toMatchObject({
      title: 'Audífonos XYZ - Tienda',
      url: 'https://tienda.com.co/audifonos-xyz',
      publisherName: 'Tienda Ejemplo',
      extraSnippets: ['Envío gratis', 'Precio $ 129.900'],
    });
    expect(first?.items?.[0]?.snippet).toContain('129.900');

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search');
    expect(url.searchParams.get('q')).toBe('audífonos xyz');
    expect(url.searchParams.get('count')).toBe('10');
    expect(url.searchParams.get('country')).toBe('ALL');
    expect(url.searchParams.get('search_lang')).toBe('es');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('test-brave-key');
  });

  it('usa count y la configuración del mercado indicados', async () => {
    const fetchMock = mockFetch(() => jsonReply(braveBody([])));
    await call('/v1/search-market', { body: { queries: ['licuadora'], market: 'MX', count: 5 } });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('count')).toBe('5');
    expect(url.searchParams.get('country')).toBe('MX');
  });

  it('aísla errores por consulta (Brave 429 → ok:false RATE_LIMITED)', async () => {
    mockFetch((url) => {
      const q = url.searchParams.get('q');
      if (q === 'falla') return new Response('{"error":"secreto upstream"}', { status: 429 });
      if (q === 'roto') return new Response('<html>no json</html>', { status: 200 });
      return jsonReply(braveBody([{ title: 'Ok', url: 'https://ok.com.co/p' }]));
    });
    const { status, json } = await call('/v1/search-market', { body: { queries: ['bien', 'falla', 'roto'], market: 'CO' } });
    expect(status).toBe(200);
    const { results } = SearchMarketResponseSchema.parse(json);
    expect(results.map((r) => [r.query, r.ok, r.error?.code])).toEqual([
      ['bien', true, undefined],
      ['falla', false, 'RATE_LIMITED'],
      ['roto', false, 'UPSTREAM'],
    ]);
    expect(JSON.stringify(json)).not.toContain('secreto upstream');
  });

  it('una clave rechazada por Brave se informa como configuración del servidor, sin detalles', async () => {
    mockFetch(() => new Response('{}', { status: 401 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { json } = await call('/v1/search-market', { body: { queries: ['x'], market: 'CO' } });
    const first = SearchMarketResponseSchema.parse(json).results[0];
    expect(first?.ok).toBe(false);
    expect(first?.error?.code).toBe('NOT_CONFIGURED');
    expect(first?.error?.message).not.toMatch(/clave|key|token/i);
  });

  it('503 NOT_CONFIGURED sin BRAVE_API_KEY (sin llamar a Brave)', async () => {
    const fetchMock = mockFetch(() => jsonReply(braveBody([])));
    const { status, json } = await call('/v1/search-market', { body: { queries: ['x'], market: 'CO' }, env: makeEnv({ BRAVE_API_KEY: undefined }) });
    expect(status).toBe(503);
    expect(json.error?.code).toBe('NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('descarta resultados que no cumplen el contrato y recorta campos', async () => {
    mockFetch(() =>
      jsonReply({
        web: {
          results: [
            { title: 'Largo', url: `https://a.com/${'x'.repeat(2100)}`, description: 'x' },
            { title: 'FTP', url: 'ftp://a.com/file', description: 'x' },
            { title: 'Bueno', url: 'https://b.com/p', description: 'x', age: 'y'.repeat(300), product: { name: 'P', gtin13: 'no-es-un-gtin-valido-123' } },
          ],
        },
      }),
    );
    const { json } = await call('/v1/search-market', { body: { queries: ['x'], market: 'CO' } });
    const items = SearchMarketResponseSchema.parse(json).results[0]?.items ?? [];
    expect(items.map((i) => i.title)).toEqual(['Bueno']);
    expect(items[0]?.age).toHaveLength(100);
    expect(items[0]?.structuredProduct?.gtin).toBeUndefined();
  });

  it('usa caches.default cuando existe (6 h) y no repite la llamada a Brave', async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (key: string) => store.get(key)?.clone(),
        put: async (key: string, response: Response) => void store.set(key, response),
      },
    });
    const fetchMock = mockFetch(() => jsonReply(braveBody([{ title: 'Cacheado', url: 'https://c.com/p' }])));
    const body = { queries: ['producto en caché'], market: 'CO' };
    const first = await call('/v1/search-market', { body });
    const second = await call('/v1/search-market', { body });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.json).toEqual(first.json);
    const [key, cached] = [...store.entries()][0] ?? [];
    expect(key).toMatch(/^https:\/\/gateway\.test\/__cache\/brave\/[0-9a-f]{64}$/);
    expect(cached?.headers.get('Cache-Control')).toBe('public, max-age=21600');
    // Otro mercado u otro count es otra clave.
    await call('/v1/search-market', { body: { ...body, market: 'MX' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /v1/search-alibaba', () => {
  it('fuerza site:alibaba.com y elimina otros operadores site:', () => {
    expect(buildAlibabaSiteQuery('site:alibaba.com wireless earbuds')).toBe('site:alibaba.com wireless earbuds');
    expect(buildAlibabaSiteQuery('earbuds site:evil.com -site:alibaba.com SITE:x.org')).toBe('site:alibaba.com earbuds');
    expect(buildAlibabaSiteQuery('earbuds OR site:evil.com | (site:a.com)')).toBe('site:alibaba.com earbuds');
    expect(buildAlibabaSiteQuery('website:builder kit')).toBe('site:alibaba.com website:builder kit');
    expect(() => buildAlibabaSiteQuery('site:evil.com')).toThrow();
  });

  it('envía la consulta forzada a Brave y filtra por dominio con isAlibabaUrl', async () => {
    const fetchMock = mockFetch(() =>
      jsonReply(
        braveBody([
          { title: 'Proveedor 1', url: 'https://www.alibaba.com/product-detail/earbuds_1600.html' },
          { title: 'Proveedor 2', url: 'https://alibaba.com/showroom/earbuds.html' },
          { title: 'AliExpress', url: 'https://es.aliexpress.com/item/1.html' },
          { title: 'Falso', url: 'https://alibaba.com.evil.example/p' },
          { title: 'Sin TLS', url: 'http://www.alibaba.com/p' },
          { title: 'Otro', url: 'https://evil.example/alibaba.com' },
        ]),
      ),
    );
    const { status, json } = await call('/v1/search-alibaba', { body: { query: 'wireless earbuds site:evil.example', market: 'CO' } });
    expect(status).toBe(200);
    const { items } = SearchAlibabaResponseSchema.parse(json);
    expect(items.map((i) => i.title)).toEqual(['Proveedor 1', 'Proveedor 2']);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe('site:alibaba.com wireless earbuds');
  });

  it('400 si la consulta queda vacía tras quitar operadores', async () => {
    const fetchMock = mockFetch(() => jsonReply(braveBody([])));
    const { status } = await call('/v1/search-alibaba', { body: { query: 'site:evil.example', market: 'CO' } });
    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propaga errores de Brave como HTTP con código', async () => {
    mockFetch(() => new Response('', { status: 429 }));
    const { status, json, response } = await call('/v1/search-alibaba', { body: { query: 'earbuds', market: 'CO' } });
    expect(status).toBe(429);
    expect(json.error?.code).toBe('RATE_LIMITED');
    expect(response.headers.get('Retry-After')).toBe('60');
  });
});

describe('no es un proxy abierto', () => {
  it('solo llama a api.search.brave.com aunque las consultas contengan URLs', async () => {
    const fetchMock = mockFetch(() => jsonReply(braveBody([{ title: 'x', url: 'https://www.alibaba.com/product-detail/x.html' }])));
    await call('/v1/search-market', {
      body: { queries: ['https://evil.example/robar', 'http://169.254.169.254/latest/meta-data', 'audífonos'], market: 'CO' },
    });
    await call('/v1/search-alibaba', { body: { query: 'http://localhost:8080/admin site:127.0.0.1', market: 'PE' } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Set(fetchedHosts(fetchMock))).toEqual(new Set(['api.search.brave.com']));
  });
});
