import { CURRENCY_DECIMALS, formatMoneyRange, getMarketConfig, safeHref, SUPPLIER_MATCH_LABELS, type FinancialInputs, type Market, type SupplierReference } from '@productradar/core';
import { ExternalLink, Factory } from 'lucide-react';
import { useId, useState } from 'react';
import { money } from '../../lib/format';
import { MoneyInput } from '../MoneyInput';
import { Badge, Button, Callout, Field } from '../ui';

/**
 * Referencia pública de Alibaba. "Usar como costo" exige un tipo de cambio
 * explícito (valor, fecha y fuente) y deja advertencias visibles: un precio
 * indicativo nunca es el costo real puesto en el país.
 */
export function SupplierCard({
  reference,
  market,
  financials,
  onUseAsCost,
}: {
  reference: SupplierReference;
  market: Market;
  financials: FinancialInputs;
  onUseAsCost: (next: FinancialInputs) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState<number | undefined>(financials.exchangeRate?.rate);
  const [date, setDate] = useState(financials.exchangeRate?.date ?? new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState(financials.exchangeRate?.source ?? '');
  const [importCost, setImportCost] = useState<number | undefined>(financials.importCostPerUnit);
  const href = safeHref(reference.url);
  const unit = reference.priceMin;
  const needsRate = unit && unit.currency !== financials.currency;
  const canApply = unit && (!needsRate || (rate && rate > 0 && source.trim() && date));

  const apply = () => {
    if (!unit || !canApply) return;
    const converted = needsRate ? unit.amount * (rate ?? 0) : unit.amount;
    onUseAsCost({
      ...financials,
      productCost: Math.round(converted * 100) / 100,
      productCostSource: 'SUPPLIER_REFERENCE',
      importCostPerUnit: importCost,
      exchangeRate: needsRate ? { from: unit.currency, to: financials.currency, rate: rate ?? 0, date, source: source.trim() } : undefined,
    });
    setOpen(false);
  };

  return (
    <article className="card p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken">
          <Factory className="size-4 text-ink-2" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12.5px] leading-snug font-medium text-ink">{reference.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={reference.matchType === 'UNRELATED' ? 'outline' : 'neutral'}>{SUPPLIER_MATCH_LABELS[reference.matchType]}</Badge>
            <Badge tone="outline">{reference.kind === 'PRODUCT' ? 'Ficha' : 'Listado'}</Badge>
            {reference.incoterm && <Badge tone="outline">{reference.incoterm}</Badge>}
          </div>
        </div>
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-paper px-2.5 py-2">
          <dt className="text-[10.5px] text-muted">Precio publicado (indicativo)</dt>
          <dd className="num mt-0.5 font-semibold text-ink">
            {reference.priceMin ? formatMoneyRange(reference.priceMin.amount, reference.priceMax?.amount, reference.priceMin.currency, getMarketConfig(market).locale) : 'No visible'}
          </dd>
        </div>
        <div className="rounded-lg bg-paper px-2.5 py-2">
          <dt className="text-[10.5px] text-muted">Pedido mínimo (MOQ)</dt>
          <dd className="num mt-0.5 font-semibold text-ink">{reference.moq ? `${reference.moq.toLocaleString('es-CO')} ${reference.moqUnit ?? ''}` : 'No visible'}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-muted">{reference.matchReason}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 border-t border-line pt-2.5">
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold">
            Ver en Alibaba <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        {unit && (
          <button type="button" className="text-[12px] font-semibold text-ink-2 hover:text-ink" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            Usar como costo en la simulación
          </button>
        )}
      </div>
      {open && unit && (
        <div className="mt-3 space-y-3 rounded-xl border border-warn/25 bg-warn-soft/60 p-3">
          <Callout tone="warn">
            Se usará el <b>mínimo del rango</b> ({money(unit.amount, unit.currency, market)}) como supuesto. Es un precio indicativo: no incluye negociación, flete, seguro,
            aranceles, IVA ni despacho local.
          </Callout>
          {needsRate && (
            <>
              <Field label={`Tipo de cambio: ${financials.currency} por 1 ${unit.currency}`} htmlFor={`${uid}-rate`}>
                <MoneyInput id={`${uid}-rate`} value={rate} onChange={setRate} decimals={4} locale={getMarketConfig(market).locale} suffix={financials.currency} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Fecha del tipo de cambio" htmlFor={`${uid}-date`}>
                  <input id={`${uid}-date`} type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Fuente" htmlFor={`${uid}-src`}>
                  <input id={`${uid}-src`} className="field" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Ej.: TRM oficial" />
                </Field>
              </div>
            </>
          )}
          <Field label="Flete, aranceles e IVA de importación por unidad (si lo conoces)" htmlFor={`${uid}-imp`} optional>
            <MoneyInput id={`${uid}-imp`} value={importCost} onChange={setImportCost} locale={getMarketConfig(market).locale} decimals={CURRENCY_DECIMALS[financials.currency] ?? 0} suffix={financials.currency} />
          </Field>
          <Button size="sm" variant="primary" disabled={!canApply} onClick={apply}>
            Aplicar a la calculadora
          </Button>
        </div>
      )}
    </article>
  );
}
