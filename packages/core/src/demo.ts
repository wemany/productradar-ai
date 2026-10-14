import { z } from 'zod';
import { extractFromSnapshot, snapshotFromHtml, type PageSnapshot } from './extract';
import type { SearchInput, WebSearchProvider } from './research';
import { FinancialInputsSchema, MarketSchema, ProductIdentitySchema } from './schemas';
import type { SearchResultItem } from './search-results';
import { canonicalizeUrl } from './url';
import { PageFetchError, type OfferPageFetcher } from './verify';

/**
 * Proveedores de DEMOSTRACIÓN. Sirven datos ficticios del fixture
 * `fixtures/explicitly-demo-data.json` a través del mismo pipeline real, para
 * que el flujo sea reproducible sin red ni claves. Todo reporte generado así
 * queda marcado con `isDemo: true`.
 */

const DemoResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  publisherName: z.string().optional(),
});

export const DemoFixtureSchema = z.object({
  _notice: z.string(),
  version: z.literal(1),
  market: MarketSchema,
  product: ProductIdentitySchema,
  financials: FinancialInputsSchema,
  marketResults: z.array(DemoResultSchema),
  supplierResults: z.array(DemoResultSchema),
  pages: z.record(z.string(), z.object({ status: z.number().int(), html: z.string().optional() })),
});
export type DemoFixture = z.infer<typeof DemoFixtureSchema>;

export function parseDemoFixture(raw: unknown): DemoFixture {
  return DemoFixtureSchema.parse(raw);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Cancelado', 'AbortError'));
      },
      { once: true },
    );
  });
}

export class DemoSearchProvider implements WebSearchProvider {
  readonly id = 'demo';
  readonly label = 'Demostración (datos ficticios)';
  readonly isDemo = true;
  private marketCalls = 0;

  constructor(
    private readonly fixture: DemoFixture,
    private readonly latencyMs = 0,
  ) {}

  async search(input: SearchInput, signal?: AbortSignal): Promise<SearchResultItem[]> {
    await delay(this.latencyMs, signal);
    if (input.purpose === 'SUPPLIER') return this.fixture.supplierResults;
    // Repartir resultados entre consultas para mostrar el progreso incremental.
    const all = this.fixture.marketResults;
    const call = this.marketCalls;
    this.marketCalls += 1;
    const chunk = Math.ceil(all.length / 3);
    return call < 3 ? all.slice(call * chunk, call * chunk + chunk + 1) : all.slice(0, 2);
  }
}

export class DemoPageFetcher implements OfferPageFetcher {
  constructor(
    private readonly fixture: DemoFixture,
    private readonly latencyMs = 0,
  ) {}

  async fetchSnapshot(url: string, signal?: AbortSignal): Promise<PageSnapshot> {
    await delay(this.latencyMs, signal);
    const key = canonicalizeUrl(url) ?? url;
    const page = Object.entries(this.fixture.pages).find(([k]) => (canonicalizeUrl(k) ?? k) === key)?.[1];
    if (!page) throw new PageFetchError('NOT_FOUND', 'Página no incluida en la demostración', 404);
    if (page.status === 403) throw new PageFetchError('BLOCKED', 'El sitio bloqueó la lectura automática', 403);
    if (page.status !== 200 || !page.html) throw new PageFetchError('HTTP_ERROR', 'Error de la página de demostración', page.status);
    return snapshotFromHtml(page.html, url);
  }
}

export function createDemoProviders(fixture: DemoFixture, latencyMs = 0): { search: DemoSearchProvider; fetcher: DemoPageFetcher } {
  return { search: new DemoSearchProvider(fixture, latencyMs), fetcher: new DemoPageFetcher(fixture, latencyMs) };
}

/** Comprueba que el fixture se pueda extraer (usado en pruebas). */
export function demoPageExtracts(fixture: DemoFixture, url: string, currency: string) {
  const page = fixture.pages[url];
  if (!page?.html) return undefined;
  return extractFromSnapshot(snapshotFromHtml(page.html, url), currency);
}
