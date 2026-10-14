import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../fixtures/explicitly-demo-data.json';
import { createDemoProviders, parseDemoFixture } from '../src/demo';
import { summarizeMarketPrices } from '../src/pricing';
import { recomputeReport } from '../src/report';
import { runResearch, SearchProviderError, type WebSearchProvider } from '../src/research';
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
