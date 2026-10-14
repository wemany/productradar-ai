import { normalizeText, offersToCsv, renderPrintableReport, reportToJson, type ResearchReport } from '@productradar/core';
import { browser } from 'wxt/browser';
import { APP_VERSION } from './settings';

function slug(report: ResearchReport): string {
  const base = normalizeText(report.product.name).replace(/\s+/g, '-').slice(0, 48) || 'producto';
  const date = (report.finishedAt ?? report.startedAt).slice(0, 10);
  return `productradar-${report.isDemo ? 'DEMO-' : ''}${base}-${date}`;
}

function download(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportJson(report: ResearchReport): void {
  download(`${slug(report)}.json`, reportToJson(report, APP_VERSION), 'application/json');
}

export function exportCsv(report: ResearchReport): void {
  download(`${slug(report)}-competidores.csv`, offersToCsv(report), 'text/csv;charset=utf-8');
}

export function exportHtml(report: ResearchReport): void {
  download(`${slug(report)}.html`, renderPrintableReport(report), 'text/html;charset=utf-8');
}

/** Abre la vista imprimible (guardar como PDF desde el diálogo de impresión). */
export async function openPrintView(report: ResearchReport): Promise<void> {
  await browser.tabs.create({ url: `${browser.runtime.getURL('/print.html')}?id=${encodeURIComponent(report.id)}` });
}
