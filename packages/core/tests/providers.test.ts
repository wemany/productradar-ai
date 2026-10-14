import { describe, expect, it, vi } from 'vitest';
import { MARKET_CONFIGS } from '../src/markets';
import { braveQueryWithDomains, braveWebSearch, buildBraveUrl, mapBraveResponse } from '../src/providers/brave';
import { parseVisionText, visionResultToIdentity, VISION_JSON_SCHEMA } from '../src/providers/anthropic-vision';
import { GatewaySearchProvider, normalizeGatewayUrl } from '../src/providers/gateway-client';
import { buildTavilyBody, mapTavilyResponse, tavilySearch, TavilySearchProvider } from '../src/providers/tavily';
import { SearchProviderError, type SearchInput } from '../src/research';
import { SearchMarketRequestSchema, VisionResultSchema } from '../src/api';
import { SOCIAL_MENTION_DOMAINS } from '../src/ads';

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function tavilyFetch(response: () => Response): FetchMock {
  return vi.fn(async () => response());
}

function lastCall(fetchImpl: FetchMock): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchImpl.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

const marketInput = (partial: Partial<SearchInput> = {}): SearchInput => ({ query: 'sony xm5 Colombia', market: MARKET_CONFIGS.CO, count: 10, purpose: 'MARKET', ...partial });

