import { CONFIDENCE_LABELS, VERDICT_DISCLAIMER, VERDICT_LABELS, type Confidence, type Verdict } from '@productradar/core';
import { CircleHelp, FlaskConical, OctagonX, TriangleAlert } from 'lucide-react';
import { cx } from '../../lib/format';
import { Disclosure } from '../ui';

const VERDICT_STYLE: Record<Verdict, { bar: string; ink: string; soft: string; icon: typeof FlaskConical }> = {
  TEST: { bar: 'bg-ok', ink: 'text-ok', soft: 'bg-ok-soft', icon: FlaskConical },
  CAUTION: { bar: 'bg-warn', ink: 'text-warn', soft: 'bg-warn-soft', icon: TriangleAlert },
  AVOID: { bar: 'bg-bad', ink: 'text-bad', soft: 'bg-bad-soft', icon: OctagonX },
  INSUFFICIENT_DATA: { bar: 'bg-faint', ink: 'text-ink-2', soft: 'bg-sunken', icon: CircleHelp },
};

const CONFIDENCE_DOTS: Record<Confidence, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export function VerdictCard({
  verdict,
  reasons,
  confidence,
  confidenceReasons,
}: {
  verdict: Verdict;
  reasons: string[];
  confidence: Confidence;
  confidenceReasons: string[];
}) {
  const style = VERDICT_STYLE[verdict];
  const Icon = style.icon;
  return (
    <section aria-labelledby="verdict-title" className="card relative overflow-hidden">
      <div className={cx('absolute inset-y-0 left-0 w-1', style.bar)} aria-hidden />
      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow">Veredicto</div>
            <h2 id="verdict-title" className={cx('mt-1 font-serif text-[26px] leading-[1.05]', style.ink)}>
              {VERDICT_LABELS[verdict]}
            </h2>
          </div>
          <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', style.soft)}>
            <Icon className={cx('size-5', style.ink)} aria-hidden />
          </span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {reasons.map((r) => (
            <li key={r} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
              <span className={cx('mt-[7px] size-1 shrink-0 rounded-full', style.bar)} aria-hidden />
              <span>{r}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-xl border border-line bg-paper px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-ink-2">{CONFIDENCE_LABELS[confidence]}</span>
            <span className="flex gap-1" aria-label={`${CONFIDENCE_DOTS[confidence]} de 3`}>
              {[1, 2, 3].map((n) => (
                <span key={n} className={cx('h-1.5 w-5 rounded-full', n <= CONFIDENCE_DOTS[confidence] ? 'bg-accent' : 'bg-line-strong')} />
              ))}
            </span>
          </div>
          <Disclosure summary="Por qué este nivel de confianza" className="mt-1">
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted">
              {confidenceReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {confidence === 'HIGH' && <li>Incluso una confianza alta no demuestra demanda ni retorno publicitario.</li>}
            </ul>
          </Disclosure>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-muted">{VERDICT_DISCLAIMER}</p>
      </div>
    </section>
  );
}
