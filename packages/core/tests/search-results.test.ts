import { describe, expect, it } from 'vitest';
import { MARKET_CONFIGS } from '../src/markets';
import { buildAlibabaQuery, buildMarketQueries } from '../src/queries';
import { assessMarketFit, classifyResultUrl, resultsToOffers } from '../src/search-results';
import { makeIdentity } from './helpers';

const CO = MARKET_CONFIGS.CO;
const NOW = '2026-10-12T00:00:00.000Z';

describe('classifyResultUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=1', 'SOCIAL'],
    ['https://es.wikipedia.org/wiki/Sony', 'SOCIAL'],
    ['https://tienda.com/blog/mejores-audifonos', 'CONTENT'],
    ['https://listado.mercadolibre.com.co/sony-wh-1000xm5', 'LISTING_PAGE'],
    ['https://articulo.mercadolibre.com.co/MCO-123456789-sony-wh1000xm5-_JM', 'PRODUCT_PAGE'],
    ['https://www.mercadolibre.com.co/sony-wh-1000xm5/p/MCO12345678', 'PRODUCT_PAGE'],
    ['https://www.exito.com/audifonos-sony-wh-1000xm5-3112345/p', 'PRODUCT_PAGE'],
    ['https://tienda.com/search?q=sony', 'LISTING_PAGE'],
    ['https://tienda.myshopify.com/collections/audio', 'LISTING_PAGE'],
    ['https://tienda.myshopify.com/collections/audio/products/sony-xm5', 'PRODUCT_PAGE'],
    ['https://tienda.com/', 'LISTING_PAGE'],
    ['https://127.0.0.1/p/1', 'UNSAFE'],
    ['https://tienda.com/audifonos-sony-xm5', 'CANDIDATE'],
  ])('%s → %s', (url, kind) => {
    expect(classifyResultUrl(url).kind).toBe(kind);
  });
});

describe('assessMarketFit', () => {
  it('comercio conocido + .com.co + COP = LOCAL', () => {
    expect(assessMarketFit('https://www.falabella.com.co/p/1', CO, 'COP', '').fit).toBe('LOCAL');
  });

  it('.co solo no garantiza que sea local', () => {
    const r = assessMarketFit('https://startup.co/p/1', CO, undefined, '');
    expect(r.fit).toBe('LIKELY_LOCAL');
    expect(r.signals.join(' ')).toMatch(/también usado fuera del país/);
  });

  it('marketplace internacional = FOREIGN', () => {
    expect(assessMarketFit('https://www.amazon.com/dp/1', CO, 'USD', '').fit).toBe('FOREIGN');
  });
});

describe('resultsToOffers', () => {
  const identity = makeIdentity();
  const items = [
    { title: 'Sony WH-1000XM5 Negro', url: 'https://www.tienda.com.co/p/xm5?utm_source=a', snippet: 'Envío en Colombia. $ 1.299.900', query: 'q1' },
    { title: 'Sony WH-1000XM5 Negro', url: 'https://tienda.com.co/p/xm5', snippet: 'Duplicado', query: 'q2' },
    { title: 'Reseña: Sony WH-1000XM5 vs XM4', url: 'https://blog.com/resena/xm5', snippet: '', query: 'q1' },
    { title: 'Sony WH1000XM5', url: 'https://www.youtube.com/watch?v=1', snippet: '', query: 'q1' },
    { title: 'Sony WH-1000XM5', url: 'https://www.alibaba.com/product-detail/x.html', snippet: '', query: 'q1' },
    {
      title: 'Audífonos Sony WH-1000XM5',
      url: 'https://otra.com.co/p/1',
      snippet: '',
      structuredProduct: { price: '1.249.900', currency: 'COP' },
      query: 'q1',
    },
  ];

  const { offers, discarded } = resultsToOffers(items, identity, CO, NOW);

  it('deduplica por URL canónica pero conserva el host original (www) para leer la ficha', () => {
    expect(offers.filter((o) => o.domain === 'tienda.com.co')).toHaveLength(1);
    expect(offers.find((o) => o.domain === 'tienda.com.co')?.url).toBe('https://www.tienda.com.co/p/xm5');
  });

  it('el precio del fragmento queda como "visible solo en buscador"', () => {
    const o = offers.find((x) => x.url === 'https://www.tienda.com.co/p/xm5');
    expect(o?.price).toEqual({ amount: 1299900, currency: 'COP' });
    expect(o?.evidence.verification).toBe('SEARCH_SNIPPET_ONLY');
    expect(o?.priceSource).toBe('SEARCH_SNIPPET');
    expect(o?.evidence.method).toBe('SEARCH_API');
  });

  it('usa datos estructurados del buscador pero no los marca como verificados', () => {
    const o = offers.find((x) => x.url === 'https://otra.com.co/p/1');
    expect(o?.priceSource).toBe('SEARCH_STRUCTURED');
    expect(o?.evidence.verification).toBe('SEARCH_SNIPPET_ONLY');
  });

  it('descarta contenido, redes sociales y deja Alibaba fuera de competidores', () => {
    expect(discarded.map((d) => d.url)).toEqual(expect.arrayContaining(['https://blog.com/resena/xm5', 'https://www.youtube.com/watch?v=1']));
    expect(offers.some((o) => o.domain === 'alibaba.com')).toBe(false);
  });

  it('cada oferta conserva su consulta y fecha de observación', () => {
    expect(offers.every((o) => o.evidence.retrievedAt === NOW && o.evidence.query)).toBe(true);
  });
});

describe('consultas', () => {
  it('genera entre 3 y 6 consultas con el país, sin depender de dominios .co', () => {
    const q = buildMarketQueries(makeIdentity({ attributes: { Color: 'Negro' } }), CO);
    expect(q.length).toBeGreaterThanOrEqual(3);
    expect(q.length).toBeLessThanOrEqual(6);
    expect(q.every((x) => x.includes('Colombia') || x.startsWith('"'))).toBe(true);
    expect(q.some((x) => x.includes('site:'))).toBe(false);
    expect(q[0]).toBe('"Sony WH-1000XM5" comprar Colombia precio');
  });

  it('incluye la presentación y el GTIN cuando existen', () => {
    const q = buildMarketQueries(makeIdentity({ name: 'Perfume Dior Sauvage 100 ml', brand: 'Dior', model: undefined, gtin: '3348901250153' }), CO, 6);
    expect(q).toContain('"3348901250153"');
  });

  it('Alibaba usa site:alibaba.com y prefiere el nombre en inglés', () => {
    expect(buildAlibabaQuery(makeIdentity({ englishName: 'wireless headphones' }))).toBe('site:alibaba.com wireless headphones');
    expect(buildAlibabaQuery(makeIdentity())).toBe('site:alibaba.com Sony WH-1000XM5');
    expect(buildAlibabaQuery(makeIdentity({ alibabaQuery: 'site:evil.com bluetooth headset' }))).toBe('site:alibaba.com bluetooth headset');
  });
});
