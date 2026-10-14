import {
  CURRENCY_DECIMALS,
  getMarketConfig,
  computeContribution,
  computeScenario,
  defaultScenarios,
  headlineContribution,
  SCENARIO_RULES,
  type FinancialInputs,
  type Market,
  type PriceStats,
  type ScenarioInput,
} from '@productradar/core';
import { RotateCcw } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx, money, percent } from '../../lib/format';
import { MoneyInput } from '../MoneyInput';
import { Button, Callout, Field } from '../ui';

interface CalculatorProps {
  financials: FinancialInputs;
  onChange: (next: FinancialInputs) => void;
  market: Market;
  verified: PriceStats | null;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export function Calculator({ financials: f, onChange, market, verified }: CalculatorProps) {
  const uid = useId();
  const set = (patch: Partial<FinancialInputs>) => onChange({ ...f, ...patch });
  const result = computeContribution(f);
  const headline = headlineContribution(result);
  const cur = f.currency;
  const loc = getMarketConfig(market).locale;
  const dec = CURRENCY_DECIMALS[cur] ?? 0;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Field label="Precio de venta propuesto" htmlFor={`${uid}-price`} hint="Lo que cobrarías al cliente final, IVA incluido si aplica.">
          <MoneyInput locale={loc} decimals={dec} id={`${uid}-price`} value={f.sellingPrice} onChange={(v) => set({ sellingPrice: v })} suffix={cur} />
        </Field>
        {verified && (
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {(
              [
                ['Mínimo verificado', verified.min],
                ['Mediana verificada', verified.median],
              ] as const
            ).map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => set({ sellingPrice: Math.round(value) })}
                className="rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[11.5px] text-ink-2 hover:border-accent hover:text-accent-ink"
              >
                {label}: <span className="num font-semibold">{money(value, cur, market)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <fieldset className="space-y-3 border-t border-line pt-3">
        <legend className="eyebrow pb-1">Costos por pedido</legend>
        <Field
          label="Costo de compra por unidad"
          htmlFor={`${uid}-cost`}
          hint={f.productCostSource === 'SUPPLIER_REFERENCE' ? 'Tomado de una referencia de proveedor (indicativo).' : 'Tu costo real o presupuesto puesto en tu negocio.'}
        >
          <MoneyInput locale={loc} decimals={dec} id={`${uid}-cost`} value={f.productCost} onChange={(v) => set({ productCost: v, productCostSource: v === undefined ? undefined : f.productCostSource ?? 'USER' })} suffix={cur} />
        </Field>
        {f.exchangeRate && f.productCostSource === 'SUPPLIER_REFERENCE' && (
          <p className="-mt-1 text-[11px] text-muted">
            Tipo de cambio usado: 1 {f.exchangeRate.from} = {money(f.exchangeRate.rate, f.exchangeRate.to, market)} · {f.exchangeRate.date} · {f.exchangeRate.source}
          </p>
        )}
        <Field label="Flete internacional, aranceles e IVA de importación por unidad" htmlFor={`${uid}-import`} optional>
          <MoneyInput locale={loc} decimals={dec} id={`${uid}-import`} value={f.importCostPerUnit} onChange={(v) => set({ importCostPerUnit: v })} suffix={cur} />
        </Field>
        <Row>
          <Field label="Envío que pagas" htmlFor={`${uid}-ship`}>
            <MoneyInput locale={loc} decimals={dec} id={`${uid}-ship`} value={f.shippingPaidBySeller} onChange={(v) => set({ shippingPaidBySeller: v ?? 0 })} placeholder="0" />
          </Field>
          <Field label="Otros variables" htmlFor={`${uid}-other`} hint="Empaque, comisiones…">
            <MoneyInput locale={loc} decimals={dec} id={`${uid}-other`} value={f.otherVariableCosts} onChange={(v) => set({ otherVariableCosts: v ?? 0 })} placeholder="0" />
          </Field>
        </Row>
        <Row>
          <Field label="Comisión pasarela %" htmlFor={`${uid}-feepct`}>
            <MoneyInput locale={loc} id={`${uid}-feepct`} prefix="" suffix="%" decimals={2} value={f.paymentFeePercent} onChange={(v) => set({ paymentFeePercent: v ?? 0 })} placeholder="0" />
          </Field>
          <Field label="Comisión fija" htmlFor={`${uid}-feefix`}>
            <MoneyInput locale={loc} decimals={dec} id={`${uid}-feefix`} value={f.paymentFeeFixed} onChange={(v) => set({ paymentFeeFixed: v ?? 0 })} placeholder="0" />
          </Field>
        </Row>
        <Row>
          <Field label="CPA (publicidad por pedido)" htmlFor={`${uid}-cpa`} hint="Vacío = no informado. 0 = sin pauta.">
            <MoneyInput locale={loc} decimals={dec} id={`${uid}-cpa`} value={f.acquisitionCostPerOrder} onChange={(v) => set({ acquisitionCostPerOrder: v })} />
          </Field>
          <Field label="Pérdida por devoluciones" htmlFor={`${uid}-ret`} hint="Promedio por pedido.">
            <MoneyInput locale={loc} decimals={dec} id={`${uid}-ret`} value={f.expectedReturnLossPerOrder} onChange={(v) => set({ expectedReturnLossPerOrder: v ?? 0 })} placeholder="0" />
          </Field>
        </Row>
      </fieldset>

      <fieldset className="space-y-2 border-t border-line pt-3">
        <legend className="eyebrow pb-1">Impuestos</legend>
        <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
          <input type="radio" name={`${uid}-tax`} className="mt-0.5 accent-[var(--color-accent)]" checked={f.taxMode === 'EXCLUDED'} onChange={() => set({ taxMode: 'EXCLUDED', taxAdjustmentPerOrder: undefined })} />
          No incluir (se mostrará un aviso)
        </label>
        <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
          <input type="radio" name={`${uid}-tax`} className="mt-0.5 accent-[var(--color-accent)]" checked={f.taxMode === 'USER_PROVIDED'} onChange={() => set({ taxMode: 'USER_PROVIDED' })} />
          Descontar un monto por pedido que yo calculé (p. ej. IVA incluido en el precio)
        </label>
        {f.taxMode === 'USER_PROVIDED' && (
          <MoneyInput locale={loc} decimals={dec} id={`${uid}-tax-amount`} value={f.taxAdjustmentPerOrder} onChange={(v) => set({ taxAdjustmentPerOrder: v })} suffix={cur} />
        )}
      </fieldset>

      <div className="rounded-xl border border-line bg-paper p-3.5" aria-live="polite">
        {result.status === 'MISSING_PRICE' && <p className="text-[12.5px] text-ink-2">Define un precio de venta para calcular.</p>}
        {result.status === 'MISSING_COST' && <p className="text-[12.5px] font-semibold text-ink">Añade tu costo de compra para evaluar rentabilidad.</p>}
        {result.status === 'INVALID' && (
          <Callout tone="error" title="Revisa los valores">
            <ul className="list-disc pl-4">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Callout>
        )}
        {headline && (
          <>
            <div className="eyebrow">{headline.adsIncluded ? 'Contribución estimada por pedido (con publicidad)' : 'Contribución por pedido ANTES de publicidad'}</div>
            <div className={cx('num mt-1 font-serif text-[30px] leading-none', headline.amount > 0 ? 'text-ink' : 'text-bad')}>{money(headline.amount, cur, market)}</div>
            <div className="mt-1 text-[12px] text-muted">Margen de contribución: {percent(headline.pct, market)}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
              <dt className="text-muted">Comisión de pasarela</dt>
              <dd className="num text-right text-ink-2">{money(result.paymentFee ?? 0, cur, market)}</dd>
              <dt className="text-muted">CPA máximo de equilibrio</dt>
              <dd className="num text-right font-semibold text-ink">{money(result.breakEvenCpa ?? 0, cur, market)}</dd>
            </dl>
          </>
        )}
        {result.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-2 text-[11.5px] text-warn">
            {result.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted">Es un margen de contribución estimado, no utilidad neta: no incluye gastos fijos ni impuesto de renta.</p>
      </div>
    </div>
  );
}

export function Scenarios({
  financials,
  scenarios,
  verified,
  market,
  onChange,
}: {
  financials: FinancialInputs;
  scenarios: ScenarioInput[] | undefined;
  verified: PriceStats | null;
  market: Market;
  onChange: (s: ScenarioInput[] | undefined) => void;
}) {
  const uid = useId();
  const list = scenarios ?? defaultScenarios(financials, verified);
  const edit = (key: ScenarioInput['key'], patch: Partial<ScenarioInput>) => onChange(list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const cur = financials.currency;
  const loc = getMarketConfig(market).locale;
  const dec = CURRENCY_DECIMALS[cur] ?? 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] text-muted">Simulaciones con tus supuestos; no son datos de mercado.</p>
        {scenarios && (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3" />} onClick={() => onChange(undefined)}>
            Restablecer
          </Button>
        )}
      </div>
      {list.map((s) => {
        const r = computeScenario(financials, s);
        const h = headlineContribution(r);
        const rule = SCENARIO_RULES[s.key];
        return (
          <div key={s.key} className={cx('rounded-xl border p-3', s.key === 'base' ? 'border-accent-line bg-accent-soft/30' : 'border-line bg-surface')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink">{rule.label}</span>
              <span className={cx('num text-[13px] font-semibold', h && h.amount <= 0 ? 'text-bad' : 'text-ink')}>
                {h ? `${money(h.amount, cur, market)} · ${percent(h.pct, market)}` : '—'}
              </span>
            </div>
            <p className="text-[11px] text-muted">
              {rule.description}
              {h && !h.adsIncluded ? ' · sin CPA' : ''}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="space-y-0.5 text-[10.5px] text-muted" htmlFor={`${uid}-${s.key}-p`}>
                Precio
                <MoneyInput locale={loc} decimals={dec} id={`${uid}-${s.key}-p`} prefix="" value={s.sellingPrice} onChange={(v) => edit(s.key, { sellingPrice: v })} className="[&_input]:px-2 [&_input]:text-[12px]" />
              </label>
              <label className="space-y-0.5 text-[10.5px] text-muted" htmlFor={`${uid}-${s.key}-c`}>
                CPA
                <MoneyInput locale={loc} decimals={dec} id={`${uid}-${s.key}-c`} prefix="" value={s.acquisitionCostPerOrder} onChange={(v) => edit(s.key, { acquisitionCostPerOrder: v })} className="[&_input]:px-2 [&_input]:text-[12px]" />
              </label>
              <label className="space-y-0.5 text-[10.5px] text-muted" htmlFor={`${uid}-${s.key}-r`}>
                Devoluciones
                <MoneyInput
                  locale={loc}
                  decimals={dec}
                  id={`${uid}-${s.key}-r`}
                  prefix=""
                  value={s.expectedReturnLossPerOrder}
                  onChange={(v) => edit(s.key, { expectedReturnLossPerOrder: v ?? 0 })}
                  className="[&_input]:px-2 [&_input]:text-[12px]"
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
