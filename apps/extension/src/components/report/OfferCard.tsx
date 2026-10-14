import { effectiveMatchType, exclusionReason, EXCLUSION_LABELS, MATCH_LABELS, safeHref, type CompetitorOffer, type Market, type MatchType } from '@productradar/core';
import { BadgeCheck, Ban, ExternalLink, RotateCcw, SearchCheck } from 'lucide-react';
import { es } from '../../i18n/es';
import { cx, dateTime, money } from '../../lib/format';
import { Badge } from '../ui';

const MATCH_TONE: Record<MatchType, 'ok' | 'warn' | 'neutral' | 'outline'> = {
  EXACT: 'ok',
  VARIANT: 'warn',
  SIMILAR: 'neutral',
  UNRELATED: 'outline',
};

export function OfferCard({
  offer,
  currency,
  market,
  outlier,
  onOverride,
}: {
  offer: CompetitorOffer;
  currency: string;
  market: Market;
  outlier: boolean;
  onOverride: (id: string, override: CompetitorOffer['userOverride']) => void;
}) {
  const match = effectiveMatchType(offer);
  const excluded = offer.userOverride === 'EXCLUDED';
  const reason = exclusionReason(offer, currency);
  const verified = offer.evidence.verification === 'PAGE_VERIFIED';
  const href = safeHref(offer.url);

  return (
    <article className={cx('card p-3.5 transition-opacity', excluded && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">{offer.seller}</div>
          <div className="truncate font-mono text-[10.5px] text-muted">{offer.domain}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={excluded ? 'outline' : MATCH_TONE[match]}>{excluded ? 'Excluida' : MATCH_LABELS[match]}</Badge>
          {offer.userOverride === 'EXACT' && <span className="text-[10.5px] text-muted">marcada por ti</span>}
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{offer.title}</p>

      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div>
          {offer.price ? (
            <div className={cx('num text-[17px] leading-none font-semibold tracking-[-0.01em]', verified ? 'text-ink' : 'text-ink-2')}>
              {money(offer.price.amount, offer.price.currency, market)}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted">Precio no disponible</div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={verified ? 'ok' : offer.evidence.verification === 'SEARCH_SNIPPET_ONLY' ? 'warn' : 'neutral'} mono>
              {verified ? <BadgeCheck className="size-3" aria-hidden /> : <SearchCheck className="size-3" aria-hidden />}
              {es.verification[offer.evidence.verification]}
            </Badge>
            {offer.availability !== 'UNKNOWN' && <Badge tone={offer.availability === 'IN_STOCK' ? 'neutral' : 'bad'}>{es.availability[offer.availability]}</Badge>}
            {outlier && <Badge tone="warn">Precio atípico</Badge>}
          </div>
        </div>
        <div className="text-right text-[10.5px] text-muted">
          <div>{reason === null ? 'Cuenta en la estadística' : EXCLUSION_LABELS[reason]}</div>
          <div>Observado {dateTime(offer.evidence.retrievedAt, market)}</div>
        </div>
      </div>

      {offer.priceText && <p className="mt-1.5 font-mono text-[10.5px] text-muted">“{offer.priceText}”</p>}
      {offer.verificationError && <p className="mt-1.5 text-[11.5px] text-warn">{offer.verificationError}</p>}

      <details className="mt-2 text-[11.5px] text-muted">
        <summary className="list-none font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">Por qué esta coincidencia · {es.marketFit[offer.marketFit]}</summary>
        <p className="mt-1">{offer.matchReason}</p>
        {offer.localSignals.length > 0 && <p className="mt-1">Señales de mercado: {offer.localSignals.join(' · ')}</p>}
        {offer.evidence.note && <p className="mt-1">{offer.evidence.note}</p>}
        {offer.evidence.query && <p className="mt-1 font-mono text-[10.5px]">Consulta: {offer.evidence.query}</p>}
      </details>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5">
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold">
            Ver fuente <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        {offer.userOverride ? (
          <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink" onClick={() => onOverride(offer.id, undefined)}>
            <RotateCcw className="size-3" aria-hidden /> Restaurar
          </button>
        ) : (
          <>
            {match !== 'EXACT' && (
              <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-ink" onClick={() => onOverride(offer.id, 'EXACT')}>
                <BadgeCheck className="size-3" aria-hidden /> Marcar coincidencia exacta
              </button>
            )}
            <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2 hover:text-bad" onClick={() => onOverride(offer.id, 'EXCLUDED')}>
              <Ban className="size-3" aria-hidden /> Excluir de comparación
            </button>
          </>
        )}
      </div>
    </article>
  );
}
