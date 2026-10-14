import { PageFetchError } from '@productradar/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const granted = new Set<string>();
vi.mock('../src/services/permissions', () => ({
  hasOrigin: async (origin: string) => granted.has(origin),
}));

const { ExtensionPageFetcher } = await import('../src/services/fetcher');

function html(body: string, init: ResponseInit & { url?: string } = {}) {
  const res = new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
  if (init.url) Object.defineProperty(res, 'url', { value: init.url });
  return res;
}

describe('ExtensionPageFetcher', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    granted.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sin permiso del sitio no hace ninguna petición', async () => {
    await expect(new ExtensionPageFetcher().fetchSnapshot('https://tienda.com/p/1')).rejects.toMatchObject({ kind: 'NO_PERMISSION' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza URLs no públicas antes de pedir nada', async () => {
    for (const url of ['http://tienda.com/p', 'https://192.168.0.1/p', 'https://localhost/p']) {
      await expect(new ExtensionPageFetcher().fetchSnapshot(url)).rejects.toMatchObject({ kind: 'UNSAFE_URL' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lee la página sin cookies y extrae JSON-LD', async () => {
    granted.add('https://tienda.com/*');
    fetchMock.mockResolvedValue(html('<script type="application/ld+json">{"@type":"Product","name":"Mesa","offers":{"price":1000,"priceCurrency":"COP"}}</script>'));
    const snapshot = await new ExtensionPageFetcher().fetchSnapshot('https://tienda.com/p/1');
    expect(snapshot.jsonLd).toHaveLength(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('omit');
    expect(init?.referrerPolicy).toBe('no-referrer');
  });

  it.each([
    [403, 'BLOCKED'],
    [429, 'BLOCKED'],
    [404, 'NOT_FOUND'],
    [500, 'HTTP_ERROR'],
  ])('HTTP %i → %s', async (status, kind) => {
    granted.add('https://tienda.com/*');
    fetchMock.mockResolvedValue(html('', { status }));
    await expect(new ExtensionPageFetcher().fetchSnapshot('https://tienda.com/p/1')).rejects.toMatchObject({ kind });
  });

  it('no elude captchas: los reporta como bloqueo', async () => {
    granted.add('https://tienda.com/*');
    fetchMock.mockResolvedValue(html('<html><head><title>Just a moment...</title></head><body>cf-chl-bypass</body></html>'));
    const error = await new ExtensionPageFetcher().fetchSnapshot('https://tienda.com/p/1').catch((e) => e);
    expect(error).toBeInstanceOf(PageFetchError);
    expect(error.kind).toBe('BLOCKED');
  });

  it('una ficha que solo incluye un script de reCAPTCHA no se considera bloqueada', async () => {
    granted.add('https://tienda.com/*');
    fetchMock.mockResolvedValue(
      html('<html><head><title>Mesa | Tienda</title><meta property="og:title" content="Mesa"><script src="https://www.google.com/recaptcha/api.js"></script></head></html>'),
    );
    const snapshot = await new ExtensionPageFetcher().fetchSnapshot('https://tienda.com/p/1');
    expect(snapshot.metas.some((m) => m.key === 'og:title')).toBe(true);
  });

  it('rechaza redirecciones hacia direcciones no públicas', async () => {
    granted.add('https://tienda.com/*');
    fetchMock.mockResolvedValue(html('<html></html>', { url: 'https://127.0.0.1/admin' }));
    await expect(new ExtensionPageFetcher().fetchSnapshot('https://tienda.com/p/1')).rejects.toMatchObject({ kind: 'UNSAFE_URL' });
  });

  it('rechaza contenido que no es HTML', async () => {
    granted.add('https://tienda.com/*');
    fetchMock.mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await expect(new ExtensionPageFetcher().fetchSnapshot('https://tienda.com/p/1')).rejects.toMatchObject({ kind: 'NOT_HTML' });
  });
});
