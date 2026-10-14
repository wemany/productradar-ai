import { SearchAlibabaResponseSchema, SearchMarketResponseSchema } from '@productradar/core';
import { describe, expect, it, vi } from 'vitest';
import { buildAlibabaSiteQuery } from '../src/routes/search';
import { braveBody, call, fetchedHosts, jsonReply, makeEnv, mockFetch } from './helpers';

// Con `makeEnv()` (solo BRAVE_API_KEY) el gateway usa Brave; con TAVILY_API_KEY, Tavily.
const TAVILY_KEY = 'tvly-test-key';

function tavilyBody(results: Array<{ title: string; url: string; content?: string }>) {
  return { query: 'x', results: results.map((r) => ({ content: `Descripción de ${r.title}`, score: 0.8, ...r })), response_time: 0.9 };
}

function sentBody(fetchMock: ReturnType<typeof mockFetch>, index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index]?.[1]?.body)) as Record<string, unknown>;
}

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

  it('con Tavily solo llama a api.tavily.com', async () => {
    const fetchMock = mockFetch(() => jsonReply(tavilyBody([{ title: 'x', url: 'https://www.alibaba.com/product-detail/x.html' }])));
    const env = makeEnv({ TAVILY_API_KEY: TAVILY_KEY });
    await call('/v1/search-market', { body: { queries: ['https://evil.example/robar', 'audífonos'], market: 'CO' }, env });
    await call('/v1/search-alibaba', { body: { query: 'http://localhost:8080/admin', market: 'PE' }, env });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(fetchedHosts(fetchMock))).toEqual(new Set(['api.tavily.com']));
  });
});