describe('Tavily Search', () => {
  it('construye el cuerpo documentado: topic general, búsqueda básica, sin respuesta IA ni contenido crudo', () => {
    expect(buildTavilyBody(marketInput({ count: 50 }))).toEqual({
      query: 'sony xm5 Colombia',
      topic: 'general',
      search_depth: 'basic',
      max_results: 20,
      country: 'colombia',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    });
  });

  it.each([
    ['CO', 'colombia'],
    ['MX', 'mexico'],
    ['PE', 'peru'],
    ['CL', 'chile'],
  ] as const)('mercado %s → country=%s', (code, country) => {
    expect(buildTavilyBody(marketInput({ market: MARKET_CONFIGS[code] })).country).toBe(country);
  });

  it('SUPPLIER: quita site: de la consulta y restringe con include_domains a alibaba.com', () => {
    const body = buildTavilyBody(marketInput({ query: 'site:alibaba.com wireless earbuds OR site:evil.example', purpose: 'SUPPLIER' }));
    expect(body.query).toBe('wireless earbuds');
    expect(body.include_domains).toEqual(['alibaba.com']);
  });

  it('includeDomains explícito se envía como include_domains', () => {
    const body = buildTavilyBody(marketInput({ query: '"Sony WH-1000XM5"', purpose: 'SOCIAL', includeDomains: [...SOCIAL_MENTION_DOMAINS] }));
    expect(body.query).toBe('"Sony WH-1000XM5"');
    expect(body.include_domains).toEqual(['facebook.com', 'instagram.com', 'tiktok.com']);
    expect(buildTavilyBody(marketInput()).include_domains).toBeUndefined();
  });

  it('mapea resultados (title, url, content) limpiando HTML y descarta entradas inválidas', () => {
    const items = mapTavilyResponse({
      query: 'x',
      results: [
        { title: 'Sony <b>XM5</b>', url: 'https://tienda.com.co/p/1', content: `Precio $ 1.299.900 ${'a'.repeat(1200)}`, score: 0.91 },
        { title: 'Sin URL', content: 'x' },
        { url: 'https://otra.com.co/p/2', content: null },
      ],
      response_time: 1.2,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Sony XM5', url: 'https://tienda.com.co/p/1' });
    expect(items[0]?.snippet.startsWith('Precio $ 1.299.900')).toBe(true);
    expect(items[0]?.snippet.length).toBeLessThanOrEqual(1000);
    expect(items[1]).toMatchObject({ title: '', snippet: '' });
    expect(mapTavilyResponse({ query: 'x' })).toEqual([]);
    expect(() => mapTavilyResponse({ results: 'no' })).toThrow(SearchProviderError);
  });

  it('envía la clave solo en la cabecera Authorization (POST JSON), nunca en la URL ni en el cuerpo', async () => {
    const fetchImpl = tavilyFetch(() => new Response(JSON.stringify({ query: 'x', results: [] }), { status: 200 }));
    await tavilySearch({ apiKey: 'tvly-SECRETO', fetchImpl: fetchImpl as unknown as typeof fetch }, marketInput());
    const { url, init } = lastCall(fetchImpl);
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tvly-SECRETO');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(url).not.toContain('SECRETO');
    expect(String(init.body)).not.toContain('SECRETO');
  });

  it.each([
    [401, { detail: { error: 'Unauthorized: missing or invalid API key.' } }, 'UNAUTHORIZED'],
    [403, {}, 'FORBIDDEN'],
    [429, { detail: { error: 'Your request has been blocked due to excessive requests. Please reduce the rate of requests.' } }, 'RATE_LIMITED'],
    [429, { detail: { error: "This request exceeds your plan's set usage limit." } }, 'QUOTA'],
    [432, { detail: { error: "This request exceeds your plan's set usage limit. Please upgrade your plan" } }, 'QUOTA'],
    [433, { detail: { error: 'This request exceeds the pay-as-you-go limit.' } }, 'QUOTA'],
    [400, { detail: { error: 'Invalid topic.' } }, 'BAD_RESPONSE'],
    [500, { detail: { error: 'Internal Server Error' } }, 'UPSTREAM'],
    [503, null, 'UPSTREAM'],
  ])('HTTP %i → %s', async (status, body, code) => {
    const fetchImpl = tavilyFetch(() => new Response(body === null ? 'no json' : JSON.stringify(body), { status }));
    await expect(tavilySearch({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }, marketInput())).rejects.toMatchObject({ code, status });
  });

  it('respuesta que no es JSON → BAD_RESPONSE; red caída → NETWORK; sin respuesta → TIMEOUT', async () => {
    const notJson = tavilyFetch(() => new Response('<html>', { status: 200 }));
    await expect(tavilySearch({ apiKey: 'k', fetchImpl: notJson as unknown as typeof fetch }, marketInput())).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(tavilySearch({ apiKey: 'k', fetchImpl: down as unknown as typeof fetch }, marketInput())).rejects.toMatchObject({ code: 'NETWORK' });
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')))),
    );
    await expect(tavilySearch({ apiKey: 'k', fetchImpl: hang as unknown as typeof fetch, timeoutMs: 10 }, marketInput())).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('sin clave → NOT_CONFIGURED sin llamar a la red', async () => {
    const fetchImpl = tavilyFetch(() => new Response('{}'));
    await expect(tavilySearch({ apiKey: '', fetchImpl: fetchImpl as unknown as typeof fetch }, marketInput())).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('TavilySearchProvider expone id y etiqueta estables', async () => {
    const fetchImpl = tavilyFetch(() => new Response(JSON.stringify({ results: [{ title: 'A', url: 'https://a.com.co/p', content: 'x' }] }), { status: 200 }));
    const provider = new TavilySearchProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(provider.id).toBe('tavily-direct');
    expect(provider.label).toBe('Tavily Search API (clave propia)');
    expect(await provider.search(marketInput())).toHaveLength(1);
  });
});

describe('Brave Search', () => {
  it('Colombia usa country=ALL (Brave no admite CO) con idioma español', () => {
    const url = new URL(buildBraveUrl({ query: 'sony xm5 Colombia', market: MARKET_CONFIGS.CO, count: 10 }));
    expect(url.searchParams.get('country')).toBe('ALL');
    expect(url.searchParams.get('search_lang')).toBe('es');
    expect(url.searchParams.get('text_decorations')).toBe('false');
  });

  it('Chile y México usan su código de país', () => {
    expect(new URL(buildBraveUrl({ query: 'x', market: MARKET_CONFIGS.CL, count: 5 })).searchParams.get('country')).toBe('CL');
    expect(new URL(buildBraveUrl({ query: 'x', market: MARKET_CONFIGS.MX, count: 5 })).searchParams.get('ui_lang')).toBe('es-MX');
  });

  it('mapea resultados web y datos de producto, limpiando HTML', () => {
    const items = mapBraveResponse({
      web: {
        results: [
          {
            title: 'Sony <strong>XM5</strong>',
            url: 'https://tienda.com.co/p/1',
            description: 'Precio $ 1.299.900',
            extra_snippets: ['Envío gratis'],
            profile: { name: 'Tienda' },
            product: { name: 'Sony XM5', offers: [{ price: '1299900', priceCurrency: 'cop' }] },
          },
          { notAResult: true },
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Sony XM5', publisherName: 'Tienda', structuredProduct: { price: '1299900', currency: 'COP' } });
  });

  it('respuesta sin bloque web → lista vacía', () => {
    expect(mapBraveResponse({ type: 'search' })).toEqual([]);
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'],
    [503, 'UPSTREAM'],
  ])('HTTP %i → %s', async (status, code) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status }));
    await expect(
      braveWebSearch({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }, { query: 'x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'MARKET' }),
    ).rejects.toMatchObject({ code });
  });

  it('HTTP 422 con SUBSCRIPTION_TOKEN_INVALID → UNAUTHORIZED (clave inválida)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'SUBSCRIPTION_TOKEN_INVALID', status: 422 } }), { status: 422 }));
    await expect(
      braveWebSearch({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }, { query: 'x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'MARKET' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('envía la clave solo en la cabecera, nunca en la URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ web: { results: [] } }), { status: 200 }));
    await braveWebSearch({ apiKey: 'SECRETO', fetchImpl: fetchImpl as unknown as typeof fetch }, { query: 'x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'MARKET' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('SECRETO');
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('SECRETO');
  });

  it('sin clave → NOT_CONFIGURED', async () => {
    await expect(braveWebSearch({ apiKey: '' }, { query: 'x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'MARKET' })).rejects.toBeInstanceOf(SearchProviderError);
  });

  it('includeDomains → operadores site: al final de la consulta (Brave no tiene parámetro de dominios)', () => {
    const q = new URL(buildBraveUrl({ query: '"Sony WH-1000XM5"', market: MARKET_CONFIGS.CO, count: 10, includeDomains: [...SOCIAL_MENTION_DOMAINS] })).searchParams.get('q');
    expect(q).toBe('"Sony WH-1000XM5" (site:facebook.com OR site:instagram.com OR site:tiktok.com)');
    expect(braveQueryWithDomains('x site:evil.example', ['alibaba.com'])).toBe('x site:alibaba.com');
    // La consulta base se recorta para que el operador nunca quede truncado.
    const long = braveQueryWithDomains('a'.repeat(500), ['facebook.com', 'tiktok.com']);
    expect(long.length).toBeLessThanOrEqual(400);
    expect(long.endsWith('(site:facebook.com OR site:tiktok.com)')).toBe(true);
    expect(braveQueryWithDomains('sin dominios')).toBe('sin dominios');
  });
});

describe('Visión (salida estructurada)', () => {
  const valid = {
    genericName: 'Audífonos inalámbricos de diadema',
    englishName: 'wireless over-ear headphones',
    brand: null,
    model: null,
    attributes: [{ name: 'Color', value: 'Negro' }],
    searchKeywords: ['audífonos bluetooth'],
    uncertainties: ['No se ve la marca'],
    confidence: 0.4,
    alternatives: [{ name: 'Audífonos gamer', brand: null, model: null }],
    isProduct: true,
  };

  it('valida y normaliza la respuesta JSON', () => {
    expect(parseVisionText(JSON.stringify(valid)).genericName).toBe('Audífonos inalámbricos de diadema');
    expect(parseVisionText(`Aquí está: ${JSON.stringify({ ...valid, confidence: 3 })}`).confidence).toBe(1);
  });

  it('rechaza salidas que no cumplen el formato', () => {
    expect(() => parseVisionText('no es json')).toThrow();
    expect(() => parseVisionText(JSON.stringify({ ...valid, attributes: 'x' }))).toThrow();
  });

  it('no inventa marca ni modelo y añade dudas cuando la certeza es baja', () => {
    const identity = visionResultToIdentity(VisionResultSchema.parse(valid));
    expect(identity.brand).toBeUndefined();
    expect(identity.model).toBeUndefined();
    expect(identity.identifiedBy).toBe('VISION_AI');
    expect(identity.uncertainties.join(' ')).toMatch(/baja certeza/);
    expect(identity.uncertainties.join(' ')).toMatch(/Marca no identificada/);
    expect(identity.alternatives).toHaveLength(1);
  });

  it('el JSON Schema exige todos los campos del esquema Zod', () => {
    expect([...VISION_JSON_SCHEMA.required].sort()).toEqual(Object.keys(VisionResultSchema.shape).sort());
  });
});

describe('Cliente del gateway', () => {
  it('solo acepta https (o localhost para desarrollo)', () => {
    expect(normalizeGatewayUrl('https://api.ejemplo.com/')).toBe('https://api.ejemplo.com');
    expect(normalizeGatewayUrl('http://api.ejemplo.com')).toBeNull();
    expect(normalizeGatewayUrl('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('traduce errores del gateway a errores de búsqueda', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'QUOTA_EXCEEDED', message: 'Cuota diaria agotada' } }), { status: 429 }));
    const provider = new GatewaySearchProvider({ baseUrl: 'https://gw.ejemplo.com', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.search({ query: 'x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'MARKET' })).rejects.toMatchObject({ code: 'QUOTA', message: 'Cuota diaria agotada' });
  });

  it('envía consultas de mercado y de Alibaba a rutas distintas', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith('/v1/search-alibaba') ? { items: [] } : { results: [{ query: 'x', ok: true, items: [] }] }), { status: 200 }),
    );
    const provider = new GatewaySearchProvider({ baseUrl: 'https://gw.ejemplo.com', fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.search({ query: 'x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'MARKET' });
    await provider.search({ query: 'site:alibaba.com x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'SUPPLIER' });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(['https://gw.ejemplo.com/v1/search-market', 'https://gw.ejemplo.com/v1/search-alibaba']);
  });

  it('menciones en redes: envía includeDomains a /v1/search-market', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ results: [{ query: 'x', ok: true, items: [] }] }), { status: 200 }));
    const provider = new GatewaySearchProvider({ baseUrl: 'https://gw.ejemplo.com', fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.search({ query: '"Sony XM5"', market: MARKET_CONFIGS.CO, count: 10, purpose: 'SOCIAL', includeDomains: [...SOCIAL_MENTION_DOMAINS] });
    await provider.search({ query: 'x', market: MARKET_CONFIGS.CO, count: 5, purpose: 'MARKET' });
    const [social, market] = fetchImpl.mock.calls.map((c) => JSON.parse(String(c[1]?.body)) as Record<string, unknown>);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://gw.ejemplo.com/v1/search-market');
    expect(social).toEqual({ queries: ['"Sony XM5"'], market: 'CO', count: 10, includeDomains: ['facebook.com', 'instagram.com', 'tiktok.com'] });
    expect(market).not.toHaveProperty('includeDomains');
  });

  it('el contrato solo acepta includeDomains de la lista fija', () => {
    const base = { queries: ['x'], market: 'CO' };
    expect(SearchMarketRequestSchema.safeParse({ ...base, includeDomains: ['tiktok.com'] }).success).toBe(true);
    expect(SearchMarketRequestSchema.safeParse({ ...base, includeDomains: ['evil.example'] }).success).toBe(false);
    expect(SearchMarketRequestSchema.safeParse({ ...base, includeDomains: ['alibaba.com'] }).success).toBe(false);
    expect(SearchMarketRequestSchema.safeParse({ ...base, includeDomains: [] }).success).toBe(false);
  });
});
