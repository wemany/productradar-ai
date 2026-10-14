import type { CompetitorOffer, ProductIdentity } from '../src/schemas';

export function makeIdentity(partial: Partial<ProductIdentity> = {}): ProductIdentity {
  return {
    name: 'Audífonos Sony WH-1000XM5',
    brand: 'Sony',
    model: 'WH-1000XM5',
    attributes: {},
    searchQueries: [],
    uncertainties: [],
    identifiedBy: 'USER_INPUT',
    ...partial,
  };
}

let counter = 0;
export function makeOffer(partial: Partial<CompetitorOffer> & { amount?: number; currency?: string; verified?: boolean } = {}): CompetitorOffer {
  counter += 1;
  const { amount, currency = 'COP', verified = true, ...rest } = partial;
  const url = rest.url ?? `https://tienda${counter}.com.co/p/${counter}`;
  return {
    id: `o_${counter}`,
    seller: `Tienda ${counter}`,
    domain: new URL(url).hostname,
    title: 'Sony WH-1000XM5',
    url,
    matchType: 'EXACT',
    matchReason: 'prueba',
    matchScore: 1,
    price: amount !== undefined ? { amount, currency } : undefined,
    availability: 'IN_STOCK',
    marketFit: 'LOCAL',
    localSignals: [],
    evidence: {
      url,
      publisher: 'tienda',
      retrievedAt: '2026-10-12T00:00:00.000Z',
      method: verified ? 'PAGE' : 'SEARCH_API',
      verification: amount === undefined ? 'UNAVAILABLE' : verified ? 'PAGE_VERIFIED' : 'SEARCH_SNIPPET_ONLY',
    },
    ...rest,
  };
}
