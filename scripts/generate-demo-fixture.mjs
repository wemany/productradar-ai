#!/usr/bin/env node
/**
 * Genera fixtures/explicitly-demo-data.json.
 *
 * TODO ES FICTICIO: marca "DemoSonic", tiendas en dominios reservados `.example`
 * (RFC 2606), precios inventados y GTIN de circulación restringida (prefijo 200).
 * Sirve para que el jurado vea el flujo sin red ni claves. Nunca se presenta
 * como resultado real: la extensión muestra "DATOS DE DEMOSTRACIÓN" en todo momento.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'fixtures', 'explicitly-demo-data.json');

const GTIN = '2000000000015';

function page({ title, jsonLd, metas = [] }) {
  const metaTags = metas.map(([k, v]) => `<meta property="${k}" content="${v}">`).join('\n    ');
  const ld = jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '';
  return `<!doctype html>
<html lang="es-CO">
  <head>
    <meta charset="utf-8">
    <title>${title} | Tienda ficticia de demostración</title>
    ${metaTags}
    ${ld}
  </head>
  <body><h1>${title}</h1><p>Página ficticia de demostración.</p></body>
</html>`;
}

const product = (name, offers, extra = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name,
  brand: { '@type': 'Brand', name: 'DemoSonic' },
  ...extra,
  offers,
});

const fixture = {
  _notice:
    'DATOS DE DEMOSTRACIÓN — FICTICIOS. Marca, tiendas (dominios .example), precios y referencias inventados. No representan el mercado real ni búsquedas reales.',
  version: 1,
  market: 'CO',
  product: {
    name: 'Audífonos inalámbricos de diadema DemoSonic Aura X2',
    brand: 'DemoSonic',
    model: 'Aura X2',
    gtin: GTIN,
    englishName: 'wireless over-ear bluetooth headphones',
    attributes: { Color: 'Negro', Conectividad: 'Bluetooth 5.3' },
    sourceUrl: 'https://tienda-origen.example/producto/demosonic-aura-x2',
    searchQueries: [],
    uncertainties: [],
    identifiedBy: 'DEMO_FIXTURE',
    confidence: 1,
  },
  financials: {
    currency: 'COP',
    sellingPrice: 100000,
    productCost: 40000,
    productCostSource: 'USER',
    shippingPaidBySeller: 8000,
    paymentFeePercent: 3,
    paymentFeeFixed: 1000,
    acquisitionCostPerOrder: 15000,
    expectedReturnLossPerOrder: 2000,
    otherVariableCosts: 1000,
    taxMode: 'EXCLUDED',
  },
  marketResults: [
    {
      title: 'Audífonos DemoSonic Aura X2 Bluetooth Negro',
      url: 'https://tienda-demo-uno.example/producto/demosonic-aura-x2?utm_source=demo',
      snippet: 'Compra audífonos DemoSonic Aura X2 con envío a toda Colombia. Precio $ 104.900.',
      publisherName: 'Tienda Demo Uno',
    },
    {
      title: 'DemoSonic Aura X2 - Audífonos de diadema inalámbricos',
      url: 'https://megatienda-demo.example/p/demosonic-aura-x2-negro',
      snippet: 'Audífonos DemoSonic Aura X2 negro. Paga contraentrega en Colombia. $ 109.900 COP.',
      publisherName: 'Megatienda Demo',
    },
    {
      title: 'Aura X2 de DemoSonic | Audio Demo Tres',
      url: 'https://audio-demo-tres.example/products/demosonic-aura-x2',
      snippet: 'Audífonos bluetooth DemoSonic Aura X2, garantía en Colombia.',
      publisherName: 'Audio Demo Tres',
    },
    {
      title: 'Audífonos DemoSonic Aura X2 inalámbricos',
      url: 'https://electro-demo-cuatro.example/producto/demosonic-aura-x2',
      snippet: 'DemoSonic Aura X2 en oferta: $ 94.900. Envíos en Colombia.',
      publisherName: 'Electro Demo Cuatro',
    },
    {
      title: 'Pack x2 Audífonos DemoSonic Aura X2',
      url: 'https://bazar-demo-cinco.example/producto/pack-2-demosonic-aura-x2',
      snippet: 'Combo de 2 unidades DemoSonic Aura X2 por $ 189.900.',
      publisherName: 'Bazar Demo Cinco',
    },
    {
      title: 'DemoSonic Aura X2 Reacondicionado',
      url: 'https://outlet-demo-seis.example/producto/demosonic-aura-x2-reacondicionado',
      snippet: 'Audífonos reacondicionados con garantía de 3 meses. $ 69.900.',
      publisherName: 'Outlet Demo Seis',
    },
    {
      title: 'Audífonos de diadema Bluetooth genéricos compatibles',
      url: 'https://tienda-demo-siete.example/producto/audifonos-diadema-bluetooth-generico',
      snippet: 'Audífonos genéricos de diadema, compatibles con todos los celulares. $ 39.900.',
      publisherName: 'Tienda Demo Siete',
    },
    {
      title: 'Los 10 mejores audífonos de diadema de 2026',
      url: 'https://blog-demo.example/blog/mejores-audifonos-2026',
      snippet: 'Comparativa de audífonos: DemoSonic Aura X2 y otros modelos.',
      publisherName: 'Blog Demo',
    },
    {
      title: 'Resultados para aura x2',
      url: 'https://marketplace-demo.example/search?q=aura+x2',
      snippet: 'Encuentra audífonos DemoSonic Aura X2 y más.',
      publisherName: 'Marketplace Demo',
    },
    {
      title: 'DemoSonic Aura X2 Wireless Headphones',
      url: 'https://shop-global-demo.example/product/demosonic-aura-x2',
      snippet: 'Ships worldwide. US$ 29.99.',
      publisherName: 'Shop Global Demo',
    },
    {
      title: 'DemoSonic Aura X2 Edición Negro',
      url: 'https://tienda-demo-once.example/producto/demosonic-aura-x2-edicion-negro',
      snippet: 'Audífonos DemoSonic Aura X2, disponibles en Colombia.',
      publisherName: 'Tienda Demo Once',
    },
  ],
  supplierResults: [
    {
      title: 'Proveedor ficticio A — Wireless Over-Ear Headphones Bluetooth 5.3 (demo)',
      url: 'https://www.alibaba.com/trade/search?SearchText=wireless+over-ear+headphones+bluetooth+5.3',
      snippet: 'US$ 6.80 - 9.20 · Min. order: 500 pieces · FOB Shenzhen · datos ficticios de demostración',
    },
    {
      title: 'Proveedor ficticio B — Foldable Bluetooth Headphones (demo)',
      url: 'https://www.alibaba.com/trade/search?SearchText=foldable+bluetooth+headphones',
      snippet: '$8.50-$11.00 · 100 Pieces (Min. Order) · datos ficticios de demostración',
    },
    {
      title: 'Proveedor ficticio C — Auriculares inalámbricos de diadema (demo)',
      url: 'https://spanish.alibaba.com/trade/search?SearchText=auriculares+inalambricos+diadema',
      snippet: 'US$ 7,10-9,90 · Pedido mínimo: 200 piezas · datos ficticios de demostración',
    },
  ],
  pages: {
    'https://tienda-demo-uno.example/producto/demosonic-aura-x2': {
      status: 200,
      html: page({
        title: 'Audífonos DemoSonic Aura X2 Bluetooth Negro',
        jsonLd: product('Audífonos DemoSonic Aura X2 Bluetooth Negro', {
          '@type': 'Offer',
          price: 104900,
          priceCurrency: 'COP',
          availability: 'https://schema.org/InStock',
        }, { gtin13: GTIN, sku: 'DS-AX2-N' }),
      }),
    },
    'https://megatienda-demo.example/p/demosonic-aura-x2-negro': {
      status: 200,
      html: page({
        title: 'DemoSonic Aura X2 Negro',
        jsonLd: {
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebPage', name: 'DemoSonic Aura X2' },
            product('DemoSonic Aura X2 Negro', [{ '@type': 'Offer', price: '109900.00', priceCurrency: 'COP', availability: 'InStock' }], { gtin: GTIN }),
          ],
        },
      }),
    },
    'https://audio-demo-tres.example/products/demosonic-aura-x2': {
      status: 200,
      html: page({
        title: 'DemoSonic Aura X2',
        metas: [
          ['og:title', 'Audífonos DemoSonic Aura X2'],
          ['og:type', 'product'],
          ['product:price:amount', '99900'],
          ['product:price:currency', 'COP'],
          ['product:availability', 'in stock'],
          ['product:brand', 'DemoSonic'],
        ],
      }),
    },
    'https://electro-demo-cuatro.example/producto/demosonic-aura-x2': { status: 403 },
    'https://bazar-demo-cinco.example/producto/pack-2-demosonic-aura-x2': {
      status: 200,
      html: page({
        title: 'Pack x2 Audífonos DemoSonic Aura X2',
        jsonLd: product('Pack x2 Audífonos DemoSonic Aura X2', { '@type': 'Offer', price: 189900, priceCurrency: 'COP', availability: 'https://schema.org/InStock' }),
      }),
    },
    'https://outlet-demo-seis.example/producto/demosonic-aura-x2-reacondicionado': {
      status: 200,
      html: page({
        title: 'DemoSonic Aura X2 Reacondicionado',
        jsonLd: product('DemoSonic Aura X2 Reacondicionado', { '@type': 'Offer', price: 69900, priceCurrency: 'COP', availability: 'https://schema.org/InStock' }),
      }),
    },
    'https://tienda-demo-siete.example/producto/audifonos-diadema-bluetooth-generico': {
      status: 200,
      html: page({
        title: 'Audífonos de diadema Bluetooth genéricos',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Audífonos de diadema Bluetooth genéricos compatibles',
          offers: { '@type': 'Offer', price: 39900, priceCurrency: 'COP' },
        },
      }),
    },
    'https://shop-global-demo.example/product/demosonic-aura-x2': {
      status: 200,
      html: page({
        title: 'DemoSonic Aura X2 Wireless Headphones',
        jsonLd: product('DemoSonic Aura X2 Wireless Headphones', { '@type': 'Offer', price: '29.99', priceCurrency: 'USD' }, { gtin13: GTIN }),
      }),
    },
    'https://tienda-demo-once.example/producto/demosonic-aura-x2-edicion-negro': {
      status: 200,
      html: page({
        title: 'DemoSonic Aura X2 Edición Negro',
        jsonLd: product('DemoSonic Aura X2 Edición Negro', { '@type': 'Offer', price: '114900' }),
      }),
    },
  },
};

writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`Fixture de demostración escrito en ${out}`);
