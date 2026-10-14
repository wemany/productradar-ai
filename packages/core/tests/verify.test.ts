import { describe, expect, it } from 'vitest';
import { snapshotFromHtml } from '../src/extract';
import { MARKET_CONFIGS } from '../src/markets';
import { parseLocaleNumber } from '../src/money';
import { productsFromJsonLd } from '../src/extract';
import { applySnapshotToOffer, LOWEST_PRICE_NOTE, resolveOffer } from '../src/verify';
import { makeIdentity, makeOffer } from './helpers';

const CO = MARKET_CONFIGS.CO;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe('variantes con precios distintos en una misma ficha', () => {
  const perfume = makeIdentity({ name: 'Perfume Aqua Fresh', brand: 'Aqua', model: undefined, attributes: { Volumen: '100 ml' } });

  it('sin forma de atar la oferta a la identidad → no se verifica (no entra en la estadística)', () => {
    const html = ld({
      '@type': 'Product',
      name: 'Perfume Aqua Fresh',
      brand: 'Aqua',
      offers: [
        { '@type': 'Offer', price: 79900, priceCurrency: 'COP' },
        { '@type': 'Offer', price: 129900, priceCurrency: 'COP' },
      ],
    });
    const offer = makeOffer({ amount: 1, verified: false, url: 'https://tienda.com.co/p/aqua', title: 'Perfume Aqua Fresh' });
    const updated = applySnapshotToOffer(offer, snapshotFromHtml(html, offer.url), perfume, CO, '2026-10-12T00:00:00Z');
    expect(updated.evidence.verification).not.toBe('PAGE_VERIFIED');
    expect(updated.verificationError).toMatch(/varios precios/);
  });

  it('elige la variante por nombre cuando la página lo publica', () => {
    const [product] = productsFromJsonLd([
      JSON.stringify({
        '@type': 'Product',
        name: 'Perfume Aqua Fresh',
        brand: 'Aqua',
        offers: [
          { '@type': 'Offer', name: '50 ml', price: 79900, priceCurrency: 'COP' },
          { '@type': 'Offer', name: '100 ml', price: 129900, priceCurrency: 'COP' },
        ],
      }),
    ]);
    expect(resolveOffer(product!, perfume, 'COP').offer?.price).toBe(129900);
  });

  it('un rango de AggregateOffer sin detalle es ambiguo', () => {
    const [product] = productsFromJsonLd([JSON.stringify({ '@type': 'Product', name: 'Perfume Aqua Fresh', offers: { '@type': 'AggregateOffer', lowPrice: 79900, highPrice: 129900, priceCurrency: 'COP' } })]);
    expect(resolveOffer(product!, perfume, 'COP').ambiguous).toBe(true);
  });

  it('un solo precio sigue verificándose', () => {
    const [product] = productsFromJsonLd([JSON.stringify({ '@type': 'Product', name: 'Perfume Aqua Fresh', offers: { price: 129900, priceCurrency: 'COP' } })]);
    expect(resolveOffer(product!, perfume, 'COP')).toEqual({ offer: expect.objectContaining({ price: 129900 }), ambiguous: false });
  });
});

