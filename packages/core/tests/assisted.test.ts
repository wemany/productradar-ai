import { describe, expect, it } from 'vitest';
import {
  addOfferToReport,
  ASSISTED_SEARCH_PROVIDER,
  buildAlibabaSearchUrl,
  buildStoreSearchLinks,
  createAssistedReport,
  isAssistedReport,
  offerFromSnapshot,
} from '../src/assisted';
import type { PageSnapshot } from '../src/extract';
import { getMarketConfig } from '../src/markets';
import { migrateReport } from '../src/report';
import { makeIdentity } from './helpers';

const CO = getMarketConfig('CO');
const NOW = '2026-10-14T12:00:00.000Z';
const identity = makeIdentity();

function productSnapshot(url: string, offers: unknown, extra: Record<string, unknown> = {}): PageSnapshot {
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'Audífonos Sony WH-1000XM5 Negro', brand: { '@type': 'Brand', name: 'Sony' }, offers, ...extra };
  return { url, title: 'Sony WH-1000XM5', jsonLd: [JSON.stringify(ld)], metas: [] };
}

describe('buildStoreSearchLinks', () => {
  it('genera búsquedas de las tiendas de Colombia con la consulta codificada', () => {
    const links = buildStoreSearchLinks(identity, CO);
    const hosts = links.map((l) => l.host);
    expect(hosts).toEqual(
      expect.arrayContaining(['listado.mercadolibre.com.co', 'exito.com', 'falabella.com.co', 'alkosto.com', 'ktronix.com', 'homecenter.com.co', 'olimpica.com', 'amazon.com']),
    );
    expect(links.find((l) => l.host === 'listado.mercadolibre.com.co')?.url).toBe('https://listado.mercadolibre.com.co/sony-wh-1000xm5');
    expect(links.find((l) => l.host === 'exito.com')?.url).toBe('https://www.exito.com/s?q=Sony%20WH-1000XM5');
    expect(links.find((l) => l.host === 'falabella.com.co')?.url).toContain('Ntt=Sony+WH-1000XM5');
    expect(links.find((l) => l.host === 'amazon.com')?.international).toBe(true);
    for (const link of links) {
      expect(link.url.startsWith('https://')).toBe(true);
      expect(link.origin).toMatch(/^https:\/\/[^/]+\/\*$/);
    }
  });

  it('usa el nombre cuando no hay marca y modelo, y codifica caracteres especiales', () => {
    const links = buildStoreSearchLinks(makeIdentity({ brand: undefined, model: undefined, name: 'Lámpara & difusor' }), CO);
    expect(links.find((l) => l.host === 'exito.com')?.url).toContain('L%C3%A1mpara%20%26%20difusor');
    expect(links[0]?.url).toBe('https://listado.mercadolibre.com.co/lampara-difusor');
  });

  it('ofrece Mercado Libre y al menos 2 tiendas locales en MX, PE y CL', () => {
    for (const code of ['MX', 'PE', 'CL'] as const) {
      const links = buildStoreSearchLinks(identity, getMarketConfig(code));
      expect(links.length).toBeGreaterThanOrEqual(3);
      expect(links[0]?.host.startsWith('listado.mercadolibre.')).toBe(true);
    }
  });
});

describe('buildAlibabaSearchUrl', () => {
  it('prefiere el nombre en inglés y si no, marca + modelo', () => {
    expect(buildAlibabaSearchUrl(makeIdentity({ englishName: 'wireless headphones' }))).toBe('https://www.alibaba.com/trade/search?SearchText=wireless%20headphones');
    expect(buildAlibabaSearchUrl(identity)).toBe('https://www.alibaba.com/trade/search?SearchText=Sony%20WH-1000XM5');
  });
});

