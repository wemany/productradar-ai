import type { PageSnapshot } from '@productradar/core';

/**
 * Se inyecta en la pestaña activa con chrome.scripting (solo tras una acción
 * del usuario). DEBE ser autocontenida: Chrome serializa su código fuente.
 *
 * Lee únicamente metadatos públicos de producto: JSON-LD, etiquetas meta,
 * microdatos de precio, título, h1 y canónica. No lee formularios, campos de
 * entrada, cookies, almacenamiento ni datos personales.
 */
export function collectPageSnapshot(): PageSnapshot {
  const MAX_LD = 400000;
  const relevant = /^(og:|product:|twitter:title|twitter:image|description$|itemprop:)/i;
  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    .slice(0, 25)
    .map((s) => (s.textContent || '').trim())
    .filter((t) => t.length > 0 && t.length <= MAX_LD);

  const metas: Array<{ key: string; value: string }> = [];
  document.querySelectorAll('meta').forEach((m) => {
    const itemprop = m.getAttribute('itemprop');
    const key = m.getAttribute('property') || m.getAttribute('name') || (itemprop ? `itemprop:${itemprop}` : null);
    const value = m.getAttribute('content');
    if (key && value !== null && relevant.test(key) && metas.length < 250) metas.push({ key: key.toLowerCase(), value: value.slice(0, 1000) });
  });
  document.querySelectorAll('[itemprop="price"],[itemprop="priceCurrency"],[itemprop="availability"],[itemprop="gtin13"],[itemprop="gtin"],[itemprop="sku"],[itemprop="brand"]').forEach((el) => {
    if (el.tagName === 'META' || el.closest('form') || metas.length >= 250) return;
    const prop = (el.getAttribute('itemprop') || '').toLowerCase();
    const value = el.getAttribute('content') || el.getAttribute('href') || (el.textContent || '').trim();
    if (prop && value) metas.push({ key: `itemprop:${prop}`, value: value.slice(0, 300) });
  });

  const priceTexts = Array.from(document.querySelectorAll('[class*="price" i],[id*="price" i],[class*="precio" i],[data-testid*="price" i]'))
    .filter((el) => !el.closest('form') && (el as HTMLElement).offsetParent !== null)
    .map((el) => ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0 && t.length <= 60 && /\d/.test(t))
    .slice(0, 8);

  const h1 = document.querySelector('h1');
  return {
    url: location.href,
    title: document.title.slice(0, 300),
    h1: h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : undefined,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || undefined,
    lang: document.documentElement.lang || undefined,
    jsonLd,
    metas,
    priceTexts,
  };
}