describe('varias ofertas del mismo producto (vendedores u oferta)', () => {
  const sony = makeIdentity();
  const URL_EXITO = 'https://www.exito.com/audifonos-sony-wh-1000xm5/p';
  const seller = (name: string) => ({ '@type': 'Organization', name });
  const sellerOffer = (price: number, name: string, availability = 'InStock') => ({
    '@type': 'Offer',
    price,
    priceCurrency: 'COP',
    itemCondition: 'https://schema.org/NewCondition',
    availability: `https://schema.org/${availability}`,
    url: URL_EXITO,
    seller: seller(name),
  });
  const productLd = (offers: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ '@type': 'Product', name: 'Audífonos Sony WH-1000XM5 Negro', brand: { '@type': 'Brand', name: 'Sony' }, sku: '3312911', ...extra, offers });
  const verifyLd = (json: string, url = URL_EXITO) => {
    const offer = makeOffer({ amount: 1, verified: false, url, title: 'Sony WH-1000XM5' });
    return applySnapshotToOffer(offer, { url, jsonLd: [json], metas: [] }, sony, CO, '2026-10-14T00:00:00Z');
  };

  it('varios vendedores en una ficha con código → precio disponible más bajo, verificado', () => {
    const updated = verifyLd(
      productLd([sellerOffer(1141990, 'Vendedor B'), sellerOffer(999900, 'Vendedor A'), sellerOffer(2249900, 'Tienda')], { gtin13: '4548736132610' }),
    );
    expect(updated.evidence.verification).toBe('PAGE_VERIFIED');
    expect(updated.price).toEqual({ amount: 999900, currency: 'COP' });
    expect(updated.evidence.note).toBe(LOWEST_PRICE_NOTE);
  });

  it('ignora la oferta agotada más barata si otra está disponible', () => {
    const [product] = productsFromJsonLd([
      productLd([sellerOffer(1050000, 'Vendedor C', 'OutOfStock'), sellerOffer(999900, 'Vendedor A'), sellerOffer(950000, 'Vendedor D', 'OutOfStock')]),
    ]);
    const resolved = resolveOffer(product!, sony, 'COP');
    expect(resolved.offer).toMatchObject({ price: 999900, availability: 'IN_STOCK' });
    expect(resolved.note).toBe(LOWEST_PRICE_NOTE);
  });

  it('precio normal + precio de oferta (mismo SKU y vendedor) → se verifica el de oferta', () => {
    const pair = (price: string) => ({ '@type': 'Offer', price, priceCurrency: 'COP', availability: 'https://schema.org/InStock', sku: '121398071', seller: seller('Falabella') });
    const updated = verifyLd(productLd([pair('2249903'), pair('1049900')], { sku: '121398071' }), 'https://www.falabella.com.co/falabella-co/product/121398071/sony');
    expect(updated.evidence.verification).toBe('PAGE_VERIFIED');
    expect(updated.price).toEqual({ amount: 1049900, currency: 'COP' });
    const [product] = productsFromJsonLd([productLd([pair('2249903'), pair('1049900')])]);
    expect(resolveOffer(product!, sony, 'COP').offer).toMatchObject({ price: 1049900, listPrice: 2249903 });
    // Tres precios del mismo vendedor (p. ej. uno con tarjeta): no se sabe cuál es el actual.
    const [three] = productsFromJsonLd([productLd([pair('2249903'), pair('1049900'), pair('999900')])]);
    expect(resolveOffer(three!, sony, 'COP').ambiguous).toBe(true);
  });

  it('priceSpecification: el precio de lista o tachado nunca es el precio', () => {
    const [product] = productsFromJsonLd([
      productLd({
        '@type': 'Offer',
        priceCurrency: 'COP',
        priceSpecification: [
          { '@type': 'UnitPriceSpecification', price: 2249903, priceType: 'https://schema.org/ListPrice' },
          { '@type': 'UnitPriceSpecification', price: 1049900 },
        ],
      }),
    ]);
    expect(product?.offers).toEqual([expect.objectContaining({ price: 1049900, listPrice: 2249903, currency: 'COP' })]);
    const [onlyList] = productsFromJsonLd([
      productLd({ '@type': 'Offer', priceSpecification: { price: 2249903, priceCurrency: 'COP', priceType: 'StrikethroughPrice' } }),
    ]);
    expect(onlyList?.offers).toEqual([]);
  });

  it('variantes reales (128 GB / 256 GB, 50 ml / 100 ml, URL por variante) siguen siendo ambiguas', () => {
    const phone = makeIdentity({ name: 'Celular Galaxy A55', brand: 'Samsung', model: 'A55' });
    const [byName] = productsFromJsonLd([
      JSON.stringify({
        '@type': 'Product',
        name: 'Celular Samsung Galaxy A55',
        sku: 'A55',
        offers: [
          { ...sellerOffer(1399000, 'Vendedor A'), name: '128 GB' },
          { ...sellerOffer(1599000, 'Vendedor B'), name: '256 GB' },
        ],
      }),
    ]);
    expect(resolveOffer(byName!, phone, 'COP').ambiguous).toBe(true);
    const perfume = makeIdentity({ name: 'Perfume Aqua Fresh', brand: 'Aqua', model: undefined });
    const [byUrl] = productsFromJsonLd([
      JSON.stringify({
        '@type': 'Product',
        name: 'Perfume Aqua Fresh',
        sku: 'AQUA',
        offers: [
          { '@type': 'Offer', price: 79900, priceCurrency: 'COP', sku: 'AQUA', url: 'https://tienda.com.co/aqua?variant=50ml', seller: seller('Aqua') },
          { '@type': 'Offer', price: 129900, priceCurrency: 'COP', sku: 'AQUA', url: 'https://tienda.com.co/aqua?variant=100ml', seller: seller('Aqua') },
        ],
      }),
    ]);
    expect(resolveOffer(byUrl!, perfume, 'COP').ambiguous).toBe(true);
  });

  it('una oferta usada entre vendedores deja la ficha como ambigua', () => {
    const used = { ...sellerOffer(700000, 'Vendedor U'), itemCondition: 'https://schema.org/UsedCondition' };
    const [product] = productsFromJsonLd([productLd([sellerOffer(999900, 'Vendedor A'), used])]);
    expect(resolveOffer(product!, sony, 'COP').ambiguous).toBe(true);
  });

  it('AggregateOffer de varios vendedores en un producto con GTIN → lowPrice verificado', () => {
    const aggregate = (extra: Record<string, unknown>) => ({ '@type': 'AggregateOffer', lowPrice: 999900, highPrice: 1141990, priceCurrency: 'COP', ...extra });
    const updated = verifyLd(productLd(aggregate({ offerCount: 4 }), { gtin13: '4548736132610' }));
    expect(updated.evidence.verification).toBe('PAGE_VERIFIED');
    expect(updated.price).toEqual({ amount: 999900, currency: 'COP' });
    expect(updated.evidence.note).toBe(LOWEST_PRICE_NOTE);
    // Sin offerCount, o sin GTIN válido, el rango sigue siendo ambiguo.
    const [noCount] = productsFromJsonLd([productLd(aggregate({}), { gtin13: '4548736132610' })]);
    expect(resolveOffer(noCount!, sony, 'COP').ambiguous).toBe(true);
    const [noGtin] = productsFromJsonLd([productLd(aggregate({ offerCount: 4 }))]);
    expect(resolveOffer(noGtin!, sony, 'COP').ambiguous).toBe(true);
  });
});

describe('revisión: moneda, microdatos y decimales', () => {
  it('una moneda "$" no se acepta como código ISO', () => {
    const [product] = productsFromJsonLd([JSON.stringify({ '@type': 'Product', name: 'X', offers: { price: 1000, priceCurrency: '$' } })]);
    expect(product?.offers[0]?.currency).toBeUndefined();
  });

  it('itemprop="priceCurrency" no se confunde con "price"', () => {
    const s = snapshotFromHtml('<span itemprop="priceCurrency" content="COP"></span><span itemprop="price" content="120000"></span>', 'https://t.com/p');
    expect(s.metas).toEqual(expect.arrayContaining([{ key: 'itemprop:pricecurrency', value: 'COP' }, { key: 'itemprop:price', value: '120000' }]));
  });

  it('"0.125" es decimal, no 125', () => {
    expect(parseLocaleNumber('0.125')).toBe(0.125);
    expect(parseLocaleNumber('79.900')).toBe(79900);
  });
});
