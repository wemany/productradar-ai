/** Utilidades de texto deterministas (sin IA). */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  iexcl: '¡',
  iquest: '¿',
  deg: '°',
  reg: '®',
  trade: '™',
  copy: '©',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  euro: '€',
  times: '×',
};

/** Decodifica entidades HTML comunes y numéricas. */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

/** Elimina etiquetas HTML y colapsa espacios. Nunca se usa para renderizar. */
export function stripTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minúsculas, sin tildes ni signos; útil para comparar. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solo letras y dígitos, sin espacios; útil para comparar modelos (WH-1000XM5 → wh1000xm5). */
export function alphanumericKey(input: string): string {
  return normalizeText(input).replace(/\s+/g, '');
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Limpia texto externo: quita control chars, colapsa espacios y limita longitud. */
export function cleanExternalText(input: unknown, max = 400): string {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const withoutControl = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  return truncate(stripTags(withoutControl), max);
}

const STOPWORDS = new Set([
  'a', 'al', 'de', 'del', 'el', 'la', 'las', 'los', 'lo', 'un', 'una', 'unos', 'unas', 'y', 'o', 'u', 'e',
  'en', 'con', 'sin', 'para', 'por', 'que', 'se', 'su', 'sus', 'tu', 'mi', 'es', 'como', 'mas', 'muy',
  'the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'by', 'new',
  'nuevo', 'nueva', 'original', 'originales', 'oferta', 'ofertas', 'precio', 'precios', 'comprar', 'compra',
  'venta', 'tienda', 'tiendas', 'online', 'envio', 'envios', 'gratis', 'colombia', 'mexico', 'peru', 'chile',
  'cop', 'mxn', 'pen', 'clp', 'usd', 'mejor', 'mejores', 'promo', 'promocion', 'descuento', 'hoy', 'ya',
  'disponible', 'garantia', 'stock', 'cuotas', 'pago', 'contraentrega', 'domicilio', 'nacional',
]);

/** Tokens significativos para comparar productos. */
export function significantTokens(input: string): string[] {
  const tokens = normalizeText(input).split(' ');
  const out: string[] = [];
  for (const token of tokens) {
    if (!token) continue;
    if (STOPWORDS.has(token)) continue;
    if (token.length === 1 && !/\d/.test(token)) continue;
    out.push(token);
  }
  return [...new Set(out)];
}

/** Hash FNV-1a de 32 bits en base 36: identificadores estables y cortos (no criptográficos). */
export function stableId(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function randomId(prefix = 'r'): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