describe('Tavily (SEARCH_PROVIDER / TAVILY_API_KEY)', () => {
  const env = makeEnv({ TAVILY_API_KEY: TAVILY_KEY });

  it('con su clave es el buscador por defecto: POST con Bearer y country del mercado', async () => {
    const fetchMock = mockFetch(() => jsonReply(tavilyBody([{ title: 'Licuadora', url: 'https://tienda.com.mx/p/1', content: 'Licuadora <b>600 W</b> a $ 899' }])));
    const { status, json } = await call('/v1/search-market', { body: { queries: ['licuadora'], market: 'MX', count: 5 }, env });
    expect(status).toBe(200);
    const first = SearchMarketResponseSchema.parse(json).results[0];
    expect(first?.items?.[0]).toMatchObject({ title: 'Licuadora', url: 'https://tienda.com.mx/p/1', snippet: 'Licuadora 600 W a $ 899' });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.tavily.com/search');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TAVILY_KEY}`);
    expect(sentBody(fetchMock)).toMatchObject({ query: 'licuadora', topic: 'general', search_depth: 'basic', max_results: 5, country: 'mexico', include_answer: false });
    expect(String(init?.body)).not.toContain(TAVILY_KEY);
    expect(JSON.stringify(json)).not.toContain(TAVILY_KEY);
  });

  it('SEARCH_PROVIDER=brave usa Brave aunque exista la clave de Tavily', async () => {
    const fetchMock = mockFetch(() => jsonReply(braveBody([])));
    await call('/v1/search-market', { body: { queries: ['x'], market: 'CO' }, env: makeEnv({ TAVILY_API_KEY: TAVILY_KEY, SEARCH_PROVIDER: 'brave' }) });
    expect(fetchedHosts(fetchMock)).toEqual(['api.search.brave.com']);
  });

  it('SEARCH_PROVIDER=tavily sin su clave → 503 NOT_CONFIGURED (no cae a Brave)', async () => {
    const fetchMock = mockFetch(() => jsonReply(braveBody([])));
    const { status, json } = await call('/v1/search-market', { body: { queries: ['x'], market: 'CO' }, env: makeEnv({ SEARCH_PROVIDER: 'tavily' }) });
    expect(status).toBe(503);
    expect(json.error?.code).toBe('NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Alibaba: include_domains en lugar de site: y filtro por dominio', async () => {
    const fetchMock = mockFetch(() =>
      jsonReply(
        tavilyBody([
          { title: 'Proveedor', url: 'https://www.alibaba.com/product-detail/earbuds_1.html' },
          { title: 'Otro', url: 'https://evil.example/alibaba.com' },
        ]),
      ),
    );
    const { status, json } = await call('/v1/search-alibaba', { body: { query: 'wireless earbuds site:evil.example', market: 'CO' }, env });
    expect(status).toBe(200);
    expect(SearchAlibabaResponseSchema.parse(json).items.map((i) => i.title)).toEqual(['Proveedor']);
    expect(sentBody(fetchMock)).toMatchObject({ query: 'wireless earbuds', include_domains: ['alibaba.com'], country: 'colombia' });
  });

  it.each([
    [432, 'QUOTA_EXCEEDED'],
    [433, 'QUOTA_EXCEEDED'],
    [429, 'RATE_LIMITED'],
  ])('Tavily HTTP %i → %s por consulta', async (upstream, code) => {
    mockFetch(() => jsonReply({ detail: { error: 'mensaje remoto' } }, upstream));
    const { status, json } = await call('/v1/search-market', { body: { queries: ['x'], market: 'CO' }, env });
    expect(status).toBe(200);
    const first = SearchMarketResponseSchema.parse(json).results[0];
    expect([first?.ok, first?.error?.code]).toEqual([false, code]);
    expect(JSON.stringify(json)).not.toContain('mensaje remoto');
  });

  it('clave rechazada por Tavily → NOT_CONFIGURED sin detalles', async () => {
    mockFetch(() => jsonReply({ detail: { error: 'Unauthorized: missing or invalid API key.' } }, 401));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { json } = await call('/v1/search-market', { body: { queries: ['x'], market: 'CO' }, env });
    const first = SearchMarketResponseSchema.parse(json).results[0];
    expect(first?.error?.code).toBe('NOT_CONFIGURED');
    expect(first?.error?.message).not.toMatch(/clave|key|token/i);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain('TAVILY_API_KEY');
  });
});

describe('includeDomains (menciones públicas en redes)', () => {
  const socialBody = { queries: ['"Licuadora Oster"'], market: 'CO', includeDomains: ['facebook.com', 'instagram.com', 'tiktok.com'] };
  const mixed = [
    { title: 'Post', url: 'https://www.facebook.com/oster/posts/1' },
    { title: 'Reel', url: 'https://www.instagram.com/reel/abc' },
    { title: 'Tienda', url: 'https://tienda.com.co/p/oster' },
    { title: 'Falso', url: 'https://facebook.com.evil.example/p' },
  ];

  it('Brave: añade los operadores site: y devuelve solo resultados de esas redes', async () => {
    const fetchMock = mockFetch(() => jsonReply(braveBody(mixed)));
    const { status, json } = await call('/v1/search-market', { body: socialBody });
    expect(status).toBe(200);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe('"Licuadora Oster" (site:facebook.com OR site:instagram.com OR site:tiktok.com)');
    expect(SearchMarketResponseSchema.parse(json).results[0]?.items?.map((i) => i.title)).toEqual(['Post', 'Reel']);
  });

  it('Tavily: los envía como include_domains', async () => {
    const fetchMock = mockFetch(() => jsonReply(tavilyBody(mixed)));
    const { json } = await call('/v1/search-market', { body: socialBody, env: makeEnv({ TAVILY_API_KEY: TAVILY_KEY }) });
    expect(sentBody(fetchMock)).toMatchObject({ query: '"Licuadora Oster"', include_domains: ['facebook.com', 'instagram.com', 'tiktok.com'] });
    expect(SearchMarketResponseSchema.parse(json).results[0]?.items?.map((i) => i.title)).toEqual(['Post', 'Reel']);
  });

  it.each([[['evil.example']], [['alibaba.com']], [['facebook.com', 'x.com']], [[]], ['facebook.com']])('400 con dominios fuera de la lista fija: %j', async (includeDomains) => {
    const fetchMock = mockFetch(() => jsonReply(braveBody([])));
    const { status, json } = await call('/v1/search-market', { body: { ...socialBody, includeDomains } });
    expect(status).toBe(400);
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('la caché distingue búsquedas con y sin includeDomains', async () => {
    const store = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        match: async (key: string) => store.get(key)?.clone(),
        put: async (key: string, response: Response) => void store.set(key, response),
      },
    });
    const fetchMock = mockFetch(() => jsonReply(braveBody(mixed)));
    await call('/v1/search-market', { body: socialBody });
    await call('/v1/search-market', { body: { queries: socialBody.queries, market: 'CO' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
