import {
  AD_COUNT_UNVERIFIABLE,
  AD_HISTORY_UNAVAILABLE,
  buildAlibabaSearchUrl,
  effectiveMatchType,
  emptyFinancialInputs,
  getMarketConfig,
  isAssistedReport,
  MODULE_LABELS,
  MODULE_ORDER,
  recomputeReport,
  safeHref,
  summarizeMarketPrices,
  type CompetitorOffer,
  type ResearchReport,
} from '@productradar/core';
import { ArrowLeft, Braces, ExternalLink, FileDown, Megaphone, Package, Plus, Printer, Sheet } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { DemoStamp } from '../components/DemoBanner';
import { AssistedPanel } from '../components/report/AssistedPanel';
import { Calculator, Scenarios } from '../components/report/Calculator';
import { OfferCard } from '../components/report/OfferCard';
import { PriceStrip } from '../components/report/PriceStrip';
import { SupplierCard } from '../components/report/SupplierCard';
import { SocialMentions } from '../components/report/SocialMentions';
import { VerdictCard } from '../components/report/VerdictCard';
import { Badge, Button, Callout, Card, Disclosure, SectionTitle, Stat } from '../components/ui';
import { es } from '../i18n/es';
import { cx, dateTime, money, plural } from '../lib/format';
import { exportCsv, exportHtml, exportJson, openPrintView } from '../services/export';
import { saveReport } from '../services/history';

type OfferFilter = 'all' | 'exact' | 'other' | 'unverified';

const STATUS_BADGE: Record<ResearchReport['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  RUNNING: { label: 'En curso', tone: 'neutral' },
  COMPLETE: { label: 'Completo', tone: 'ok' },
  PARTIAL: { label: 'Parcial', tone: 'warn' },
  CANCELLED: { label: 'Cancelado', tone: 'warn' },
  FAILED: { label: 'Sin resultados', tone: 'bad' },
};

const SECTIONS = [
  ['veredicto', 'Veredicto'],
  ['mercado', 'Mercado'],
  ['competidores', 'Competidores'],
  ['alibaba', 'Alibaba'],
  ['publicidad', 'Publicidad'],
  ['calculadora', 'Rentabilidad'],
  ['riesgos', 'Riesgos'],
  ['evidencias', 'Evidencias'],
] as const;

