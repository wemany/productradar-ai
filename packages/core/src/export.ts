import { AD_COUNT_UNVERIFIABLE, AD_HISTORY_UNAVAILABLE } from './ads';
import { SUPPLIER_MATCH_LABELS } from './alibaba';
import { computeContribution, computeScenario, headlineContribution, SCENARIO_RULES } from './finance';
import { getMarketConfig } from './markets';
import { MATCH_LABELS } from './matching';
import { formatMoney, formatMoneyRange, formatPercent } from './money';
import { effectiveMatchType, exclusionReason, EXCLUSION_LABELS, summarizeMarketPrices } from './pricing';
import { MODULE_LABELS, MODULE_ORDER } from './report';
import type { CompetitorOffer, ResearchReport } from './schemas';
import { safeHref } from './url';
import { CONFIDENCE_LABELS, VERDICT_DISCLAIMER, VERDICT_LABELS } from './verdict';

export const APP_NAME = 'ProductRadar AI';
export const DEMO_LABEL = 'DATOS DE DEMOSTRACIÓN — FICTICIOS';

export const VERIFICATION_LABELS: Record<CompetitorOffer['evidence']['verification'], string> = {
  PAGE_VERIFIED: 'Verificado en ficha',
  SEARCH_SNIPPET_ONLY: 'Visible solo en buscador',
  UNAVAILABLE: 'No disponible',
};

/** Escapa una celda CSV y neutraliza fórmulas (=, +, -, @) para hojas de cálculo. */
export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function offersToCsv(report: ResearchReport): string {
  const header = [
    'id',
    'vendedor',
    'dominio',
    'titulo',
    'url',
    'coincidencia',
    'motivo_coincidencia',
    'precio',
    'moneda',
    'verificacion',
    'fuente_precio',
    'disponibilidad',
    'en_estadistica_verificada',
    'motivo_exclusion',
    'ajuste_usuario',
    'ajuste_mercado',
    'senales_locales',
    'error_verificacion',
    'observado_en',
    'datos_demo',
  ];
  const rows = report.offers.map((o) => {
    const reason = exclusionReason(o, report.currency);
    return [
      o.id,
      o.seller,
      o.domain,
      o.title,
      o.url,
      MATCH_LABELS[effectiveMatchType(o)],
      o.matchReason,
      o.price?.amount,
      o.price?.currency,
      VERIFICATION_LABELS[o.evidence.verification],
      o.priceSource,
      o.availability,
      reason === null ? 'si' : 'no',
      reason ? EXCLUSION_LABELS[reason] : '',
      o.userOverride ?? '',
      o.marketFit,
      o.localSignals.join(' | '),
      o.verificationError ?? '',
      o.evidence.retrievedAt,
      report.isDemo ? 'si' : 'no',
    ].map(csvCell);
  });
  const lines = [header.join(','), ...rows.map((r) => r.join(','))];
  if (report.isDemo) lines.unshift(csvCell(`# ${DEMO_LABEL}`));
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}

