import { describe, expect, it } from 'vitest';
import type { FinancialInputs } from '../src/schemas';
import { computeVerdict } from '../src/verdict';
import { makeIdentity, makeOffer } from './helpers';

const FIN: FinancialInputs = {
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

const market = () => [
  makeOffer({ amount: 95_000, url: 'https://a.com.co/p/1' }),
  makeOffer({ amount: 105_000, url: 'https://b.com.co/p/1' }),
  makeOffer({ amount: 110_000, url: 'https://c.com.co/p/1' }),
];

describe('computeVerdict', () => {
  it('TEST: datos verificables, costo explícito, contribución positiva con CPA', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP', financials: FIN });
    expect(r.verdict).toBe('TEST');
    expect(r.reasons.join(' ')).toMatch(/\$ 30\.000 COP/);
  });

  it('INSUFFICIENT_DATA sin costo de compra', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP', financials: { ...FIN, productCost: undefined } });
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
    expect(r.reasons[0]).toMatch(/costo de compra/);
  });

  it('INSUFFICIENT_DATA sin calculadora', () => {
    expect(computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP' }).verdict).toBe('INSUFFICIENT_DATA');
  });

  it('INSUFFICIENT_DATA si no hay ofertas del mismo producto (y no lo llama "cero competencia")', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: [makeOffer({ amount: 1, matchType: 'SIMILAR' })], currency: 'COP', financials: FIN });
    expect(r.verdict).toBe('INSUFFICIENT_DATA');
    expect(r.reasons.join(' ')).toMatch(/no significa que no haya competencia/);
  });

  it('AVOID con contribución negativa y explica cómo mejorar', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP', financials: { ...FIN, acquisitionCostPerOrder: 60_000 } });
    expect(r.verdict).toBe('AVOID');
    expect(r.reasons.join(' ')).toMatch(/CPA debe ser menor que \$ 45\.000 COP/);
  });

  it('AVOID con margen demasiado estrecho', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP', financials: { ...FIN, acquisitionCostPerOrder: 40_000 } });
    expect(r.verdict).toBe('AVOID');
  });

  it('CAUTION sin CPA (no concluye que es rentable)', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP', financials: { ...FIN, acquisitionCostPerOrder: undefined } });
    expect(r.verdict).toBe('CAUTION');
    expect(r.reasons.join(' ')).toMatch(/antes de publicidad/);
  });

  it('CAUTION con pocos precios verificados', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: [makeOffer({ amount: 100_000 })], currency: 'COP', financials: FIN });
    expect(r.verdict).toBe('CAUTION');
  });

  it('CAUTION si el precio propio supera el máximo verificado', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP', financials: { ...FIN, sellingPrice: 150_000 } });
    expect(r.verdict).toBe('CAUTION');
  });

  it('CAUTION cuando el costo es una referencia de proveedor', () => {
    const r = computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP', financials: { ...FIN, productCostSource: 'SUPPLIER_REFERENCE' } });
    expect(r.verdict).toBe('CAUTION');
  });
});

describe('confianza de evidencia (independiente del veredicto)', () => {
  it('LOW con solo fragmentos del buscador', () => {
    const offers = [makeOffer({ amount: 1, verified: false }), makeOffer({ amount: 2, verified: false })];
    expect(computeVerdict({ product: makeIdentity(), offers, currency: 'COP' }).confidence).toBe('LOW');
  });

  it('MEDIUM con 2–3 precios verificados de dominios distintos', () => {
    expect(computeVerdict({ product: makeIdentity(), offers: market(), currency: 'COP' }).confidence).toBe('MEDIUM');
  });

  it('HIGH con ≥4 precios verificados en ≥3 dominios e identidad fuerte', () => {
    const offers = [...market(), makeOffer({ amount: 100_000, url: 'https://d.com.co/p/1' })];
    const r = computeVerdict({ product: makeIdentity(), offers, currency: 'COP' });
    expect(r.confidence).toBe('HIGH');
    expect(r.confidenceReasons.join(' ')).toMatch(/anuncios: no verificable/);
  });

  it('identidad sin marca/modelo no alcanza HIGH', () => {
    const offers = [...market(), makeOffer({ amount: 100_000, url: 'https://d.com.co/p/1' })];
    const r = computeVerdict({ product: makeIdentity({ brand: undefined, model: undefined }), offers, currency: 'COP' });
    expect(r.confidence).toBe('MEDIUM');
  });
});
