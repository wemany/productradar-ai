import type { FinancialInputs, ScenarioInput, ScenarioKey } from './schemas';
import type { PriceStats } from './pricing';

/**
 * Margen de contribución estimado por pedido. NO es utilidad neta: no incluye
 * gastos fijos, impuestos sobre la renta ni otros costos del negocio.
 *
 *   comision_pasarela  = precio_venta × fee_pct / 100 + fee_fijo
 *   ingreso_ajustado   = precio_venta − ajuste_tributario (si el usuario lo aporta)
 *   contribucion       = ingreso_ajustado − costo_unitario − envio − comision − CPA − devoluciones − otros
 *   margen_pct         = contribucion / ingreso_ajustado × 100
 *   CPA_equilibrio     = ingreso_ajustado − costo_unitario − envio − comision − devoluciones − otros
 */

export type ContributionStatus = 'OK' | 'MISSING_PRICE' | 'MISSING_COST' | 'INVALID';

export interface ContributionResult {
  status: ContributionStatus;
  currency: string;
  errors: string[];
  warnings: string[];
  revenue?: number;
  paymentFee?: number;
  /** Costo unitario + importación por unidad. */
  unitCost?: number;
  /** Contribución sin considerar publicidad. */
  contributionBeforeAds?: number;
  contributionBeforeAdsPct?: number;
  /** Contribución con CPA; undefined si el usuario no informó CPA. */
  contribution?: number;
  contributionMarginPct?: number;
  /** CPA máximo para no perder dinero por pedido. */
  breakEvenCpa?: number;
  adsIncluded: boolean;
}

function check(value: number | undefined, label: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Number.isFinite(value)) errors.push(`${label}: valor no numérico`);
  else if (value < 0) errors.push(`${label}: no puede ser negativo`);
}

export function computeContribution(input: FinancialInputs): ContributionResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const base: ContributionResult = { status: 'OK', currency: input.currency, errors, warnings, adsIncluded: false };

  check(input.sellingPrice, 'Precio de venta', errors);
  check(input.productCost, 'Costo del producto', errors);
  check(input.importCostPerUnit, 'Costo de importación', errors);
  check(input.shippingPaidBySeller, 'Envío', errors);
  check(input.paymentFeeFixed, 'Comisión fija', errors);
  check(input.acquisitionCostPerOrder, 'CPA', errors);
  check(input.expectedReturnLossPerOrder, 'Devoluciones', errors);
  check(input.otherVariableCosts, 'Otros costos', errors);
  check(input.taxAdjustmentPerOrder, 'Ajuste tributario', errors);
  if (!Number.isFinite(input.paymentFeePercent) || input.paymentFeePercent < 0 || input.paymentFeePercent > 100) {
    errors.push('Comisión porcentual: debe estar entre 0 y 100');
  }
  if (errors.length) return { ...base, status: 'INVALID' };

  if (input.sellingPrice === undefined || input.sellingPrice <= 0) {
    return { ...base, status: 'MISSING_PRICE', errors: ['Define un precio de venta mayor que cero'] };
  }

  const taxAdjustment = input.taxMode === 'USER_PROVIDED' ? (input.taxAdjustmentPerOrder ?? 0) : 0;
  if (input.taxMode === 'EXCLUDED') warnings.push('IVA, aranceles y retenciones no están incluidos en este cálculo.');
  const revenue = input.sellingPrice - taxAdjustment;
  if (revenue <= 0) {
    return { ...base, status: 'INVALID', errors: ['El ajuste tributario deja el ingreso en cero o negativo'] };
  }

  const paymentFee = (input.sellingPrice * input.paymentFeePercent) / 100 + input.paymentFeeFixed;

  if (input.productCost === undefined) {
    return {
      ...base,
      status: 'MISSING_COST',
      revenue,
      paymentFee,
      errors: [],
      warnings: [...warnings, 'Añade tu costo de compra para evaluar rentabilidad.'],
    };
  }

  if (input.productCostSource === 'SUPPLIER_REFERENCE') {
    warnings.push('El costo proviene de una referencia de proveedor: es indicativo y no incluye negociación por volumen.');
    if (input.importCostPerUnit === undefined) {
      warnings.push('No incluiste flete internacional, aranceles ni IVA de importación.');
    }
  }

  const unitCost = input.productCost + (input.importCostPerUnit ?? 0);
  const breakEvenCpa =
    revenue - unitCost - input.shippingPaidBySeller - paymentFee - input.expectedReturnLossPerOrder - input.otherVariableCosts;
  const contributionBeforeAds = breakEvenCpa;
  const contributionBeforeAdsPct = (contributionBeforeAds / revenue) * 100;

  if (input.acquisitionCostPerOrder === undefined) {
    warnings.push('Sin CPA: la contribución mostrada es antes de publicidad. No concluyas que es rentable.');
    return {
      ...base,
      revenue,
      paymentFee,
      unitCost,
      contributionBeforeAds,
      contributionBeforeAdsPct,
      breakEvenCpa,
      adsIncluded: false,
    };
  }

  const contribution = contributionBeforeAds - input.acquisitionCostPerOrder;
  return {
    ...base,
    revenue,
    paymentFee,
    unitCost,
    contributionBeforeAds,
    contributionBeforeAdsPct,
    contribution,
    contributionMarginPct: (contribution / revenue) * 100,
    breakEvenCpa,
    adsIncluded: true,
  };
}

