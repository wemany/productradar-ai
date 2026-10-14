import { describe, expect, it } from 'vitest';
import { extractFromSnapshot, mapAvailability, pickOffer, productsFromJsonLd, snapshotFromHtml } from '../src/extract';

const html = (head: string, body = '') => `<!doctype html><html lang="es-CO"><head>${head}</head><body>${body}</body></html>`;

describe('snapshotFromHtml', () => {
  it('lee JSON-LD, metas relevantes, título, h1 y canónica sin ejecutar nada', () => {
    const s = snapshotFromHtml(
      html(
        `<title>Audífonos &amp; más</title>
         <meta property="og:title" content="Sony WH-1000XM5">
         <meta name="viewport" content="width=device-width">
         <link rel="canonical" href="https://tienda.com/p/1">
         <script type="application/ld+json">{"@type":"Product","name":"X"}</script>
         <script>alert("no")</script>`,
        '<h1>Sony <b>WH-1000XM5</b></h1><form><input name="password" value="secreto"></form>',
      ),
      'https://tienda.com/p/1?x=1',
    );
    expect(s.title).toBe('Audífonos & más');
    expect(s.h1).toBe('Sony WH-1000XM5');
    expect(s.canonical).toBe('https://tienda.com/p/1');
    expect(s.jsonLd).toHaveLength(1);
    expect(s.metas.find((m) => m.key === 'og:title')?.value).toBe('Sony WH-1000XM5');
    expect(s.metas.some((m) => m.key === 'viewport')).toBe(false);
    expect(JSON.stringify(s)).not.toContain('secreto');
  });
});

describe('productsFromJsonLd', () => {
  it('Product + Offer simples', () => {
    const [p] = productsFromJsonLd([
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Perfume Dior Sauvage 100 ml',
        brand: { '@type': 'Brand', name: 'Dior' },
        gtin13: '3348901250153',
        image: ['https://cdn.tienda.com/a.jpg'],
        offers: { '@type': 'Offer', price: '459900', priceCurrency: 'COP', availability: 'https://schema.org/InStock' },
      }),
    ]);
    expect(p).toMatchObject({ name: 'Perfume Dior Sauvage 100 ml', brand: 'Dior', gtin: '3348901250153', image: 'https://cdn.tienda.com/a.jpg' });
    expect(p?.offers[0]).toMatchObject({ price: 459900, currency: 'COP', availability: 'IN_STOCK', priceSource: 'PAGE_JSON_LD' });
  });

  it('@graph, arreglos de @type y precio con formato local', () => {
    const products = productsFromJsonLd([
      JSON.stringify({
        '@graph': [
          { '@type': 'BreadcrumbList' },
          { '@type': ['Product', 'Thing'], name: 'Licuadora', offers: [{ '@type': 'Offer', price: '189.900', priceCurrency: 'COP' }] },
        ],
      }),
    ]);
    expect(products[0]?.offers[0]?.price).toBe(189900);
  });

  it('AggregateOffer usa lowPrice y conserva highPrice', () => {
    const [p] = productsFromJsonLd([
      JSON.stringify({ '@type': 'Product', name: 'Celular', offers: { '@type': 'AggregateOffer', lowPrice: 899000, highPrice: 999000, priceCurrency: 'COP' } }),
    ]);
    expect(p?.offers[0]).toMatchObject({ price: 899000, priceMax: 999000 });
  });

  it('ProductGroup con variantes', () => {
    const products = productsFromJsonLd([
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Galaxy A55',
        brand: 'Samsung',
        hasVariant: [
          { '@type': 'Product', name: 'Galaxy A55 128GB', offers: { price: 1399000, priceCurrency: 'COP' } },
          { '@type': 'Product', name: 'Galaxy A55 256GB', offers: { price: 1599000, priceCurrency: 'COP' } },
        ],
      }),
    ]);
    // El grupo sin oferta propia se omite; cada variante hereda la marca del grupo.
    expect(products.map((p) => p.name)).toEqual(['Galaxy A55 128GB', 'Galaxy A55 256GB']);
    expect(products[1]?.brand).toBe('Samsung');
  });

  it('priceSpecification y JSON con comentarios HTML', () => {
    const [p] = productsFromJsonLd([
      `<!-- ${JSON.stringify({ '@type': 'Product', name: 'Silla', offers: { '@type': 'Offer', priceSpecification: { price: 250000, priceCurrency: 'COP' } } })} -->`,
    ]);
    expect(p?.offers[0]?.price).toBe(250000);
  });

  it('ignora JSON inválido sin lanzar', () => {
    expect(productsFromJsonLd(['{ esto no es json', '[]'])).toEqual([]);
  });

  it('un producto sin moneda no recibe una moneda inventada', () => {
    const [p] = productsFromJsonLd([JSON.stringify({ '@type': 'Product', name: 'X', offers: { price: 1000 } })]);
    expect(p?.offers[0]?.currency).toBeUndefined();
  });
});

