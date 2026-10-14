import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, checkPublicUrl, nameFromUrlSlug, originPattern, registrableDomain, safeHref } from '../src/url';

describe('canonicalizeUrl', () => {
  it('quita www, fragmento y parámetros de rastreo, y ordena el resto', () => {
    expect(canonicalizeUrl('https://www.Tienda.com.co/p/abc/?utm_source=x&b=2&gclid=1&a=1#reviews')).toBe('https://tienda.com.co/p/abc?a=1&b=2');
  });

  it('rechaza esquemas no web', () => {
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalizeUrl('file:///etc/passwd')).toBeNull();
  });
});

describe('registrableDomain', () => {
  it.each([
    ['https://articulo.mercadolibre.com.co/MCO-123', 'mercadolibre.com.co'],
    ['https://www.exito.com/x/p', 'exito.com'],
    ['https://es.alibaba.com/x', 'alibaba.com'],
    ['tienda.com.mx', 'tienda.com.mx'],
  ])('%s → %s', (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });
});

describe('checkPublicUrl (protección SSRF)', () => {
  it('acepta sitios públicos https', () => {
    expect(checkPublicUrl('https://www.falabella.com.co/producto/1').ok).toBe(true);
  });

  it.each([
    'http://tienda.com/p',
    'https://localhost/p',
    'https://127.0.0.1/p',
    'https://[::1]/p',
    'https://10.0.0.5/p',
    'https://2130706433/p',
    'https://0x7f000001/p',
    'https://router.local/p',
    'https://intranet/p',
    'https://user:pass@tienda.com/p',
    'https://tienda.com:8080/p',
    'javascript:alert(1)',
    'data:text/html,hola',
    'chrome://settings',
    'file:///C:/x',
  ])('rechaza %s', (input) => {
    expect(checkPublicUrl(input).ok).toBe(false);
  });

  it('permite http solo si se habilita explícitamente', () => {
    expect(checkPublicUrl('http://tienda.com/p', { allowHttp: true }).ok).toBe(true);
  });
});

describe('utilidades', () => {
  it('originPattern genera el patrón de permiso del host', () => {
    expect(originPattern('https://www.alkosto.com/x/p/123')).toBe('https://www.alkosto.com/*');
  });

  it('safeHref solo devuelve http(s)', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('https://a.co/x')).toBe('https://a.co/x');
  });

  it('nameFromUrlSlug deduce un nombre editable', () => {
    expect(nameFromUrlSlug('https://www.exito.com/audifonos-sony-wh-1000xm5-negro-3112345/p')).toBe('audifonos sony wh 1000xm5 negro');
    expect(nameFromUrlSlug('https://articulo.mercadolibre.com.co/MCO-1234567890-perfume-dior-sauvage-100-ml-_JM')).toBe('perfume dior sauvage 100 ml jm');
    expect(nameFromUrlSlug('https://tienda.com/')).toBeNull();
  });
});