/** Contribución principal: con CPA si existe; si no, antes de publicidad. */
export function headlineContribution(result: ContributionResult): { amount: number; pct: number; adsIncluded: boolean } | null {
  if (result.status !== 'OK') return null;
  if (result.contribution !== undefined && result.contributionMarginPct !== undefined) {
    return { amount: result.contribution, pct: result.contributionMarginPct, adsIncluded: true };
  }
  if (result.contributionBeforeAds !== undefined && result.contributionBeforeAdsPct !== undefined) {
    return { amount: result.contributionBeforeAds, pct: result.contributionBeforeAdsPct, adsIncluded: false };
  }
  return null;
}

/** Valores iniciales de escenarios (simulaciones editables, no datos de mercado). */
export const SCENARIO_RULES: Record<ScenarioKey, { label: string; description: string; cpaFactor: number; returnFactor: number }> = {
  conservative: {
    label: 'Conservador',
    description: 'Precio igual al mínimo verificado si es menor que el tuyo; CPA y devoluciones +50 %.',
    cpaFactor: 1.5,
    returnFactor: 1.5,
  },
  base: {
    label: 'Base',
    description: 'Tus supuestos tal como los ingresaste.',
    cpaFactor: 1,
    returnFactor: 1,
  },
  optimistic: {
    label: 'Optimista',
    description: 'Tu precio; CPA y devoluciones −25 %.',
    cpaFactor: 0.75,
    returnFactor: 0.75,
  },
};

export function defaultScenarios(input: FinancialInputs, verified?: PriceStats | null): ScenarioInput[] {
  const scale = (value: number | undefined, factor: number) => (value === undefined ? undefined : Math.round(value * factor));
  const conservativePrice =
    input.sellingPrice !== undefined && verified && verified.min < input.sellingPrice ? verified.min : input.sellingPrice;
  return (['conservative', 'base', 'optimistic'] as const).map((key) => {
    const rule = SCENARIO_RULES[key];
    return {
      key,
      sellingPrice: key === 'conservative' ? conservativePrice : input.sellingPrice,
      acquisitionCostPerOrder: scale(input.acquisitionCostPerOrder, rule.cpaFactor),
      expectedReturnLossPerOrder: scale(input.expectedReturnLossPerOrder, rule.returnFactor) ?? 0,
    };
  });
}

export function computeScenario(base: FinancialInputs, scenario: ScenarioInput): ContributionResult {
  return computeContribution({
    ...base,
    sellingPrice: scenario.sellingPrice,
    acquisitionCostPerOrder: scenario.acquisitionCostPerOrder,
    expectedReturnLossPerOrder: scenario.expectedReturnLossPerOrder,
  });
}

/** Convierte un costo de proveedor a la moneda del mercado con un tipo de cambio explícito. */
export function convertWithRate(amount: number, from: string, to: string, rate?: { from: string; to: string; rate: number }): number | null {
  if (from === to) return amount;
  if (!rate || rate.from !== from || rate.to !== to || !(rate.rate > 0)) return null;
  return amount * rate.rate;
}

export function emptyFinancialInputs(currency: string): FinancialInputs {
  return {
    currency,
    shippingPaidBySeller: 0,
    paymentFeePercent: 0,
    paymentFeeFixed: 0,
    expectedReturnLossPerOrder: 0,
    otherVariableCosts: 0,
    taxMode: 'EXCLUDED',
  };
}
