import type { Money } from './schemas';

/**
 * Normalización determinista de precios. Nunca usa IA y nunca "adivina" una
 * moneda que no aparece en el texto: el símbolo `$` solo se interpreta como la
 * moneda del mercado cuando ese mercado usa pesos.
 */

export const CURRENCY_DECIMALS: Record<string, number> = {
  COP: 0,
  CLP: 0,
  MXN: 2,
  PEN: 2,
  USD: 2,
  EUR: 2,
  BRL: 2,
  ARS: 2,
  CNY: 2,
};

const PESO_CURRENCIES = new Set(['COP', 'MXN', 'CLP', 'ARS']);

export interface PriceContext {
  /** Moneda del mercado (p. ej. COP). */
  marketCurrency: string;
  /** Forzar que `$` signifique USD (p. ej. en Alibaba). */
  dollarMeansUsd?: boolean;
}

export interface ParsedPrice {
  amount: number;
  currency: string;
  /** Extremo superior cuando el texto es un rango. */
  maxAmount?: number;
  raw: string;
  index: number;
}

/** Espacio duro y espacio fino: separadores de miles que produce Intl en algunos locales. */
const THOUSANDS_SPACES = String.fromCharCode(0xa0, 0x202f);
const NUMBER = String.raw`\d{1,3}(?:[.,` + THOUSANDS_SPACES + String.raw`]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const PREFIX = String.raw`US\s?\$|U\$S|USD|COP|MXN|PEN|CLP|EUR|BRL|ARS|S\/\.?|R\$|\$|€`;
const SUFFIX = String.raw`COP|USD|MXN|PEN|CLP|EUR|pesos|d[oó]lares|soles`;

const PREFIX_RE = new RegExp(
  String.raw`(?<![\p{L}\d])(${PREFIX})\s?(${NUMBER})(?:\s?(?:-|–|~|a|to|hasta)\s?(?:${PREFIX})?\s?(${NUMBER}))?(?!\d)`,
  'giu',
);
const SUFFIX_RE = new RegExp(String.raw`(?<![\p{L}\d.,])(${NUMBER})\s?(${SUFFIX})(?![\p{L}])`, 'giu');

/**
 * Convierte un número escrito con separadores locales.
 * - "79.900" → 79900 · "1.299.000,50" → 1299000.5 · "12.50" → 12.5 · "79,900" → 79900
 */
export function parseLocaleNumber(input: string): number | null {
  // `\s` en JavaScript incluye el espacio duro y el espacio fino (categoría Zs).
  const s = input.replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    normalized = s;
  } else if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const idx = s.lastIndexOf(decimalSep);
    const intPart = s.slice(0, idx);
    const frac = s.slice(idx + 1);
    if (intPart.includes(decimalSep)) return null;
    if (frac.length >= 1 && frac.length <= 2) {
      normalized = `${intPart.split(thousandsSep).join('')}.${frac}`;
    } else {
      normalized = s.replace(/[.,]/g, '');
    }
  } else {
    const sep = lastDot !== -1 ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) {
      if (parts.slice(1).some((p) => p.length !== 3)) return null;
      normalized = parts.join('');
    } else {
      const frac = parts[1] ?? '';
      const intPart = parts[0] ?? '';
      // "79.900" son miles; "0.125" es decimal (la parte entera es cero).
      if (frac.length === 3 && !/^0+$/.test(intPart)) normalized = parts.join('');
      else if (frac.length === 0) normalized = intPart;
      else if (frac.length <= 3) normalized = `${intPart}.${frac}`;
      else return null;
    }
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Precio dentro de datos estructurados (JSON-LD/microdatos). Schema.org exige
 * punto decimal, pero algunas tiendas publican "79.900" con formato local; en
 * monedas sin decimales eso se interpreta como miles.
 */
export function parseStructuredPrice(value: unknown, currency?: string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^[^\d]+/, '').replace(/[^\d.,]+$/, '');
  if (!trimmed) return null;
  const zeroDecimals = currency ? (CURRENCY_DECIMALS[currency] ?? 2) === 0 : false;
  let parsed: number | null;
  if (/^\d+\.\d+$/.test(trimmed)) {
    const frac = trimmed.split('.')[1] ?? '';
    parsed = zeroDecimals && frac.length === 3 ? Number(trimmed.replace('.', '')) : Number(trimmed);
  } else {
    parsed = parseLocaleNumber(trimmed);
  }
  return parsed !== null && parsed > 0 && parsed < 1e11 ? parsed : null;
}

function currencyFromToken(token: string, ctx: PriceContext): string | null {
  const t = token.replace(/\s+/g, '').toUpperCase();
  switch (t) {
    case 'US$':
    case 'U$S':
    case 'USD':
    case 'DÓLARES':
    case 'DOLARES':
      return 'USD';
    case 'COP':
    case 'MXN':
    case 'PEN':
    case 'CLP':
    case 'EUR':
    case 'BRL':
    case 'ARS':
      return t;
    case 'S/':
    case 'S/.':
    case 'SOLES':
      return 'PEN';
    case 'R$':
      return 'BRL';
    case '€':
      return 'EUR';
    case 'PESOS':
      return PESO_CURRENCIES.has(ctx.marketCurrency) ? ctx.marketCurrency : null;
    case '$':
      if (ctx.dollarMeansUsd) return 'USD';
      return PESO_CURRENCIES.has(ctx.marketCurrency) ? ctx.marketCurrency : 'USD';
    default:
      return null;
  }
}

function plausible(amount: number | null): amount is number {
  return amount !== null && amount > 0 && amount < 1e10;
}

/** Encuentra todos los precios explícitos (con moneda) dentro de un texto. */
export function findPrices(text: string, ctx: PriceContext): ParsedPrice[] {
  if (!text) return [];
  const results: ParsedPrice[] = [];
  const taken: Array<[number, number]> = [];

  for (const m of text.matchAll(PREFIX_RE)) {
    const currency = currencyFromToken(m[1] ?? '', ctx);
    const amount = parseLocaleNumber(m[2] ?? '');
    if (!currency || !plausible(amount)) continue;
    let maxAmount: number | undefined;
    if (m[3]) {
      const second = parseLocaleNumber(m[3]);
      if (plausible(second) && second > amount) maxAmount = second;
    }
    const index = m.index ?? 0;
    const raw = maxAmount === undefined ? `${m[1] ?? ''} ${m[2] ?? ''}`.replace(/\s+/g, ' ').trim() : m[0].trim();
    results.push({ amount, currency, maxAmount, raw, index });
    taken.push([index, index + m[0].length]);
  }

  for (const m of text.matchAll(SUFFIX_RE)) {
    const index = m.index ?? 0;
    if (taken.some(([start, end]) => index >= start && index < end)) continue;
    const currency = currencyFromToken(m[2] ?? '', ctx);
    const amount = parseLocaleNumber(m[1] ?? '');
    if (!currency || !plausible(amount)) continue;
    results.push({ amount, currency, raw: m[0].trim(), index });
  }

  // Si el mismo precio aparece como "$79.900 COP" se detecta dos veces; deduplicar por posición cercana.
  results.sort((a, b) => a.index - b.index);
  const deduped: ParsedPrice[] = [];
  for (const r of results) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.amount === r.amount && prev.currency === r.currency && r.index - prev.index < 16) continue;
    deduped.push(r);
  }
  return deduped;
}

export interface SnippetPrice {
  price: Money;
  raw: string;
  /** Número de precios distintos en el texto (si >1, el dato es ambiguo). */
  distinctPrices: number;
}

/** Primer precio en la moneda indicada (o cualquiera si no se indica). */
export function pickSnippetPrice(text: string, ctx: PriceContext, preferCurrency?: string): SnippetPrice | null {
  const prices = findPrices(text, ctx);
  if (prices.length === 0) return null;
  const preferred = preferCurrency ? prices.filter((p) => p.currency === preferCurrency) : prices;
  const chosen = preferred[0] ?? prices[0];
  if (!chosen) return null;
  const distinct = new Set(prices.map((p) => `${p.currency}:${p.amount}`)).size;
  return { price: { amount: chosen.amount, currency: chosen.currency }, raw: chosen.raw, distinctPrices: distinct };
}

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: 'US$',
  EUR: '€',
  PEN: 'S/',
  BRL: 'R$',
  CNY: '¥',
};

/** Formato visible: "$ 79.900 COP", "US$ 12,50 USD". */
export function formatMoney(amount: number, currency: string, locale = 'es-CO'): string {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const hasFraction = Math.round(amount * 100) % 100 !== 0;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals > 0 && hasFraction ? decimals : 0,
    maximumFractionDigits: decimals,
    useGrouping: 'always',
  } as Intl.NumberFormatOptions);
  const symbol = CURRENCY_SYMBOL[currency] ?? '$';
  const sign = amount < 0 ? '−' : '';
  return `${sign}${symbol} ${formatter.format(Math.abs(amount))} ${currency}`;
}

/** Rango compacto: "US$ 6,80 – 9,20 USD". */
export function formatMoneyRange(min: number, max: number | undefined, currency: string, locale = 'es-CO'): string {
  if (max === undefined || max === min) return formatMoney(min, currency, locale);
  const full = formatMoney(max, currency, locale);
  const symbol = full.split(' ')[0] ?? '$';
  const low = formatMoney(min, currency, locale).replace(` ${currency}`, '');
  return `${low} – ${full.replace(`${symbol} `, '')}`;
}

export function formatPercent(value: number, locale = 'es-CO', digits = 1): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value)} %`;
}

export function roundMoney(amount: number, currency: string): number {
  const decimals = CURRENCY_DECIMALS[currency] ?? 2;
  const factor = 10 ** decimals;
  return Math.round(amount * factor) / factor;
}
