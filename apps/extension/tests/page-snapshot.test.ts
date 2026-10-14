// @vitest-environment happy-dom
import { identityFromSnapshot } from '@productradar/core';
import { describe, expect, it } from 'vitest';
import { collectPageSnapshot } from '../src/services/page-snapshot';

describe('collectPageSnapshot (script inyectado en la pestaña)', () => {
  it('lee solo metadatos públicos del producto y nunca formularios', () => {
    document.title = 'Silla ergonómica | Tienda';
    document.documentElement.lang = 'es-CO';
    document.head.innerHTML = `
      <meta property="og:title" content="Silla ergonómica Pro">
      <meta name="viewport" content="width=device-width">
      <link rel="canonical" href="https://tienda.com.co/p/silla">
      <script type="application/ld+json">{"@type":"Product","name":"Silla ergonómica Pro","brand":"Ergo","offers":{"price":"459900","priceCurrency":"COP"}}</script>`;
    document.body.innerHTML = `
      <h1>Silla ergonómica Pro</h1>
      <span itemprop="price" content="459900">$ 459.900</span>
      <form><input name="email" value="cliente@correo.com"><input type="password" value="secreto"><span class="price">$ 1</span></form>`;

    const snapshot = collectPageSnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('cliente@correo.com');
    expect(serialized).not.toContain('secreto');
    expect(snapshot.metas.some((m) => m.key === 'viewport')).toBe(false);
    expect(snapshot.metas).toEqual(expect.arrayContaining([{ key: 'og:title', value: 'Silla ergonómica Pro' }, { key: 'itemprop:price', value: '459900' }]));
    expect(snapshot.jsonLd).toHaveLength(1);
    expect(snapshot.h1).toBe('Silla ergonómica Pro');
    expect(snapshot.canonical).toBe('https://tienda.com.co/p/silla');

    const identity = identityFromSnapshot(snapshot, 'COP');
    expect(identity).toMatchObject({ name: 'Silla ergonómica Pro', brand: 'Ergo', identifiedBy: 'PAGE_STRUCTURED_DATA', sourcePrice: { amount: 459900, currency: 'COP' } });
  });

  it('es autocontenida (Chrome serializa su código fuente)', () => {
    const source = collectPageSnapshot.toString();
    expect(source).not.toMatch(/\bimport\b|require\(|__vite|_core|productradar/);
  });
});
