import { buildAdResearch } from './ads';
import { getMarketConfig } from './markets';
import {
  REPORT_SCHEMA_VERSION,
  ResearchReportSchema,
  type FinancialInputs,
  type Market,
  type ModuleKey,
  type ModuleState,
  type ProductIdentity,
  type ResearchReport,
} from './schemas';
import { randomId } from './text';
import { computeVerdict } from './verdict';

export const MODULE_ORDER: ModuleKey[] = ['identify', 'search', 'verify', 'suppliers', 'ads', 'analysis'];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  identify: 'Identificando el producto',
  search: 'Buscando ofertas de tiendas del país',
  verify: 'Verificando coincidencias y precios',
  suppliers: 'Investigando referencias de Alibaba',
  ads: 'Reuniendo señales publicitarias disponibles',
  analysis: 'Calculando escenarios y recomendación',
};


export interface CreateReportInput {
  product: ProductIdentity;
  country: Market;
  isDemo: boolean;
  searchProvider: string;
  id?: string;
  startedAt?: string;
  financials?: FinancialInputs;
}

export function createReport(input: CreateReportInput): ResearchReport {
  const market = getMarketConfig(input.country);
  const modules = Object.fromEntries(MODULE_ORDER.map((k) => [k, { status: 'PENDING' } satisfies ModuleState])) as Record<ModuleKey, ModuleState>;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    id: input.id ?? randomId('rep'),
    isDemo: input.isDemo,
    country: input.country,
    currency: market.currency,
    product: input.product,
    startedAt: input.startedAt ?? new Date().toISOString(),
    status: 'RUNNING',
    modules,
    offers: [],
    discarded: [],
    supplierReferences: [],
    adResearch: buildAdResearch(input.product, market),
    financials: input.financials,
    verdict: 'INSUFFICIENT_DATA',
    verdictReasons: [],
    risks: [],
    evidenceConfidence: 'LOW',
    confidenceReasons: [],
    incompleteModules: [],
    queries: [],
    searchProvider: input.searchProvider,
    notes: [],
  };
}

export function incompleteModules(report: ResearchReport): string[] {
  const labels: Record<ModuleKey, string> = {
    identify: 'identificación',
    search: 'búsqueda de competencia',
    verify: 'verificación de precios',
    suppliers: 'referencias de Alibaba',
    ads: 'publicidad',
    analysis: 'análisis',
  };
  return (Object.entries(report.modules) as Array<[ModuleKey, ModuleState]>)
    .filter(([, state]) => state.status === 'PARTIAL' || state.status === 'FAILED')
    .map(([key]) => labels[key]);
}

/** Recalcula veredicto, confianza y riesgos a partir del estado actual del reporte. */
export function recomputeReport(report: ResearchReport): ResearchReport {
  const market = getMarketConfig(report.country);
  const incomplete = incompleteModules(report);
  const result = computeVerdict({
    product: report.product,
    offers: report.offers,
    currency: report.currency,
    locale: market.locale,
    financials: report.financials,
    supplierReferences: report.supplierReferences,
    incompleteModules: incomplete,
  });
  const searchFailed = report.modules.search.status === 'FAILED' && report.offers.length === 0;
  return {
    ...report,
    verdict: searchFailed ? 'INSUFFICIENT_DATA' : result.verdict,
    verdictReasons: searchFailed ? ['La búsqueda de competencia no se completó: no hay datos de mercado para evaluar.', ...result.reasons] : result.reasons,
    risks: result.risks,
    evidenceConfidence: result.confidence,
    confidenceReasons: result.confidenceReasons,
    incompleteModules: incomplete,
  };
}

/**
 * Migra y valida un reporte guardado. Devuelve null si no es recuperable.
 * v0 (prototipos sin `schemaVersion`) → v1: se completan campos nuevos.
 */
export function migrateReport(raw: unknown): ResearchReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = { ...(raw as Record<string, unknown>) };
  if (data['schemaVersion'] === undefined) {
    data['schemaVersion'] = 1;
    data['discarded'] ??= [];
    data['queries'] ??= [];
    data['notes'] ??= [];
    data['risks'] ??= [];
    data['confidenceReasons'] ??= [];
    data['incompleteModules'] ??= [];
    data['isDemo'] ??= false;
  }
  const parsed = ResearchReportSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
