import { normalizeText } from './text';

const TRACKING_PARAMS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'yclid',
  'srsltid',
  '_ga',
  '_gl',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_',
  'referrer',
  'spm',
  'scm',
  'tracking_id',
  'matt_tool',
  'matt_word',
  'position',
  'search_layout',
]);

/** Parsea una URL absoluta http(s) o devuelve null. */
export function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * URL limpia para ABRIR y LEER: sin fragmento, credenciales ni rastreadores,
 * pero conservando el host original (www incluido) para no romper el sitio.
 */
export function cleanUrl(input: string): string | null {
  return normalizeUrl(input, false);
}

/** Clave para DEDUPLICAR: como `cleanUrl` pero además sin `www.`. Nunca se usa para leer la página. */
export function canonicalizeUrl(input: string): string | null {
  return normalizeUrl(input, true);
}

function normalizeUrl(input: string, stripWww: boolean): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (stripWww) url.hostname = url.hostname.replace(/^www\./, '');
  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    if (k.startsWith('utm_') || TRACKING_PARAMS.has(k)) continue;
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function getHostname(input: string): string {
  const url = parseHttpUrl(input);
  return url ? url.hostname.toLowerCase().replace(/^www\./, '') : '';
}

const MULTI_PART_SUFFIXES = [
  'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co',
  'com.mx', 'org.mx', 'gob.mx',
  'com.pe', 'org.pe', 'gob.pe',
  'co.uk', 'com.ar', 'com.br', 'com.cn', 'com.au', 'co.jp',
];

/** Dominio registrable aproximado (articulo.mercadolibre.com.co → mercadolibre.com.co). */
export function registrableDomain(input: string): string {
  const host = input.includes('/') ? getHostname(input) : input.toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.includes(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

/** Origen con comodín para solicitar permisos opcionales: https://ejemplo.com/* */
export function originPattern(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;
  return `${url.protocol}//${url.hostname}/*`;
}

export interface UrlSafety {
  ok: boolean;
  reason?: string;
}

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.arpa', '.test', '.invalid'];

function isIpLiteral(hostname: string): boolean {
  if (hostname.startsWith('[') || hostname.includes(':')) return true; // IPv6
  if (/^\d+$/.test(hostname)) return true; // entero decimal (http://2130706433)
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  return /^[\d.]+$/.test(hostname) || /^(\d+|0x[0-9a-f]+)(\.(\d+|0x[0-9a-f]+)){1,3}$/i.test(hostname);
}

/**
 * Valida que una URL apunte a un sitio público antes de leerla automáticamente.
 * Rechaza esquemas no web, credenciales embebidas, IPs literales, localhost,
 * dominios internos y puertos no estándar. (La resolución DNS a IPs privadas no
 * se puede comprobar desde el navegador; ver docs/limitations.md.)
 */
export function checkPublicUrl(input: string, opts: { allowHttp?: boolean } = {}): UrlSafety {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'URL inválida' };
  }
  if (url.protocol !== 'https:' && !(opts.allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: `Esquema no permitido (${url.protocol})` };
  }
  if (url.username || url.password) return { ok: false, reason: 'La URL contiene credenciales' };
  // "localhost." y "router.local." (con punto final) equivalen a sus versiones sin punto.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host || !host.includes('.')) return { ok: false, reason: 'Dominio no público' };
  if (isIpLiteral(host)) return { ok: false, reason: 'No se permiten direcciones IP directas' };
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'Dominio interno o reservado' };
  }
  if (url.port && url.port !== '443' && url.port !== '80') return { ok: false, reason: 'Puerto no estándar' };
  return { ok: true };
}

/** Href seguro para mostrar enlaces externos (solo http/https). */
export function safeHref(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const url = parseHttpUrl(input);
  return url ? url.toString() : undefined;
}

const SLUG_NOISE = /^(p|dp|producto|productos|product|products|item|items|articulo|tienda|shop|store|co|es|catalogo|categoria|c|pd|ip|mco|mlm|mpe|mlc)$/i;

/**
 * Deduce un nombre provisional a partir de la URL (último segmento con palabras).
 * Solo se usa como sugerencia editable cuando la página no se puede leer.
 */
export function nameFromUrlSlug(input: string): string | null {
  const url = parseHttpUrl(input);
  if (!url) return null;
  const segments = url.pathname
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter(Boolean);
  let best = '';
  for (const segment of segments) {
    const words = segment
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/\b(MCO|MLM|MPE|MLC|MLA)-?\d+\b/gi, ' ')
      .split(/[-_+\s]+/)
      .filter((w) => w && !/^\d{5,}$/.test(w) && !SLUG_NOISE.test(w));
    const candidate = words.join(' ');
    if (words.length >= 2 && candidate.length > best.length) best = candidate;
  }
  const normalized = normalizeText(best);
  return normalized.length >= 4 ? normalized : null;
}