export function reportToJson(report: ResearchReport, appVersion = '0.1.0'): string {
  return JSON.stringify(
    {
      generator: `${APP_NAME} ${appVersion}`,
      exportedAt: new Date().toISOString(),
      disclaimer: VERDICT_DISCLAIMER,
      demo: report.isDemo ? DEMO_LABEL : undefined,
      report,
    },
    null,
    2,
  );
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function link(url: string, text?: string): string {
  const href = safeHref(url);
  const label = escapeHtml(text ?? url);
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
}

/** Reporte autocontenido para imprimir o guardar como PDF desde el navegador. */
export function renderPrintableReport(report: ResearchReport): string {
  const market = getMarketConfig(report.country);
  const money = (n: number, currency = report.currency) => escapeHtml(formatMoney(n, currency, market.locale));
  const summary = summarizeMarketPrices(report.offers, report.currency);
  const contribution = report.financials ? computeContribution(report.financials) : undefined;
  const headline = contribution ? headlineContribution(contribution) : null;
  const date = new Date(report.finishedAt ?? report.startedAt).toLocaleString(market.locale);

  const demoBanner = report.isDemo ? `<div class="demo">${escapeHtml(DEMO_LABEL)} · No representan búsquedas reales</div>` : '';
  const attrs = Object.entries(report.product.attributes)
    .map(([k, v]) => `<li><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</li>`)
    .join('');

  const offerRows = report.offers
    .map((o) => {
      const reason = exclusionReason(o, report.currency);
      return `<tr>
        <td>${escapeHtml(o.seller)}<div class="muted">${escapeHtml(o.domain)}</div></td>
        <td>${link(o.url, o.title)}</td>
        <td>${escapeHtml(MATCH_LABELS[effectiveMatchType(o)])}${o.userOverride ? ' (ajuste manual)' : ''}<div class="muted">${escapeHtml(o.matchReason)}</div></td>
        <td class="num">${o.price ? money(o.price.amount, o.price.currency) : '—'}</td>
        <td>${escapeHtml(VERIFICATION_LABELS[o.evidence.verification])}${o.verificationError ? `<div class="muted">${escapeHtml(o.verificationError)}</div>` : ''}</td>
        <td>${reason === null ? 'Sí' : `No · ${escapeHtml(EXCLUSION_LABELS[reason])}`}</td>
        <td class="muted">${escapeHtml(new Date(o.evidence.retrievedAt).toLocaleString(market.locale))}</td>
      </tr>`;
    })
    .join('');

  const supplierRows = report.supplierReferences
    .map(
      (s) => `<tr>
        <td>${link(s.url, s.title)}</td>
        <td class="num">${s.priceMin ? escapeHtml(formatMoneyRange(s.priceMin.amount, s.priceMax?.amount, s.priceMin.currency, market.locale)) : 'Sin precio visible'}</td>
        <td>${s.moq ? `${escapeHtml(s.moq)} ${escapeHtml(s.moqUnit ?? '')}` : '—'}</td>
        <td>${escapeHtml(SUPPLIER_MATCH_LABELS[s.matchType])}</td>
      </tr>`,
    )
    .join('');

  const scenarioRows =
    report.financials && report.scenarios
      ? report.scenarios
          .map((sc) => {
            const r = computeScenario(report.financials!, sc);
            const h = headlineContribution(r);
            return `<tr><td>${escapeHtml(SCENARIO_RULES[sc.key].label)}</td><td class="num">${sc.sellingPrice !== undefined ? money(sc.sellingPrice) : '—'}</td><td class="num">${sc.acquisitionCostPerOrder !== undefined ? money(sc.acquisitionCostPerOrder) : 'Sin CPA'}</td><td class="num">${h ? `${money(h.amount)} (${escapeHtml(formatPercent(h.pct, market.locale))})` : '—'}</td></tr>`;
          })
          .join('')
      : '';

  const evidenceRows = report.offers
    .filter((o) => o.evidence.verification !== 'UNAVAILABLE')
    .map(
      (o) =>
        `<li>${escapeHtml(new Date(o.evidence.retrievedAt).toLocaleString(market.locale))} · ${escapeHtml(o.evidence.method)} · ${escapeHtml(VERIFICATION_LABELS[o.evidence.verification])} · ${link(o.evidence.url)}</li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${APP_NAME} — ${report.product.name}`)}</title>
<style>
  :root { --ink:#1c1917; --muted:#78716c; --line:#e7e5e4; --accent:#5b4bd6; --bg:#fafaf9; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); margin: 32px auto; max-width: 980px; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 28px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
  .muted { color: var(--muted); font-size: 11px; } .num { text-align: right; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 6px; border-bottom: 1px solid var(--line); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .verdict { border: 1px solid var(--line); border-left: 4px solid var(--accent); padding: 12px 16px; border-radius: 8px; background: var(--bg); }
  .demo { background: #fef3c7; border: 2px dashed #b45309; color: #78350f; padding: 8px 12px; font-weight: 700; text-align: center; margin-bottom: 16px; border-radius: 6px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; } .stat { border: 1px solid var(--line); border-radius: 8px; padding: 8px; } .stat b { display: block; font-size: 15px; }
  a { color: var(--accent); word-break: break-word; } ul { padding-left: 18px; }
  @media print { body { margin: 0; } a { color: var(--ink); } .noprint { display: none; } }
</style>
</head>
<body>
${demoBanner}
<header>
  <div class="muted">${escapeHtml(APP_NAME)} · Investigación de producto · ${escapeHtml(market.name)} · ${escapeHtml(date)}</div>
  <h1>${escapeHtml(report.product.name)}</h1>
  <div class="muted">${[report.product.brand, report.product.model, report.product.gtin ? `GTIN ${report.product.gtin}` : ''].filter(Boolean).map(escapeHtml).join(' · ')}</div>
  ${attrs ? `<ul>${attrs}</ul>` : ''}
</header>

<h2>Veredicto</h2>
<div class="verdict">
  <b>${escapeHtml(VERDICT_LABELS[report.verdict])}</b> · ${escapeHtml(CONFIDENCE_LABELS[report.evidenceConfidence])}
  <ul>${report.verdictReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
  <div class="muted">${escapeHtml(VERDICT_DISCLAIMER)}</div>
</div>

<h2>Mercado (muestra consultada)</h2>
<div class="grid">
  <div class="stat"><span class="muted">Tiendas encontradas en la muestra</span><b>${escapeHtml(new Set(report.offers.map((o) => o.domain)).size)}</b></div>
  <div class="stat"><span class="muted">Precios exactos verificados</span><b>${escapeHtml(summary.verified?.count ?? 0)}</b></div>
  <div class="stat"><span class="muted">Mínimo · Mediana</span><b>${summary.verified ? `${money(summary.verified.min)} · ${money(summary.verified.median)}` : '—'}</b></div>
  <div class="stat"><span class="muted">Máximo</span><b>${summary.verified ? money(summary.verified.max) : '—'}</b></div>
</div>
<p class="muted">Cobertura limitada a los resultados del buscador; no representa todas las tiendas del país. Solo se usan en la estadística precios verificados en la ficha, del mismo producto y en ${escapeHtml(report.currency)}.</p>

<h2>Competidores</h2>
<table><thead><tr><th>Tienda</th><th>Ficha</th><th>Coincidencia</th><th>Precio</th><th>Verificación</th><th>En estadística</th><th>Observado</th></tr></thead>
<tbody>${offerRows || '<tr><td colspan="7">No encontramos ofertas verificables en las fuentes consultadas.</td></tr>'}</tbody></table>

<h2>Referencias de Alibaba</h2>
<p class="muted">Precios indicativos publicados, sujetos a negociación y volumen. No incluyen flete, seguro, aranceles, IVA ni despacho local. No son costos puestos en ${escapeHtml(market.name)}.</p>
<table><thead><tr><th>Referencia</th><th>Precio publicado</th><th>MOQ</th><th>Coincidencia</th></tr></thead>
<tbody>${supplierRows || '<tr><td colspan="4">Sin precios de abastecimiento verificables.</td></tr>'}</tbody></table>

<h2>Publicidad</h2>
<ul>
  <li>${escapeHtml(AD_COUNT_UNVERIFIABLE)}</li>
  <li>${escapeHtml(AD_HISTORY_UNAVAILABLE)}</li>
  ${report.adResearch.links.map((l) => `<li>${link(l.url, l.label)} — ${escapeHtml(l.description)}</li>`).join('')}
</ul>

<h2>Rentabilidad estimada (contribución por pedido)</h2>
${
  contribution && headline
    ? `<p><b>${headline.adsIncluded ? 'Contribución con publicidad' : 'Contribución antes de publicidad'}:</b> ${money(headline.amount)} (${escapeHtml(formatPercent(headline.pct, market.locale))})${contribution.breakEvenCpa !== undefined ? ` · CPA máximo de equilibrio: ${money(contribution.breakEvenCpa)}` : ''}</p>`
    : `<p>${escapeHtml(contribution?.status === 'MISSING_COST' ? 'Añade tu costo de compra para evaluar rentabilidad.' : 'Calculadora sin completar.')}</p>`
}
${contribution?.warnings.length ? `<ul>${contribution.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
${scenarioRows ? `<table><thead><tr><th>Escenario (simulación)</th><th>Precio</th><th>CPA</th><th>Contribución</th></tr></thead><tbody>${scenarioRows}</tbody></table>` : ''}
<p class="muted">Margen de contribución estimado, no utilidad neta: no incluye gastos fijos ni impuestos de renta.</p>

<h2>Riesgos</h2>
<ul>${report.risks.map((r) => `<li>${escapeHtml(r)}</li>`).join('') || '<li>Sin riesgos adicionales detectados con los datos disponibles.</li>'}</ul>

<h2>Confianza de la evidencia</h2>
<ul>${report.confidenceReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>

<h2>Estado de los módulos</h2>
<ul>${MODULE_ORDER.map((k) => `<li>${escapeHtml(MODULE_LABELS[k])}: ${escapeHtml(report.modules[k].status)}${report.modules[k].message ? ` — ${escapeHtml(report.modules[k].message)}` : ''}</li>`).join('')}</ul>

<h2>Evidencias</h2>
<ul>${evidenceRows || '<li>Sin evidencias registradas.</li>'}</ul>
<p class="muted">Consultas: ${report.queries.map((q) => escapeHtml(q.query)).join(' · ')} · Proveedor: ${escapeHtml(report.searchProvider)}</p>
</body>
</html>`;
}
