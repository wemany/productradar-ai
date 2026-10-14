import type { Market, PriceStats } from '@productradar/core';
import { money } from '../../lib/format';

/**
 * Distribución de precios como regla de instrumento: puntos sólidos = precios
 * verificados (los únicos que forman la estadística); huecos = solo buscador;
 * rombo = tu precio de venta.
 */
export function PriceStrip({
  verified,
  snippet,
  yourPrice,
  currency,
  market,
}: {
  verified: PriceStats | null;
  snippet: PriceStats | null;
  yourPrice?: number;
  currency: string;
  market: Market;
}) {
  const all = [...(verified?.prices ?? []), ...(snippet?.prices ?? []), ...(yourPrice ? [yourPrice] : [])];
  if (all.length === 0) return null;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || lo * 0.1 || 1;
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const W = 300;
  const x = (v: number) => 12 + ((v - min) / (max - min)) * (W - 24);

  const label = [
    verified ? `${verified.count} precios verificados entre ${money(verified.min, currency, market)} y ${money(verified.max, currency, market)}, mediana ${money(verified.median, currency, market)}` : 'Sin precios verificados',
    snippet ? `${snippet.count} precios solo del buscador` : '',
    yourPrice ? `tu precio ${money(yourPrice, currency, market)}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  return (
    <figure className="mt-1">
      <svg viewBox={`0 0 ${W} 74`} className="w-full" role="img" aria-label={label}>
        <line x1="12" x2={W - 12} y1="40" y2="40" stroke="var(--color-line-strong)" strokeWidth="1" />
        {Array.from({ length: 11 }, (_, i) => 12 + (i * (W - 24)) / 10).map((tx) => (
          <line key={tx} x1={tx} x2={tx} y1="37" y2="43" stroke="var(--color-line-strong)" strokeWidth="0.75" />
        ))}
        {verified && (
          <>
            <rect x={x(verified.min)} y="34" width={Math.max(1, x(verified.max) - x(verified.min))} height="12" rx="6" fill="var(--color-accent-soft)" />
            <line x1={x(verified.median)} x2={x(verified.median)} y1="26" y2="54" stroke="var(--color-accent)" strokeWidth="1.5" />
            <text x={x(verified.median)} y="20" textAnchor="middle" fontSize="8.5" fontFamily="IBM Plex Mono, monospace" fill="var(--color-accent-ink)">
              MEDIANA
            </text>
          </>
        )}
        {snippet?.prices.map((p, i) => (
          <circle key={`s${i}`} cx={x(p)} cy="40" r="3.4" fill="var(--color-surface)" stroke="var(--color-muted)" strokeWidth="1.2" />
        ))}
        {verified?.prices.map((p, i) => (
          <circle key={`v${i}`} cx={x(p)} cy="40" r="3.6" fill="var(--color-accent)" />
        ))}
        {yourPrice !== undefined && (
          <g transform={`translate(${x(yourPrice)} 62)`}>
            <rect x="-4" y="-4" width="8" height="8" transform="rotate(45)" fill="var(--color-ink)" />
          </g>
        )}
        <text x="12" y="72" fontSize="8.5" fontFamily="IBM Plex Mono, monospace" fill="var(--color-muted)">
          {money(min, currency, market)}
        </text>
        <text x={W - 12} y="72" textAnchor="end" fontSize="8.5" fontFamily="IBM Plex Mono, monospace" fill="var(--color-muted)">
          {money(max, currency, market)}
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-accent" aria-hidden /> Verificado en ficha
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full border border-muted bg-surface" aria-hidden /> Solo buscador (no cuenta)
        </span>
        {yourPrice !== undefined && (
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rotate-45 bg-ink" aria-hidden /> Tu precio
          </span>
        )}
      </figcaption>
    </figure>
  );
}