describe('extractFromSnapshot', () => {
  it('usa Open Graph product:price si no hay JSON-LD', () => {
    const s = snapshotFromHtml(
      html(
        `<meta property="og:title" content="Silla ergonómica">
         <meta property="product:price:amount" content="349900">
         <meta property="product:price:currency" content="COP">
         <meta property="og:image" content="/img/silla.jpg">`,
      ),
      'https://tienda.com/p/silla',
    );
    const r = extractFromSnapshot(s, 'COP');
    expect(r.primary?.name).toBe('Silla ergonómica');
    expect(r.primary?.offers[0]).toMatchObject({ price: 349900, currency: 'COP', priceSource: 'PAGE_META' });
    expect(r.primary?.image).toBe('https://tienda.com/img/silla.jpg');
  });

  it('usa microdatos itemprop', () => {
    const s = snapshotFromHtml(
      html('', '<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Mesa</span><meta itemprop="price" content="120000"><meta itemprop="priceCurrency" content="COP"></div>'),
      'https://tienda.com/p/mesa',
    );
    expect(extractFromSnapshot(s, 'COP').primary?.offers[0]).toMatchObject({ price: 120000, currency: 'COP', priceSource: 'PAGE_MICRODATA' });
  });

  it('precio visible del DOM solo como referencia', () => {
    const r = extractFromSnapshot({ url: 'https://t.com/p', jsonLd: [], metas: [], priceTexts: ['Precio: $ 79.900'] }, 'COP');
    expect(r.visiblePrice).toMatchObject({ amount: 79900, currency: 'COP' });
  });

  it('pickOffer prefiere la moneda del mercado', () => {
    const offer = pickOffer(
      { offers: [{ price: 20, currency: 'USD', availability: 'IN_STOCK', priceSource: 'PAGE_JSON_LD' }, { price: 80000, currency: 'COP', availability: 'IN_STOCK', priceSource: 'PAGE_JSON_LD' }], source: 'JSON_LD' },
      'COP',
    );
    expect(offer?.currency).toBe('COP');
  });

  it('descarta imágenes con esquemas peligrosos', () => {
    const s = snapshotFromHtml(html('<meta property="og:title" content="X"><meta property="og:image" content="javascript:alert(1)">'), 'https://t.com/p');
    expect(extractFromSnapshot(s, 'COP').fallbackImage).toBeUndefined();
  });
});

describe('mapAvailability', () => {
  it.each([
    ['https://schema.org/InStock', 'IN_STOCK'],
    ['OutOfStock', 'OUT_OF_STOCK'],
    ['in stock', 'IN_STOCK'],
    ['algo', 'UNKNOWN'],
    [undefined, 'UNKNOWN'],
  ])('%s → %s', (input, expected) => {
    expect(mapAvailability(input)).toBe(expected);
  });
});
