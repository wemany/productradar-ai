import { describe, expect, it, vi } from 'vitest';
import fixtureJson from '../../../fixtures/explicitly-demo-data.json';
import { createDemoProviders, parseDemoFixture } from '../src/demo';
import { summarizeMarketPrices } from '../src/pricing';
import { BraveSearchProvider } from '../src/providers/brave';
import { recomputeReport } from '../src/report';
import { runResearch, SearchProviderError, type SearchInput, type WebSearchProvider } from '../src/research';
import type { SearchResultItem } from '../src/search-results';
import type { ResearchReport } from '../src/schemas';
import { ResearchReportSchema } from '../src/schemas';

const fixture = parseDemoFixture(fixtureJson);
const fixedNow = () => new Date('2026-10-12T12:00:00.000Z');

async function demoRun(overrides: Partial<Parameters<typeof runResearch>[0]> = {}): Promise<ResearchReport> {
  const providers = createDemoProviders(fixture);
  return runResearch({
    product: fixture.product,
    country: 'CO',
    providers,
    isDemo: true,
    financials: fixture.financials,
    now: fixedNow,
    ...overrides,
  });
}

describe('runResearch con el fixture de demostración', () => {
  it('produce un reporte válido, marcado como demo, con todas las fases', async () => {
    const updates: ResearchReport[] = [];
    const report = await demoRun({ onUpdate: (r) => updates.push(r) });
    expect(ResearchReportSchema.safeParse(report).success).toBe(true);
    expect(report.isDemo).toBe(true);
    expect(report.offers.every((o) => o.evidence.method === 'DEMO_FIXTURE' || o.evidence.method === 'PAGE')).toBe(true);
    expect(Object.values(report.modules).every((m) => m.status !== 'PENDING' && m.status !== 'RUNNING')).toBe(true);
    // Resultados parciales progresivos
    expect(updates.length).toBeGreaterThan(5);
    expect(updates.some((u) => u.offers.length > 0 && u.modules.verify.status !== 'OK')).toBe(true);
  });

  it('Caso C: la tienda que bloquea queda como no verificable y no altera la mediana', async () => {
    const report = await demoRun();
    const blocked = report.offers.find((o) => o.domain === 'electro-demo-cuatro.example');
    expect(blocked?.verificationError).toMatch(/bloqueó/);
    expect(blocked?.evidence.verification).toBe('SEARCH_SNIPPET_ONLY');
    const summary = summarizeMarketPrices(report.offers, 'COP');
    expect(summary.verified?.prices).toEqual([99900, 104900, 109900]);
    expect(summary.verified?.median).toBe(104900);
    expect(summary.snippetReference?.prices).toEqual([94900]);
  });

  it('separa variantes, genéricos, contenido y vendedores internacionales', async () => {
    const report = await demoRun();
    const byDomain = Object.fromEntries(report.offers.map((o) => [o.domain, o]));
    expect(byDomain['bazar-demo-cinco.example']?.matchType).toBe('VARIANT');
    expect(byDomain['outlet-demo-seis.example']?.matchType).toBe('VARIANT');
    expect(byDomain['tienda-demo-siete.example']?.matchType).toBe('SIMILAR');
    expect(byDomain['shop-global-demo.example']?.marketFit).toBe('FOREIGN');
    expect(byDomain['tienda-demo-once.example']?.verificationError).toMatch(/sin moneda/);
    expect(report.discarded.map((d) => d.url)).toEqual(
      expect.arrayContaining(['https://blog-demo.example/blog/mejores-audifonos-2026', 'https://marketplace-demo.example/search?q=aura+x2']),
    );
  });

  it('referencias de Alibaba en USD con MOQ, nunca como costo confirmado', async () => {
    const report = await demoRun();
    expect(report.supplierReferences).toHaveLength(3);
    expect(report.supplierReferences.map((s) => s.moq)).toEqual(expect.arrayContaining([500, 100, 200]));
    expect(report.financials?.productCostSource).toBe('USER');
  });

  it('veredicto con el ejemplo ilustrativo: contribución $30.000 y confianza media', async () => {
    const report = await demoRun();
    expect(report.verdict).toBe('TEST');
    expect(report.verdictReasons.join(' ')).toMatch(/\$ 30\.000 COP/);
    expect(report.evidenceConfidence).toBe('MEDIUM');
    expect(report.adResearch.activeAdsCount).toBeNull();
  });

  it('si el usuario niega el permiso de lectura, el módulo queda parcial y no hay precios verificados', async () => {
    const report = await demoRun({ requestVerification: async () => () => false });
    expect(report.modules.verify.status).toBe('PARTIAL');
    expect(report.offers.some((o) => o.evidence.verification === 'PAGE_VERIFIED')).toBe(false);
    expect(report.status).toBe('PARTIAL');
    expect(report.verdict).not.toBe('TEST');
  });

  it('si falla Alibaba, el resto del reporte sigue disponible y se marca parcial', async () => {
    const demo = createDemoProviders(fixture);
    const search: WebSearchProvider = {
      id: 'x',
      label: 'x',
      search: (input, signal) => (input.purpose === 'SUPPLIER' ? Promise.reject(new SearchProviderError('UPSTREAM', 'caído')) : demo.search.search(input, signal)),
    };
    const report = await demoRun({ providers: { search, fetcher: demo.fetcher } });
    expect(report.modules.suppliers.status).toBe('FAILED');
    expect(report.status).toBe('PARTIAL');
    expect(report.incompleteModules).toContain('referencias de Alibaba');
    expect(report.offers.length).toBeGreaterThan(0);
  });

  it('Caso D: buscador sin credenciales → falla de forma honesta, sin datos inventados', async () => {
    const search: WebSearchProvider = {
      id: 'x',
      label: 'x',
      search: () => Promise.reject(new SearchProviderError('UNAUTHORIZED', 'Clave inválida', 401)),
    };
    const report = await runResearch({ product: fixture.product, country: 'CO', providers: { search }, now: fixedNow });
    expect(report.status).toBe('FAILED');
    expect(report.modules.search.status).toBe('FAILED');
    expect(report.offers).toEqual([]);
    expect(report.queries).toHaveLength(1); // se detiene tras un error de autorización
    expect(report.verdict).toBe('INSUFFICIENT_DATA');
  });

  it('cancelación: devuelve resultados parciales marcados como cancelados', async () => {
    const controller = new AbortController();
    const demo = createDemoProviders(fixture, 5);
    let calls = 0;
    const search: WebSearchProvider = {
      id: 'x',
      label: 'x',
      search: async (input, signal) => {
        calls += 1;
        if (calls === 2) controller.abort();
        return demo.search.search(input, signal);
      },
    };
    const report = await runResearch({ product: fixture.product, country: 'CO', providers: { search, fetcher: demo.fetcher }, signal: controller.signal, now: fixedNow });
    expect(report.status).toBe('CANCELLED');
    expect(report.notes.join(' ')).toMatch(/cancelada/);
  });

  it('la demostración no hace la búsqueda de menciones en redes', async () => {
    const demo = createDemoProviders(fixture);
    const spy = vi.spyOn(demo.search, 'search');
    const report = await demoRun({ providers: demo });
    expect(spy.mock.calls.some(([input]) => input.purpose === 'SOCIAL')).toBe(false);
    expect(report.queries.some((q) => q.purpose === 'SOCIAL')).toBe(false);
    expect(report.adResearch.evidence).toEqual([]);
    expect(report.modules.ads).toEqual({ status: 'OK', message: 'Enlaces a bibliotecas oficiales listos; cantidad de anuncios no verificable' });
  });

  it('corrección manual: excluir y marcar exacta recalcula estadísticas', async () => {
    const report = await demoRun();
    const edited = recomputeReport({
      ...report,
      offers: report.offers.map((o) =>
        o.domain === 'tienda-demo-uno.example' ? { ...o, userOverride: 'EXCLUDED' as const } : o.domain === 'bazar-demo-cinco.example' ? { ...o, userOverride: 'EXACT' as const } : o,
      ),
    });
    const summary = summarizeMarketPrices(edited.offers, 'COP');
    expect(summary.verified?.prices).toEqual([99900, 109900, 189900]);
  });
});

