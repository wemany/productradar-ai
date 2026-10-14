import { describe, expect, it } from 'vitest';
import { findPrices, formatMoney, formatMoneyRange, parseLocaleNumber, parseStructuredPrice, pickSnippetPrice } from '../src/money';

const CO = { marketCurrency: 'COP' };

describe('parseLocaleNumber', () => {
  it.each([
    ['79.900', 79900],
    ['1.299.000', 1299000],
    ['1.299.000,50', 1299000.5],
    ['1,299,000.50', 1299000.5],
    ['79,900', 79900],
    ['12.50', 12.5],
    ['79,90', 79.9],
    ['100000', 100000],
    [`7${String.fromCharCode(0xa0)}900`, 7900],
  ])('%s → %d', (input, expected) => {
    expect(parseLocaleNumber(input)).toBe(expected);
  });

  it('rechaza agrupaciones inválidas', () => {
    expect(parseLocaleNumber('1.29.000')).toBeNull();
    expect(parseLocaleNumber('abc')).toBeNull();
  });
});

describe('parseStructuredPrice', () => {
  it('acepta números y strings con punto decimal', () => {
    expect(parseStructuredPrice(79900, 'COP')).toBe(79900);
    expect(parseStructuredPrice('79900.00', 'COP')).toBe(79900);
    expect(parseStructuredPrice('29.99', 'USD')).toBe(29.99);
  });

  it('interpreta "79.900" como miles en monedas sin decimales (COP)', () => {
    expect(parseStructuredPrice('79.900', 'COP')).toBe(79900);
    expect(parseStructuredPrice('79.900', 'USD')).toBe(79.9);
  });

  it('rechaza valores vacíos, cero o no numéricos', () => {
    expect(parseStructuredPrice('', 'COP')).toBeNull();
    expect(parseStructuredPrice(0, 'COP')).toBeNull();
    expect(parseStructuredPrice('gratis', 'COP')).toBeNull();
    expect(parseStructuredPrice(null, 'COP')).toBeNull();
  });
});

describe('findPrices', () => {
  it('detecta pesos colombianos con distintos formatos', () => {
    const prices = findPrices('Antes $ 120.000, ahora $79.900 COP y envío gratis', CO);
    expect(prices.map((p) => [p.amount, p.currency])).toEqual([
      [120000, 'COP'],
      [79900, 'COP'],
    ]);
  });

  it('detecta USD explícito y rangos', () => {
    const [p] = findPrices('US$ 1.20 - 3.50 / piece', CO);
    expect(p).toMatchObject({ amount: 1.2, maxAmount: 3.5, currency: 'USD' });
  });

  it('detecta sufijos de moneda', () => {
    const prices = findPrices('Precio: 59.900 pesos', CO);
    expect(prices[0]).toMatchObject({ amount: 59900, currency: 'COP' });
  });

  it('en Perú "$" significa dólar, S/ significa sol', () => {
    const prices = findPrices('S/ 59.90 o $ 15.00', { marketCurrency: 'PEN' });
    expect(prices.map((p) => p.currency)).toEqual(['PEN', 'USD']);
  });

  it('no inventa precios sin símbolo ni código de moneda', () => {
    expect(findPrices('Modelo 2024 con 128 GB y 3 cuotas', CO)).toEqual([]);
  });

  it('no confunde un rango con cuotas', () => {
    const [p] = findPrices('$ 50.000 a 12 cuotas', CO);
    expect(p?.amount).toBe(50000);
    expect(p?.maxAmount).toBeUndefined();
  });
});

describe('pickSnippetPrice', () => {
  it('reporta cuántos precios distintos hay (ambigüedad)', () => {
    const r = pickSnippetPrice('Antes $ 120.000 ahora $ 99.900', CO, 'COP');
    expect(r?.price).toEqual({ amount: 120000, currency: 'COP' });
    expect(r?.distinctPrices).toBe(2);
  });
});

describe('formatMoney', () => {
  it('formatea COP con separador de miles y código', () => {
    expect(formatMoney(79900, 'COP', 'es-CO')).toBe('$ 79.900 COP');
    expect(formatMoney(7900, 'COP', 'es-CO')).toBe('$ 7.900 COP');
  });

  it('muestra decimales solo cuando aplican', () => {
    expect(formatMoney(12.5, 'USD', 'es-CO')).toBe('US$ 12,50 USD');
    expect(formatMoney(12, 'USD', 'es-CO')).toBe('US$ 12 USD');
  });

  it('formatea negativos', () => {
    expect(formatMoney(-5000, 'COP', 'es-CO')).toBe('−$ 5.000 COP');
  });
});

describe('formatMoneyRange', () => {
  it('rango compacto con un solo código de moneda', () => {
    expect(formatMoneyRange(6.8, 9.2, 'USD', 'es-CO')).toBe('US$ 6,80 – 9,20 USD');
    expect(formatMoneyRange(79900, undefined, 'COP', 'es-CO')).toBe('$ 79.900 COP');
  });
});
