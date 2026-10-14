import { describe, expect, it } from 'vitest';
import { AD_COUNT_UNVERIFIABLE, buildAdResearch, buildMetaAdLibraryUrl } from '../src/ads';
import { isAlibabaUrl, parseAlibabaSnippet, resultsToSupplierReferences } from '../src/alibaba';
import { MARKET_CONFIGS } from '../src/markets';
import { makeIdentity } from './helpers';

describe('parseAlibabaSnippet', () => {
  it.each([
    ['US$ 6.80 - 9.20 · Min. order: 500 pieces · FOB', { priceMin: 6.8, priceMax: 9.2, moq: 500, moqUnit: 'pieces', incoterm: 'FOB' }],
    ['$8.50-$11.00 · 100 Pieces (Min. Order)', { priceMin: 8.5, priceMax: 11, moq: 100 }],
    ['US$ 7,10-9,90 Pedido mínimo: 200 piezas', { priceMin: 7.1, priceMax: 9.9, moq: 200 }],
    ['MOQ: 1,000 units, $2.15', { priceMin: 2.15, moq: 1000 }],
  ])('%s', (text, expected) => {
    expect(parseAlibabaSnippet(text)).toMatchObject(expected);
  });

  it('sin precio visible no inventa uno', () => {
    expect(parseAlibabaSnippet('Bluetooth headphones manufacturers').priceMin).toBeUndefined();
  });
});

describe('referencias de Alibaba', () => {
  it('solo acepta dominios alibaba.com (no AliExpress ni lookalikes)', () => {
    expect(isAlibabaUrl('https://www.alibaba.com/product-detail/x.html')).toBe(true);
    expect(isAlibabaUrl('https://spanish.alibaba.com/p/x')).toBe(true);
    expect(isAlibabaUrl('https://www.aliexpress.com/item/1.html')).toBe(false);
    expect(isAlibabaUrl('https://alibaba.com.evil.example/x')).toBe(false);
    expect(isAlibabaUrl('http://www.alibaba.com/x')).toBe(false);
  });

  it('limita a 5 referencias, en USD, como precios indicativos', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      title: `Sony WH-1000XM5 compatible headphones ${i}`,
      url: `https://www.alibaba.com/product-detail/item_${i}.html`,
      snippet: `US$ ${i + 1}.00 - ${i + 3}.00 Min. order: 10 pieces`,
    }));
    const refs = resultsToSupplierReferences(items, makeIdentity(), '2026-10-12T00:00:00.000Z');
    expect(refs).toHaveLength(5);
    expect(refs.every((r) => r.priceMin?.currency === 'USD')).toBe(true);
    expect(refs.every((r) => r.evidence.verification === 'SEARCH_SNIPPET_ONLY')).toBe(true);
    expect(refs[0]?.evidence.note).toMatch(/no es costo puesto en destino/);
  });
});

describe('publicidad', () => {
  it('construye el enlace oficial de Meta Ad Library por país y término', () => {
    const url = new URL(buildMetaAdLibraryUrl('Sony WH-1000XM5', 'CO'));
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.pathname).toBe('/ads/library/');
    expect(url.searchParams.get('country')).toBe('CO');
    expect(url.searchParams.get('q')).toBe('Sony WH-1000XM5');
    expect(url.searchParams.get('active_status')).toBe('active');
  });

  it('nunca inventa conteos de anuncios', () => {
    const r = buildAdResearch(makeIdentity(), MARKET_CONFIGS.CO);
    expect(r.activeAdsCount).toBeNull();
    expect(r.historicalAdsCount).toBeNull();
    expect(AD_COUNT_UNVERIFIABLE).toMatch(/no verificable/);
  });
});
