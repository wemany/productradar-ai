import { z } from 'zod';

/**
 * Esquemas compartidos de ProductRadar AI.
 *
 * Todo dato que cruce un límite de confianza (respuesta de API, página web,
 * almacenamiento local, importación) se valida con estos esquemas. Los tipos
 * TypeScript se infieren de ellos para que no puedan divergir.
 */

export const MARKETS = ['CO', 'MX', 'PE', 'CL'] as const;
export const MarketSchema = z.enum(MARKETS);
export type Market = z.infer<typeof MarketSchema>;

export const MatchTypeSchema = z.enum(['EXACT', 'VARIANT', 'SIMILAR', 'UNRELATED']);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const VerificationSchema = z.enum(['PAGE_VERIFIED', 'SEARCH_SNIPPET_ONLY', 'UNAVAILABLE']);
export type Verification = z.infer<typeof VerificationSchema>;

export const VerdictSchema = z.enum(['TEST', 'CAUTION', 'AVOID', 'INSUFFICIENT_DATA']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const ConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, 'Código ISO 4217 de 3 letras');

export const MoneySchema = z.object({
  amount: z.number().finite().nonnegative(),
  currency: CurrencyCodeSchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const IdentifiedBySchema = z.enum([
  'PAGE_STRUCTURED_DATA',
  'PAGE_METADATA',
  'URL_SLUG',
  'VISION_AI',
  'USER_INPUT',
  'DEMO_FIXTURE',
]);
export type IdentifiedBy = z.infer<typeof IdentifiedBySchema>;

export const IdentityAlternativeSchema = z.object({
  name: z.string().min(1).max(300),
  brand: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
});
export type IdentityAlternative = z.infer<typeof IdentityAlternativeSchema>;

export const ProductIdentitySchema = z.object({
  name: z.string().trim().min(1).max(300),
  brand: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  /** GTIN/EAN/UPC solo dígitos (8–14). */
  gtin: z.string().regex(/^\d{8,14}$/).optional(),
  sku: z.string().trim().max(120).optional(),
  /** Nombre en inglés, útil para referencias de Alibaba. */
  englishName: z.string().trim().max(300).optional(),
  attributes: z.record(z.string(), z.string()),
  sourceUrl: z.string().max(2048).optional(),
  imageUrl: z.string().max(4096).optional(),
  /** Precio observado en la página de origen (solo referencia, no es costo). */
  sourcePrice: MoneySchema.optional(),
  searchQueries: z.array(z.string().max(300)).max(8),
  alibabaQuery: z.string().max(300).optional(),
  uncertainties: z.array(z.string().max(300)),
  identifiedBy: IdentifiedBySchema,
  /** 0–1. Solo informativo; nunca reemplaza la confirmación del usuario. */
  confidence: z.number().min(0).max(1).optional(),
  alternatives: z.array(IdentityAlternativeSchema).max(5).optional(),
});
export type ProductIdentity = z.infer<typeof ProductIdentitySchema>;

export const EvidenceMethodSchema = z.enum([
  'PAGE',
  'SEARCH_API',
  'USER_INPUT',
  'AUTHORIZED_AD_DATA',
  'DEMO_FIXTURE',
]);
export type EvidenceMethod = z.infer<typeof EvidenceMethodSchema>;

export const SourceEvidenceSchema = z.object({
  url: z.string().max(2048),
  publisher: z.string().max(200),
  retrievedAt: z.string(),
  method: EvidenceMethodSchema,
  verification: VerificationSchema,
  /** Fragmento limitado como prueba; nunca la página completa. */
  extractedText: z.string().max(600).optional(),
  /** Consulta que produjo el hallazgo, cuando aplica. */
  query: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;

export const PriceSourceSchema = z.enum([
  'PAGE_JSON_LD',
  'PAGE_MICRODATA',
  'PAGE_META',
  'SEARCH_STRUCTURED',
  'SEARCH_SNIPPET',
  'USER_INPUT',
]);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

export const AvailabilitySchema = z.enum(['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN']);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const MarketFitSchema = z.enum(['LOCAL', 'LIKELY_LOCAL', 'UNKNOWN', 'FOREIGN']);
export type MarketFit = z.infer<typeof MarketFitSchema>;

export const UserOverrideSchema = z.enum(['EXACT', 'EXCLUDED']);
export type UserOverride = z.infer<typeof UserOverrideSchema>;

export const CompetitorOfferSchema = z.object({
  id: z.string(),
  seller: z.string().max(200),
  domain: z.string().max(253),
  title: z.string().max(400),
  url: z.string().max(2048),
  matchType: MatchTypeSchema,
  matchReason: z.string().max(600),
  matchScore: z.number().min(0).max(1),
  price: MoneySchema.optional(),
  priceSource: PriceSourceSchema.optional(),
  /** Texto original del precio tal como apareció en la fuente. */
  priceText: z.string().max(120).optional(),
  unitQuantity: z.number().int().positive().optional(),
  availability: AvailabilitySchema,
  gtin: z.string().optional(),
  marketFit: MarketFitSchema,
  localSignals: z.array(z.string().max(160)),
  userOverride: UserOverrideSchema.optional(),
  verificationError: z.string().max(300).optional(),
  evidence: SourceEvidenceSchema,
});
export type CompetitorOffer = z.infer<typeof CompetitorOfferSchema>;

export const SupplierReferenceSchema = z.object({
  id: z.string(),
  title: z.string().max(400),
  url: z.string().max(2048),
  kind: z.enum(['PRODUCT', 'LISTING']),
  priceMin: MoneySchema.optional(),
  priceMax: MoneySchema.optional(),
  priceText: z.string().max(160).optional(),
  moq: z.number().int().positive().optional(),
  moqUnit: z.string().max(40).optional(),
  incoterm: z.string().max(20).optional(),
  matchType: MatchTypeSchema,
  matchReason: z.string().max(600),
  evidence: SourceEvidenceSchema,
});
export type SupplierReference = z.infer<typeof SupplierReferenceSchema>;

export const AdLinkSchema = z.object({
  platform: z.enum(['META', 'GOOGLE']),
  label: z.string(),
  url: z.string(),
  description: z.string(),
});
export type AdLink = z.infer<typeof AdLinkSchema>;

export const AdResearchSchema = z.object({
  links: z.array(AdLinkSchema),
  /** Siempre null salvo que exista un proveedor autorizado con cobertura declarada. */
  activeAdsCount: z.null(),
  historicalAdsCount: z.null(),
  evidence: z.array(SourceEvidenceSchema),
  coverageNote: z.string(),
});
export type AdResearch = z.infer<typeof AdResearchSchema>;

export const ExchangeRateSchema = z.object({
  from: CurrencyCodeSchema,
  to: CurrencyCodeSchema,
  rate: z.number().positive().finite(),
  date: z.string().min(1).max(40),
  source: z.string().min(1).max(200),
});
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

const nonNegative = z.number().finite().nonnegative();

/**
 * Supuestos financieros del usuario. Todos los importes están en `currency`
 * (la moneda del mercado). Cuando el costo viene de otra moneda se exige un
 * tipo de cambio explícito con fecha y fuente.
 */
export const FinancialInputsSchema = z.object({
  currency: CurrencyCodeSchema,
  sellingPrice: nonNegative.optional(),
  productCost: nonNegative.optional(),
  productCostSource: z.enum(['USER', 'SUPPLIER_REFERENCE']).optional(),
  /** Flete internacional, aranceles e IVA de importación por unidad (si el usuario lo conoce). */
  importCostPerUnit: nonNegative.optional(),
  shippingPaidBySeller: nonNegative,
  paymentFeePercent: z.number().finite().min(0).max(100),
  paymentFeeFixed: nonNegative,
  /** CPA: undefined = no informado (se muestra contribución antes de publicidad). */
  acquisitionCostPerOrder: nonNegative.optional(),
  expectedReturnLossPerOrder: nonNegative,
  otherVariableCosts: nonNegative,
  exchangeRate: ExchangeRateSchema.optional(),
  taxMode: z.enum(['EXCLUDED', 'USER_PROVIDED']),
  /** Monto a descontar del ingreso por impuestos (p. ej. IVA incluido en el precio). */
  taxAdjustmentPerOrder: nonNegative.optional(),
});
export type FinancialInputs = z.infer<typeof FinancialInputsSchema>;

export const ScenarioKeySchema = z.enum(['conservative', 'base', 'optimistic']);
export type ScenarioKey = z.infer<typeof ScenarioKeySchema>;

export const ScenarioInputSchema = z.object({
  key: ScenarioKeySchema,
  sellingPrice: nonNegative.optional(),
  acquisitionCostPerOrder: nonNegative.optional(),
  expectedReturnLossPerOrder: nonNegative,
});
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;

export const ModuleKeySchema = z.enum(['identify', 'search', 'verify', 'suppliers', 'ads', 'analysis']);
export type ModuleKey = z.infer<typeof ModuleKeySchema>;

export const ModuleStatusSchema = z.enum(['PENDING', 'RUNNING', 'OK', 'PARTIAL', 'FAILED', 'SKIPPED']);
export type ModuleStatus = z.infer<typeof ModuleStatusSchema>;

export const ModuleStateSchema = z.object({
  status: ModuleStatusSchema,
  message: z.string().max(400).optional(),
});
export type ModuleState = z.infer<typeof ModuleStateSchema>;

export const DiscardedResultSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(400),
  reason: z.string().max(200),
});
export type DiscardedResult = z.infer<typeof DiscardedResultSchema>;

export const QueryRunSchema = z.object({
  query: z.string(),
  /** SOCIAL: menciones públicas en redes (añadido sin romper reportes guardados). */
  purpose: z.enum(['MARKET', 'SUPPLIER', 'SOCIAL']),
  ok: z.boolean(),
  resultCount: z.number().int().nonnegative(),
  error: z.string().max(300).optional(),
});
export type QueryRun = z.infer<typeof QueryRunSchema>;

export const REPORT_SCHEMA_VERSION = 1 as const;

export const ResearchReportSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  id: z.string(),
  /** true solo para datos ficticios de demostración. */
  isDemo: z.boolean(),
  country: MarketSchema,
  currency: CurrencyCodeSchema,
  product: ProductIdentitySchema,
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(['RUNNING', 'COMPLETE', 'PARTIAL', 'CANCELLED', 'FAILED']),
  modules: z.record(ModuleKeySchema, ModuleStateSchema),
  offers: z.array(CompetitorOfferSchema),
  discarded: z.array(DiscardedResultSchema),
  supplierReferences: z.array(SupplierReferenceSchema),
  adResearch: AdResearchSchema,
  financials: FinancialInputsSchema.optional(),
  scenarios: z.array(ScenarioInputSchema).optional(),
  verdict: VerdictSchema,
  verdictReasons: z.array(z.string()),
  risks: z.array(z.string()),
  evidenceConfidence: ConfidenceSchema,
  confidenceReasons: z.array(z.string()),
  incompleteModules: z.array(z.string()),
  queries: z.array(QueryRunSchema),
  searchProvider: z.string(),
  /**
   * Cómo se reunieron las ofertas. Opcional para que los reportes anteriores
   * sigan cargando: sin valor = búsqueda automática (o demo si `isDemo`).
   * 'assisted' = fichas que el usuario abrió y agregó una por una.
   */
  mode: z.enum(['automatic', 'assisted']).optional(),
  notes: z.array(z.string()),
});
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
