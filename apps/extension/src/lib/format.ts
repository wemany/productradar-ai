import { formatMoney, formatPercent, getMarketConfig, type Market } from '@productradar/core';

export function money(amount: number, currency: string, market: Market = 'CO'): string {
  return formatMoney(amount, currency, getMarketConfig(market).locale);
}

export function percent(value: number, market: Market = 'CO'): string {
  return formatPercent(value, getMarketConfig(market).locale);
}

export function dateTime(iso: string, market: Market = 'CO'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(getMarketConfig(market).locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortDate(iso: string, market: Market = 'CO'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(getMarketConfig(market).locale, { day: 'numeric', month: 'short' });
}

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