export function ReportScreen({
  report,
  notice,
  onChange,
  onNew,
  onBack,
  onOpenSettings,
}: {
  report: ResearchReport;
  /** Aviso puntual (p. ej. resultado de «Agregar esta ficha» desde el menú contextual). */
  notice?: string;
  onChange: (r: ResearchReport) => void;
  onNew: () => void;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  const market = report.country;
  const country = getMarketConfig(market);
  const currency = report.currency;
  const summary = useMemo(() => summarizeMarketPrices(report.offers, currency), [report.offers, currency]);
  const financials = report.financials ?? emptyFinancialInputs(currency);
  const [filter, setFilter] = useState<OfferFilter>('all');
  const update = (patch: Partial<ResearchReport>) => onChange(recomputeReport({ ...report, ...patch }));
  const assisted = isAssistedReport(report);

  const storeCount = new Set(report.offers.map((o) => o.domain)).size;
  const filters: Record<OfferFilter, (o: CompetitorOffer) => boolean> = {
    all: () => true,
    exact: (o) => effectiveMatchType(o) === 'EXACT' && o.userOverride !== 'EXCLUDED',
    other: (o) => effectiveMatchType(o) !== 'EXACT' || o.userOverride === 'EXCLUDED',
    unverified: (o) => o.evidence.verification !== 'PAGE_VERIFIED',
  };
  const visibleOffers = report.offers.filter(filters[filter]);
  const setOverride = (id: string, override: CompetitorOffer['userOverride']) =>
    update({ offers: report.offers.map((o) => (o.id === id ? { ...o, userOverride: override } : o)) });

  return (
    <div className="space-y-5 pb-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Inicio
      </button>

      {/* 1. Cabecera */}
      <header className="rise flex gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface">
          {report.product.imageUrl ? (
            <img src={report.product.imageUrl} alt="" className="size-full object-contain" referrerPolicy="no-referrer" />
          ) : (
            <Package className="size-6 text-faint" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_BADGE[report.status].tone}>{STATUS_BADGE[report.status].label}</Badge>
            <span className="text-[11.5px] text-muted">
              {country.name} · {dateTime(report.finishedAt ?? report.startedAt, market)}
            </span>
            {report.isDemo && <DemoStamp />}
          </div>
          <h1 className="mt-1 font-serif text-[23px] leading-[1.1] text-ink">{report.product.name}</h1>
          <p className="mt-1 text-[12px] text-muted">
            {[report.product.brand, report.product.model, report.product.gtin && `GTIN ${report.product.gtin}`].filter(Boolean).join(' · ') || 'Sin marca ni modelo confirmados'}
          </p>
          <p className="mt-1.5 text-[12px] text-ink-2">
            {plural(storeCount, 'tienda encontrada', 'tiendas encontradas')} en la muestra · {plural(summary.verified?.count ?? 0, 'precio verificado', 'precios verificados')}
          </p>
        </div>
      </header>

      {notice && (
        <Callout tone="warn" role="status">
          {notice}
        </Callout>
      )}
      {assisted && <AssistedPanel report={report} onChange={onChange} />}

      {report.status === 'FAILED' && (
        <Callout tone="error" title="No pudimos completar la búsqueda" role="alert">
          {(report.modules.search.message ?? 'El buscador no respondió').replace(/\.?\s*$/, '.')} Revisa la configuración del servicio e inténtalo de nuevo.
          <div className="mt-2">
            <Button size="sm" onClick={onOpenSettings}>
              Abrir configuración
            </Button>
          </div>
        </Callout>
      )}
      {report.notes.map((n) => (
        <Callout key={n} tone="warn">
          {n}
        </Callout>
      ))}

      <nav aria-label="Secciones del reporte" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
        <ul className="flex gap-1.5 whitespace-nowrap">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 no-underline hover:border-ink/30 hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* 2. Veredicto */}
      <div id="veredicto" className="scroll-mt-14">
        <VerdictCard verdict={report.verdict} reasons={report.verdictReasons} confidence={report.evidenceConfidence} confidenceReasons={report.confidenceReasons} />
      </div>

      {/* 3. Mercado */}
      <Section id="mercado" eyebrow={`Mercado · ${country.name}`} title="Precios en la muestra consultada">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Tiendas encontradas en la muestra" value={storeCount} sub={`${report.offers.length} fichas · ${report.discarded.length} descartadas`} />
          <Stat label="Con precio verificado" value={summary.verified?.count ?? 0} sub={summary.verified ? `${summary.verified.domains} dominios` : 'Mismo producto, en ficha'} />
          <Stat label="Mínimo verificado" value={summary.verified ? money(summary.verified.min, currency, market) : '—'} emphasis />
          <Stat label="Mediana verificada" value={summary.verified ? money(summary.verified.median, currency, market) : '—'} emphasis />
          <Stat label="Máximo verificado" value={summary.verified ? money(summary.verified.max, currency, market) : '—'} emphasis />
          <Stat
            label="Referencia del buscador"
            value={summary.snippetReference ? `${summary.snippetReference.count} sin verificar` : '—'}
            sub={summary.snippetReference ? `${money(summary.snippetReference.min, currency, market)} – ${money(summary.snippetReference.max, currency, market)}` : 'No entra en la estadística'}
          />
        </div>
        <Card className="mt-3 p-3">
          {summary.verified || summary.snippetReference ? (
            <PriceStrip verified={summary.verified} snippet={summary.snippetReference} yourPrice={financials.sellingPrice} currency={currency} market={market} />
          ) : (
            <p className="text-[12.5px] text-muted">
              {assisted
                ? 'Aún no hay fichas con precio verificado. Agrega fichas desde las tiendas con «Agregar esta ficha».'
                : 'No encontramos ofertas verificables en las fuentes consultadas. Eso no significa que no haya competencia.'}
            </p>
          )}
        </Card>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          {assisted
            ? `Cobertura limitada a las fichas agregadas por ti (una muestra): no son todas las tiendas de ${country.name}.`
            : `Cobertura limitada a los resultados del buscador: no son todas las tiendas de ${country.name}.`}{' '}
          Mínimo, mediana y máximo usan solo precios del mismo producto, verificados en la ficha y en {currency}.
        </p>
      </Section>

      {/* 4. Competidores */}
      <Section id="competidores" eyebrow="Competidores" title={`${report.offers.length} fichas en la muestra`}>
        <div role="group" aria-label="Filtrar competidores" className="mb-3 flex flex-wrap gap-1.5">
          {(
            [
              ['all', 'Todos'],
              ['exact', 'Exactos'],
              ['other', 'Similares y variantes'],
              ['unverified', 'Sin precio verificado'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cx(
                'rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                filter === key ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink-2 hover:border-ink/40',
              )}
            >
              {label} <span className="num opacity-70">{report.offers.filter(filters[key]).length}</span>
            </button>
          ))}
        </div>
        {visibleOffers.length === 0 ? (
          <p className="text-[12.5px] text-muted">No hay fichas en este filtro.</p>
        ) : (
          <div className="space-y-2.5">
            {visibleOffers.map((o) => (
              <OfferCard key={o.id} offer={o} currency={currency} market={market} outlier={summary.outliers.includes(o.id)} onOverride={setOverride} />
            ))}
          </div>
        )}
      </Section>

      {/* 5. Alibaba */}
      <Section id="alibaba" eyebrow="Abastecimiento" title="Referencias públicas de Alibaba">
        <Callout tone="info" className="mb-3">
          Precios indicativos publicados, sujetos a negociación y volumen. No incluyen flete, seguro, aranceles, IVA ni despacho local: no son costos puestos en {country.name}.
        </Callout>
        {report.modules.suppliers.status === 'FAILED' && (
          <Callout tone="warn" className="mb-3" title="Sección parcial">
            {report.modules.suppliers.message}
          </Callout>
        )}
        {report.supplierReferences.length === 0 && assisted ? (
          <div className="space-y-2">
            <p className="text-[12.5px] text-muted">Sin buscador automático no se consultan referencias de Alibaba. Puedes revisarlas tú mismo:</p>
            <a
              href={safeHref(buildAlibabaSearchUrl(report.product))}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink no-underline hover:border-accent"
            >
              Buscar en Alibaba <ExternalLink className="size-3.5 text-accent" aria-hidden />
            </a>
          </div>
        ) : report.supplierReferences.length === 0 ? (
          <p className="text-[12.5px] text-muted">Sin precios de abastecimiento verificables.</p>
        ) : (
          <div className="space-y-2.5">
            {report.supplierReferences.map((s) => (
              <SupplierCard key={s.id} reference={s} market={market} financials={financials} onUseAsCost={(next) => update({ financials: next })} />
            ))}
          </div>
        )}
      </Section>

      {/* 6. Publicidad */}
      <Section id="publicidad" eyebrow="Publicidad" title="Señales publicitarias">
        <Card className="space-y-3 p-3.5">
          <ul className="space-y-1 text-[12.5px] text-ink-2">
            <li className="flex gap-2">
              <Megaphone className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden /> {AD_COUNT_UNVERIFIABLE}.
            </li>
            <li className="flex gap-2">
              <Megaphone className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden /> {AD_HISTORY_UNAVAILABLE}.
            </li>
          </ul>
          <p className="text-[11.5px] text-muted">{report.adResearch.coverageNote}</p>
          <div className="space-y-2">
            {report.adResearch.links.map((l) => {
              const href = safeHref(l.url);
              return (
                <a
                  key={l.url}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 no-underline hover:border-accent"
                >
                  <span>
                    <span className="block text-[13px] font-semibold text-ink">{l.label}</span>
                    <span className="block text-[11.5px] text-muted">{l.description}</span>
                  </span>
                  <ExternalLink className="size-4 shrink-0 text-accent" aria-hidden />
                </a>
              );
            })}
          </div>
          <SocialMentions evidence={report.adResearch.evidence} />
        </Card>
      </Section>

      {/* 7–8. Calculadora y escenarios */}
      <Section id="calculadora" eyebrow="Rentabilidad" title="Calculadora de contribución">
        {report.isDemo && (
          <Callout tone="warn" className="mb-3">
            Valores de ejemplo ficticios para la demostración. Cámbialos para ver cómo se recalcula todo.
          </Callout>
        )}
        <Card className="p-4">
          <Calculator financials={financials} onChange={(next) => update({ financials: next })} market={market} verified={summary.verified} />
        </Card>
        <h3 className="mt-5 mb-2 text-[14px] font-semibold text-ink">Escenarios</h3>
        <Scenarios financials={financials} scenarios={report.scenarios} verified={summary.verified} market={market} onChange={(scenarios) => update({ scenarios })} />
      </Section>

      {/* 9. Riesgos */}
      <Section id="riesgos" eyebrow="Riesgos" title="Qué podría salir mal">
        {report.risks.length === 0 ? (
          <p className="text-[12.5px] text-muted">Sin riesgos adicionales detectados con los datos disponibles.</p>
        ) : (
          <ul className="space-y-1.5">
            {report.risks.map((r) => (
              <li key={r} className="flex gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                {r}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 10. Evidencias */}
      <Section id="evidencias" eyebrow="Trazabilidad" title="Evidencias y fuentes">
        <Card className="divide-y divide-line">
          <div className="p-3.5">
            <Disclosure summary={`Hallazgos con fuente (${report.offers.length + report.supplierReferences.length})`}>
              <ul className="space-y-2">
                {[...report.offers.map((o) => o.evidence), ...report.supplierReferences.map((s) => s.evidence)].map((e, i) => (
                  <li key={`${e.url}-${i}`} className="text-[11.5px] text-muted">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone={e.verification === 'PAGE_VERIFIED' ? 'ok' : 'neutral'} mono>
                        {es.verification[e.verification]}
                      </Badge>
                      <span className="font-mono text-[10.5px]">{e.method}</span>
                      <span>· {dateTime(e.retrievedAt, market)}</span>
                    </div>
                    <a href={safeHref(e.url)} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate">
                      {e.url}
                    </a>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
          <div className="p-3.5">
            <Disclosure summary={`Consultas realizadas (${report.queries.length}) · ${report.searchProvider}`}>
              <ul className="space-y-1 font-mono text-[10.5px] text-muted">
                {report.queries.map((q, i) => (
                  <li key={`${q.query}-${i}`}>
                    {q.ok ? '✓' : '✕'} [{q.purpose === 'MARKET' ? 'mercado' : q.purpose === 'SOCIAL' ? 'redes' : 'Alibaba'}] {q.query} — {q.ok ? `${q.resultCount} resultados` : q.error}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
          <div className="p-3.5">
            <Disclosure summary={`Resultados descartados (${report.discarded.length})`}>
              <ul className="space-y-1 text-[11.5px] text-muted">
                {report.discarded.map((d) => (
                  <li key={d.url}>
                    <a href={safeHref(d.url)} target="_blank" rel="noopener noreferrer">
                      {d.title}
                    </a>{' '}
                    — {d.reason}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
          <div className="p-3.5">
            <Disclosure summary="Estado de cada módulo">
              <ul className="space-y-1 text-[11.5px] text-muted">
                {MODULE_ORDER.map((k) => (
                  <li key={k}>
                    <b className="text-ink-2">{MODULE_LABELS[k]}:</b> {es.moduleStatus[report.modules[k].status]}
                    {report.modules[k].message ? ` — ${report.modules[k].message}` : ''}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        </Card>
      </Section>

      {/* 11. Exportar */}
      <section aria-labelledby="export-title" className="card space-y-3 p-4">
        <div>
          <div className="eyebrow">Exportar</div>
          <h2 id="export-title" className="text-[15px] font-semibold text-ink">
            Guardado en este equipo
          </h2>
          <p className="text-[11.5px] text-muted">Los cambios se guardan automáticamente en tu historial local.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => void saveReport(report).then(() => openPrintView(report))}>
            Imprimir / PDF
          </Button>
          <Button size="sm" icon={<Sheet className="size-3.5" />} onClick={() => exportCsv(report)}>
            CSV competidores
          </Button>
          <Button size="sm" icon={<Braces className="size-3.5" />} onClick={() => exportJson(report)}>
            JSON completo
          </Button>
          <Button size="sm" icon={<FileDown className="size-3.5" />} onClick={() => exportHtml(report)}>
            HTML del reporte
          </Button>
        </div>
        <Button variant="primary" className="w-full" icon={<Plus className="size-4" />} onClick={onNew}>
          {es.nav.newResearch}
        </Button>
      </section>
    </div>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-14">
      <SectionTitle eyebrow={eyebrow} title={title} id={`${id}-title`} />
      {children}
    </section>
  );
}