describe('menciones públicas en redes (módulo de publicidad)', () => {
  const social = (url: string, snippet = 'Probé los DemoSonic Aura X2 y…'): SearchResultItem => ({ title: 'Publicación', url, snippet });
  const SOCIAL_RESULTS: SearchResultItem[] = [
    social('https://www.facebook.com/demosonic/posts/1'),
    social('https://m.facebook.com/groups/audio/posts/2'),
    social('https://www.instagram.com/p/abc/'),
    social('https://www.tiktok.com/@resenas/video/3'),
    social('https://facebook.com.evil.example/p/4'),
    social('https://tienda-demo-uno.example/p/aura-x2'),
    social('javascript:alert(1)'),
    social('https://www.facebook.com/demosonic/posts/1?fbclid=dup'),
    ...Array.from({ length: 8 }, (_, i) => social(`https://www.tiktok.com/@u${i}/video/${i}`)),
  ];

  /** Buscador real simulado (no demo) que sirve el fixture y una respuesta propia para SOCIAL. */
  function liveLikeProviders(onSocial: (input: SearchInput) => Promise<SearchResultItem[]>) {
    const demo = createDemoProviders(fixture);
    const inputs: SearchInput[] = [];
    const search: WebSearchProvider = {
      id: 'simulado',
      label: 'Simulado',
      search: (input, signal) => {
        inputs.push(input);
        return input.purpose === 'SOCIAL' ? onSocial(input) : demo.search.search(input, signal);
      },
    };
    return { providers: { search, fetcher: demo.fetcher }, inputs };
  }

  const liveRun = (providers: { search: WebSearchProvider; fetcher?: ReturnType<typeof createDemoProviders>['fetcher'] }) =>
    runResearch({ product: fixture.product, country: 'CO', providers, financials: fixture.financials, now: fixedNow });

  it('guarda hasta 8 menciones como evidencia del buscador, solo de facebook/instagram/tiktok', async () => {
    const { providers, inputs } = liveLikeProviders(async () => SOCIAL_RESULTS);
    const report = await liveRun(providers);
    const socialInput = inputs.find((i) => i.purpose === 'SOCIAL');
    expect(socialInput).toMatchObject({ query: '"DemoSonic Aura X2"', includeDomains: ['facebook.com', 'instagram.com', 'tiktok.com'] });
    const evidence = report.adResearch.evidence;
    expect(evidence).toHaveLength(8);
    expect(evidence.slice(0, 4).map((e) => e.publisher)).toEqual(['facebook.com', 'm.facebook.com', 'instagram.com', 'tiktok.com']);
    for (const e of evidence) {
      expect(e).toMatchObject({ method: 'SEARCH_API', verification: 'SEARCH_SNIPPET_ONLY', query: '"DemoSonic Aura X2"' });
      expect(e.url).toMatch(/^https:\/\/(www\.|m\.)?(facebook|instagram|tiktok)\.com\//);
      expect(e.extractedText).toContain('Aura X2');
    }
    expect(evidence.filter((e) => e.url.includes('/demosonic/posts/1'))).toHaveLength(1);
    expect(report.queries.at(-1)).toMatchObject({ purpose: 'SOCIAL', ok: true, resultCount: SOCIAL_RESULTS.length });
    expect(report.modules.ads).toEqual({ status: 'OK', message: 'Enlaces a bibliotecas oficiales listos · 8 menciones públicas (no son conteo de anuncios)' });
    expect(ResearchReportSchema.safeParse(report).success).toBe(true);
  });

  it('las menciones nunca se convierten en conteo de anuncios', async () => {
    const { providers } = liveLikeProviders(async () => SOCIAL_RESULTS);
    const report = await liveRun(providers);
    expect(report.adResearch.evidence.length).toBeGreaterThan(0);
    expect(report.adResearch.activeAdsCount).toBeNull();
    expect(report.adResearch.historicalAdsCount).toBeNull();
    expect(report.adResearch.links.map((l) => l.platform)).toEqual(['META', 'GOOGLE']);
  });

  it('si falla la búsqueda de menciones, el módulo sigue OK y el veredicto no cambia', async () => {
    const ok = await liveRun(liveLikeProviders(async () => SOCIAL_RESULTS).providers);
    const failed = await liveRun(liveLikeProviders(() => Promise.reject(new SearchProviderError('RATE_LIMITED', 'Límite alcanzado'))).providers);
    expect(failed.modules.ads.status).toBe('OK');
    expect(failed.modules.ads.message).toMatch(/no fue posible consultar menciones públicas/);
    expect(failed.adResearch.evidence).toEqual([]);
    expect(failed.incompleteModules).not.toContain('publicidad');
    expect(failed.queries.at(-1)).toMatchObject({ purpose: 'SOCIAL', ok: false });
    expect([failed.status, failed.verdict, failed.evidenceConfidence]).toEqual([ok.status, ok.verdict, ok.evidenceConfidence]);
  });

  it('se omite si la búsqueda de competencia falló por completo', async () => {
    const onSocial = vi.fn(async () => SOCIAL_RESULTS);
    const search: WebSearchProvider = {
      id: 'x',
      label: 'x',
      search: (input) => (input.purpose === 'SOCIAL' ? onSocial() : Promise.reject(new SearchProviderError('UPSTREAM', 'caído'))),
    };
    const report = await runResearch({ product: fixture.product, country: 'CO', providers: { search }, now: fixedNow });
    expect(report.modules.search.status).toBe('FAILED');
    expect(onSocial).not.toHaveBeenCalled();
    expect(report.adResearch.evidence).toEqual([]);
  });

  it('con Brave, la consulta de menciones lleva los operadores site: de las tres redes', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      const results = q.includes('site:tiktok.com')
        ? [{ title: 'Video', url: 'https://www.tiktok.com/@a/video/1', description: 'Reseña de DemoSonic Aura X2' }]
        : [{ title: 'DemoSonic Aura X2', url: 'https://tienda-demo-uno.example/p/aura-x2', description: 'Precio $ 99.900' }];
      return new Response(JSON.stringify({ web: { results } }), { status: 200 });
    });
    const search = new BraveSearchProvider({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    const report = await runResearch({ product: fixture.product, country: 'CO', providers: { search }, now: fixedNow });
    const queries = fetchImpl.mock.calls.map(([url]) => new URL(url).searchParams.get('q'));
    expect(queries).toContain('"DemoSonic Aura X2" (site:facebook.com OR site:instagram.com OR site:tiktok.com)');
    expect(queries.filter((q) => q?.includes('site:facebook.com'))).toHaveLength(1);
    expect(report.adResearch.evidence.map((e) => e.url)).toEqual(['https://www.tiktok.com/@a/video/1']);
    expect(report.adResearch.activeAdsCount).toBeNull();
  });
});
