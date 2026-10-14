import { describe, expect, it } from 'vitest';
import { exclusionReason, histogram, median, summarizeMarketPrices } from '../src/pricing';
import { makeOffer } from './helpers';

describe('median', () => {
  it('impar y par', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('summarizeMarketPrices — regla de oro', () => {
  const offers = [
    makeOffer({ amount: 100000, url: 'https://a.com.co/p/1' }),
    makeOffer({ amount: 120000, url: 'https://b.com.co/p/1' }),
    makeOffer({ amount: 110000, url: 'https://c.com.co/p/1' }),
    // Visible solo en buscador: NO entra en la estadística principal
    makeOffer({ amount: 50000, verified: false, url: 'https://d.com.co/p/1' }),
    // Variante: NO entra
    makeOffer({ amount: 200000, matchType: 'VARIANT', url: 'https://e.com.co/p/1' }),
    // Otra moneda: NO entra
    makeOffer({ amount: 30, currency: 'USD', url: 'https://f.com/p/1' }),
    // Excluida por el usuario: NO entra
    makeOffer({ amount: 1000, userOverride: 'EXCLUDED', url: 'https://g.com.co/p/1' }),
    // Sin precio
    makeOffer({ url: 'https://h.com.co/p/1' }),
  ];

  it('solo usa precios verificados, exactos y en la moneda del mercado', () => {
    const s = summarizeMarketPrices(offers, 'COP');
    expect(s.verified).toMatchObject({ count: 3, min: 100000, median: 110000, max: 120000, domains: 3 });
  });

  it('separa precios del buscador como referencia secundaria', () => {
    const s = summarizeMarketPrices(offers, 'COP');
    expect(s.snippetReference).toMatchObject({ count: 1, min: 50000 });
  });

  it('cuenta los motivos de exclusión', () => {
    const s = summarizeMarketPrices(offers, 'COP');
    const reasons = Object.fromEntries(s.exclusions.map((e) => [e.reason, e.count]));
    expect(reasons).toEqual({ NOT_PAGE_VERIFIED: 1, NOT_EXACT: 1, OTHER_CURRENCY: 1, EXCLUDED_BY_USER: 1, NO_PRICE: 1 });
  });

  it('marcar manualmente como exacta incorpora la oferta (si está verificada)', () => {
    const variant = makeOffer({ amount: 130000, matchType: 'VARIANT', userOverride: 'EXACT', url: 'https://x.com.co/p/1' });
    expect(exclusionReason(variant, 'COP')).toBeNull();
    const s = summarizeMarketPrices([...offers, variant], 'COP');
    expect(s.verified?.count).toBe(4);
  });

  it('un precio no verificado nunca altera la mediana', () => {
    const base = summarizeMarketPrices(offers, 'COP').verified?.median;
    const withSnippet = summarizeMarketPrices([...offers, makeOffer({ amount: 1, verified: false })], 'COP').verified?.median;
    expect(withSnippet).toBe(base);
  });

  it('detecta precios atípicos', () => {
    const s = summarizeMarketPrices([...offers, makeOffer({ amount: 10000, url: 'https://z.com.co/p/1' })], 'COP');
    expect(s.outliers).toHaveLength(1);
  });

  it('devuelve null si no hay precios verificables', () => {
    expect(summarizeMarketPrices([makeOffer({ amount: 1, verified: false })], 'COP').verified).toBeNull();
  });
});

describe('histogram', () => {
  it('distribuye valores en intervalos', () => {
    const bins = histogram([1, 2, 3, 4, 10], 3);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(5);
    expect(histogram([5, 5])).toEqual([{ from: 5, to: 5, count: 2 }]);
  });
});
