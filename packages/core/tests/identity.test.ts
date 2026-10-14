import { describe, expect, it } from 'vitest';
import { snapshotFromHtml } from '../src/extract';
import { cleanPageTitle, identityFromSnapshot, identityFromUrlOnly, suggestedAttributes } from '../src/identity';

describe('identityFromSnapshot', () => {
  it('usa JSON-LD como fuente principal y guarda el precio solo como referencia', () => {
    const html = `<html><head><link rel="canonical" href="https://tienda.com.co/p/dior?utm_source=x">
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        name: 'Perfume Dior Sauvage EDT 100 ml',
        brand: 'Dior',
        gtin13: '3348901250153',
        image: 'https://cdn.tienda.com.co/dior.jpg',
        offers: { price: 459900, priceCurrency: 'COP' },
      })}</script></head></html>`;
    const id = identityFromSnapshot(snapshotFromHtml(html, 'https://tienda.com.co/p/dior'), 'COP');
    expect(id).toMatchObject({
      name: 'Perfume Dior Sauvage EDT 100 ml',
      brand: 'Dior',
      gtin: '3348901250153',
      identifiedBy: 'PAGE_STRUCTURED_DATA',
      sourceUrl: 'https://tienda.com.co/p/dior',
      imageUrl: 'https://cdn.tienda.com.co/dior.jpg',
      sourcePrice: { amount: 459900, currency: 'COP' },
    });
    expect(id.attributes['Volumen']).toBe('100 ml');
    expect(id.uncertainties).toEqual([]);
  });

  it('sin datos estructurados usa h1/título y lo marca como duda', () => {
    const html = '<html><head><title>Licuadora Oster 600W | Tienda X</title></head><body><h1>Licuadora Oster 600W</h1></body></html>';
    const id = identityFromSnapshot(snapshotFromHtml(html, 'https://x.com/licuadora'), 'COP');
    expect(id.name).toBe('Licuadora Oster 600W');
    expect(id.identifiedBy).toBe('PAGE_METADATA');
    expect(id.uncertainties.join(' ')).toMatch(/no publica datos estructurados/);
    expect(id.brand).toBeUndefined();
  });

  it('señala variantes múltiples como duda y las ofrece como alternativas', () => {
    const ld = {
      '@type': 'ProductGroup',
      name: 'Galaxy A55',
      hasVariant: [
        { '@type': 'Product', name: 'Galaxy A55 128GB', offers: { price: 1, priceCurrency: 'COP' } },
        { '@type': 'Product', name: 'Galaxy A55 256GB', offers: { price: 2, priceCurrency: 'COP' } },
      ],
    };
    const id = identityFromSnapshot(snapshotFromHtml(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`, 'https://x.com/a55'), 'COP');
    expect(id.uncertainties.join(' ')).toMatch(/varias variantes/);
    expect(id.alternatives?.map((a) => a.name)).toEqual(['Galaxy A55 256GB']);
  });

  it('rechaza imágenes no https', () => {
    const id = identityFromSnapshot({ url: 'https://x.com/p', jsonLd: [], metas: [{ key: 'og:title', value: 'Mesa' }, { key: 'og:image', value: 'http://x.com/a.jpg' }] }, 'COP');
    expect(id.imageUrl).toBeUndefined();
  });
});

describe('utilidades de identidad', () => {
  it('cleanPageTitle quita el nombre de la tienda', () => {
    expect(cleanPageTitle('Audífonos Sony WH-1000XM5 | Alkosto')).toBe('Audífonos Sony WH-1000XM5');
    expect(cleanPageTitle('Cepillo eléctrico Oral-B Pro 3 - Tienda')).toBe('Cepillo eléctrico Oral-B Pro 3');
  });

  it('suggestedAttributes propone capacidad y presentación', () => {
    expect(suggestedAttributes('Samsung A55 256GB pack x2')).toEqual({ Capacidad: '256 GB', 'Unidades por paquete': '2' });
  });

  it('identityFromUrlOnly marca la identidad como deducida', () => {
    const id = identityFromUrlOnly('https://www.exito.com/licuadora-oster-600w-123456/p', 'El sitio bloqueó la lectura');
    expect(id.name).toBe('licuadora oster 600w');
    expect(id.identifiedBy).toBe('URL_SLUG');
    expect(id.uncertainties[0]).toBe('El sitio bloqueó la lectura');
  });
});
