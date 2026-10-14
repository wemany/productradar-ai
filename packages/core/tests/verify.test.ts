import { describe, expect, it } from 'vitest';
import { snapshotFromHtml } from '../src/extract';
import { MARKET_CONFIGS } from '../src/markets';
import { parseLocaleNumber } from '../src/money';
import { productsFromJsonLd } from '../src/extract';
import { applySnapshotToOffer, resolveOffer } from '../src/verify';
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