describe('offerFromSnapshot', () => {
  it('ficha con JSON-LD y precio en COP → oferta EXACTA verificada en la página', () => {
    const snapshot = productSnapshot('https://www.exito.com/audifonos-sony-wh-1000xm5/p?utm_source=x#top', {
      '@type': 'Offer',
      price: '1399900',
      priceCurrency: 'COP',
      availability: 'https://schema.org/InStock',
    });
    const { offer, error } = offerFromSnapshot(snapshot, identity, CO, NOW);
    expect(error).toBeUndefined();
    expect(offer?.matchType).toBe('EXACT');
    expect(offer?.price).toEqual({ amount: 1399900, currency: 'COP' });
    expect(offer?.evidence.verification).toBe('PAGE_VERIFIED');
    expect(offer?.evidence.method).toBe('PAGE');
    expect(offer?.url).toBe('https://www.exito.com/audifonos-sony-wh-1000xm5/p');
    expect(offer?.seller).toBe('Éxito');
    expect(offer?.marketFit).toBe('LOCAL');
  });

  it('ficha solo con microdatos y sin og:title (como Alkosto) usa el h1 como nombre', () => {
    const snapshot: PageSnapshot = {
      url: 'https://www.alkosto.com/audifonos-sony-wh-1000xm5/p/027242923232',
      title: 'Audífonos | Alkosto',
      h1: 'Audífonos de Diadema SONY Inalámbricos Bluetooth Over Ear Con Noise Cancelling WH-1000XM5 Negro',
      jsonLd: [JSON.stringify({ '@type': 'BreadcrumbList', itemListElement: [] })],
      metas: [
        { key: 'itemprop:name', value: 'SONY' },
        { key: 'itemprop:price', value: '1049900.0' },
        { key: 'itemprop:pricecurrency', value: 'COP' },
      ],
    };
    const { offer } = offerFromSnapshot(snapshot, identity, CO, NOW);
    expect(offer?.matchType).toBe('EXACT');
    expect(offer?.evidence.verification).toBe('PAGE_VERIFIED');
    expect(offer?.price).toEqual({ amount: 1049900, currency: 'COP' });
  });

  it('acepta @type en minúsculas («product»)', () => {
    const snapshot: PageSnapshot = {
      url: 'https://www.homecenter.com.co/homecenter-co/product/543286/taladro',
      jsonLd: [JSON.stringify({ '@type': 'product', name: 'Audífonos Sony WH-1000XM5', offers: { '@type': 'offer', price: 1399900, priceCurrency: 'COP' } })],
      metas: [],
    };
    expect(offerFromSnapshot(snapshot, identity, CO, NOW).offer?.evidence.verification).toBe('PAGE_VERIFIED');
  });

  it('página sin datos estructurados → error, sin oferta', () => {
    const result = offerFromSnapshot({ url: 'https://blog.ejemplo.co/audifonos', title: 'Audífonos', jsonLd: [], metas: [{ key: 'og:title', value: 'Audífonos' }] }, identity, CO, NOW);
    expect(result.offer).toBeUndefined();
    expect(result.error).toMatch(/no parece una ficha de producto/);
  });

  it('ficha con varias variantes de precio → oferta sin verificar', () => {
    const snapshot = productSnapshot('https://www.falabella.com.co/falabella-co/product/123/sony', [
      { '@type': 'Offer', price: '1300000', priceCurrency: 'COP', name: 'Negro' },
      { '@type': 'Offer', price: '1450000', priceCurrency: 'COP', name: 'Plata' },
    ]);
    const { offer } = offerFromSnapshot(snapshot, identity, CO, NOW);
    expect(offer).toBeDefined();
    expect(offer?.evidence.verification).not.toBe('PAGE_VERIFIED');
    expect(offer?.price).toBeUndefined();
    expect(offer?.verificationError).toMatch(/varios precios/);
  });

  it('precio sin moneda → oferta sin verificar con el motivo', () => {
    const snapshot = productSnapshot('https://www.alkosto.com/audifonos-sony/p/123', { '@type': 'Offer', price: '1399900' });
    const { offer } = offerFromSnapshot(snapshot, identity, CO, NOW);
    expect(offer?.evidence.verification).not.toBe('PAGE_VERIFIED');
    expect(offer?.verificationError).toBeTruthy();
  });

  it('rechaza Alibaba (proveedor, no competidor) y las páginas de resultados', () => {
    const alibaba = offerFromSnapshot(productSnapshot('https://www.alibaba.com/product-detail/x_123.html', { price: '10', priceCurrency: 'USD' }), identity, CO, NOW);
    expect(alibaba.offer).toBeUndefined();
    expect(alibaba.error).toMatch(/Alibaba es un proveedor/);
    const listing = offerFromSnapshot(productSnapshot('https://listado.mercadolibre.com.co/sony-wh-1000xm5', { price: '1', priceCurrency: 'COP' }), identity, CO, NOW);
    expect(listing.error).toMatch(/listado o una búsqueda/);
  });
});

describe('reporte asistido', () => {
  it('se crea sin ofertas, con módulos honestos y datos insuficientes', () => {
    const report = createAssistedReport(identity, 'CO', NOW);
    expect(isAssistedReport(report)).toBe(true);
    expect(report.isDemo).toBe(false);
    expect(report.offers).toHaveLength(0);
    expect(report.searchProvider).toBe(ASSISTED_SEARCH_PROVIDER);
    expect(report.status).toBe('PARTIAL');
    expect(report.modules.search.status).toBe('SKIPPED');
    expect(report.modules.suppliers.status).toBe('SKIPPED');
    expect(report.verdict).toBe('INSUFFICIENT_DATA');
    expect(report.financials?.currency).toBe('COP');
    expect(migrateReport(JSON.parse(JSON.stringify(report)))?.mode).toBe('assisted');
  });

  it('agregar la misma ficha dos veces la reemplaza y actualiza el conteo', () => {
    let report = createAssistedReport(identity, 'CO', NOW);
    const first = offerFromSnapshot(productSnapshot('https://www.exito.com/sony/p', { price: '1399900', priceCurrency: 'COP' }), identity, CO, NOW).offer!;
    const again = offerFromSnapshot(productSnapshot('https://exito.com/sony/p?utm_campaign=y', { price: '1299900', priceCurrency: 'COP' }), identity, CO, NOW).offer!;
    const other = offerFromSnapshot(productSnapshot('https://www.alkosto.com/sony/p/1', [{ price: '1', priceCurrency: 'COP', name: 'a' }, { price: '2', priceCurrency: 'COP', name: 'b' }]), identity, CO, NOW).offer!;
    report = addOfferToReport(report, first);
    report = addOfferToReport(report, other);
    report = addOfferToReport(report, again);
    expect(report.offers).toHaveLength(2);
    expect(report.offers[0]?.price?.amount).toBe(1299900);
    expect(report.modules.verify.message).toBe('2 fichas agregadas, 1 con precio verificado');
  });

  it('un reporte guardado sin `mode` sigue cargando', () => {
    const legacy = { ...createAssistedReport(identity, 'CO', NOW), mode: undefined };
    const loaded = migrateReport(JSON.parse(JSON.stringify(legacy)));
    expect(loaded).not.toBeNull();
    expect(loaded && isAssistedReport(loaded)).toBe(false);
  });
});
