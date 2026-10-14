import { describe, expect, it } from 'vitest';
import { computeContribution, computeScenario, convertWithRate, defaultScenarios, emptyFinancialInputs, headlineContribution } from '../src/finance';
import type { FinancialInputs } from '../src/schemas';

/** Ejemplo ILUSTRATIVO de la especificación (ficticio, solo para pruebas). */
const EXAMPLE: FinancialInputs = {
  currency: 'COP',
  sellingPrice: 100_000,
  productCost: 40_000,
  shippingPaidBySeller: 8_000,
  paymentFeePercent: 3,
  paymentFeeFixed: 1_000,
  acquisitionCostPerOrder: 15_000,
  expectedReturnLossPerOrder: 2_000,
  otherVariableCosts: 1_000,
  taxMode: 'EXCLUDED',
};

describe('computeContribution — caso ilustrativo de la especificación', () => {
  const r = computeContribution(EXAMPLE);

  it('comisión de pasarela = $4.000', () => {
    expect(r.paymentFee).toBe(4_000);
  });

  it('contribución = $30.000', () => {
    expect(r.contribution).toBe(30_000);
  });

  it('margen de contribución = 30 %', () => {
    expect(r.contributionMarginPct).toBeCloseTo(30, 10);
  });

  it('CPA máximo de equilibrio = $45.000', () => {
    expect(r.breakEvenCpa).toBe(45_000);
  });

  it('advierte que IVA/aranceles no están incluidos', () => {
    expect(r.warnings.join(' ')).toMatch(/IVA/);
    expect(r.status).toBe('OK');
    expect(r.adsIncluded).toBe(true);
  });
});

describe('computeContribution — validaciones', () => {
  it('sin costo no presenta un margen como real', () => {
    const r = computeContribution({ ...EXAMPLE, productCost: undefined });
    expect(r.status).toBe('MISSING_COST');
    expect(r.contribution).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/Añade tu costo de compra/);
  });

  it('sin CPA muestra contribución antes de publicidad', () => {
    const r = computeContribution({ ...EXAMPLE, acquisitionCostPerOrder: undefined });
    expect(r.contribution).toBeUndefined();
    expect(r.contributionBeforeAds).toBe(45_000);
    expect(headlineContribution(r)).toEqual({ amount: 45_000, pct: 45, adsIncluded: false });
  });

  it('CPA explícito en cero es válido (venta orgánica)', () => {
    const r = computeContribution({ ...EXAMPLE, acquisitionCostPerOrder: 0 });
    expect(r.contribution).toBe(45_000);
    expect(r.adsIncluded).toBe(true);
  });

  it('sin precio de venta', () => {
    expect(computeContribution({ ...EXAMPLE, sellingPrice: undefined }).status).toBe('MISSING_PRICE');
    expect(computeContribution({ ...EXAMPLE, sellingPrice: 0 }).status).toBe('MISSING_PRICE');
  });

  it('rechaza costos negativos y comisiones fuera de rango', () => {
    expect(computeContribution({ ...EXAMPLE, productCost: -1 }).status).toBe('INVALID');
    expect(computeContribution({ ...EXAMPLE, paymentFeePercent: 120 }).status).toBe('INVALID');
    expect(computeContribution({ ...EXAMPLE, shippingPaidBySeller: Number.NaN }).status).toBe('INVALID');
  });

  it('evita división por cero cuando el ajuste tributario anula el ingreso', () => {
    const r = computeContribution({ ...EXAMPLE, taxMode: 'USER_PROVIDED', taxAdjustmentPerOrder: 100_000 });
    expect(r.status).toBe('INVALID');
  });

  it('aplica el ajuste tributario aportado por el usuario', () => {
    const r = computeContribution({ ...EXAMPLE, taxMode: 'USER_PROVIDED', taxAdjustmentPerOrder: 15_966 });
    expect(r.revenue).toBe(84_034);
    expect(r.contribution).toBe(14_034);
  });

  it('advierte cuando el costo proviene de una referencia de proveedor sin importación', () => {
    const r = computeContribution({ ...EXAMPLE, productCostSource: 'SUPPLIER_REFERENCE' });
    expect(r.warnings.join(' ')).toMatch(/flete internacional/);
  });

  it('suma el costo de importación por unidad', () => {
    const r = computeContribution({ ...EXAMPLE, importCostPerUnit: 5_000 });
    expect(r.contribution).toBe(25_000);
  });
});

describe('escenarios', () => {
  it('genera conservador/base/optimista editables a partir de los supuestos', () => {
    const scenarios = defaultScenarios(EXAMPLE, { currency: 'COP', count: 3, min: 95_000, median: 105_000, max: 110_000, domains: 3, prices: [] });
    expect(scenarios.map((s) => s.key)).toEqual(['conservative', 'base', 'optimistic']);
    expect(scenarios[0]).toMatchObject({ sellingPrice: 95_000, acquisitionCostPerOrder: 22_500, expectedReturnLossPerOrder: 3_000 });
    expect(scenarios[1]).toMatchObject({ sellingPrice: 100_000, acquisitionCostPerOrder: 15_000 });
    expect(scenarios[2]).toMatchObject({ acquisitionCostPerOrder: 11_250, expectedReturnLossPerOrder: 1_500 });
  });

  it('el escenario base reproduce el cálculo principal', () => {
    const [, base] = defaultScenarios(EXAMPLE);
    expect(computeScenario(EXAMPLE, base!).contribution).toBe(30_000);
  });

  it('sin CPA los escenarios no inventan uno', () => {
    const scenarios = defaultScenarios({ ...EXAMPLE, acquisitionCostPerOrder: undefined });
    expect(scenarios.every((s) => s.acquisitionCostPerOrder === undefined)).toBe(true);
  });
});

describe('conversión de moneda', () => {
  it('exige un tipo de cambio explícito y coherente', () => {
    expect(convertWithRate(10, 'USD', 'COP')).toBeNull();
    expect(convertWithRate(10, 'USD', 'COP', { from: 'USD', to: 'COP', rate: 4000 })).toBe(40_000);
    expect(convertWithRate(10, 'USD', 'COP', { from: 'EUR', to: 'COP', rate: 4000 })).toBeNull();
    expect(convertWithRate(10, 'COP', 'COP')).toBe(10);
  });

  it('entradas vacías por defecto no contienen supuestos inventados', () => {
    const empty = emptyFinancialInputs('COP');
    expect(empty.sellingPrice).toBeUndefined();
    expect(empty.productCost).toBeUndefined();
    expect(empty.acquisitionCostPerOrder).toBeUndefined();
  });
});
