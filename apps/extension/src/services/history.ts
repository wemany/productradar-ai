import { migrateReport, ResearchReportSchema, type ResearchReport, type Verdict } from '@productradar/core';
import { browser } from 'wxt/browser';
import { z } from 'zod';

/**
 * Historial local (chrome.storage.local). Nada se sube a servidores.
 * Índice liviano + un registro por reporte; se conservan los 50 más recientes.
 */

const INDEX_KEY = 'history:index:v1';
const REPORT_PREFIX = 'report:';
export const MAX_REPORTS = 50;

const EntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  verdict: z.string(),
  isDemo: z.boolean(),
  savedAt: z.string(),
  status: z.string(),
});
export type HistoryEntry = z.infer<typeof EntrySchema> & { verdict: Verdict };

async function readIndex(): Promise<HistoryEntry[]> {
  const data = await browser.storage.local.get(INDEX_KEY);
  const parsed = z.array(EntrySchema).safeParse(data[INDEX_KEY]);
  return parsed.success ? (parsed.data as HistoryEntry[]) : [];
}

export async function listHistory(): Promise<HistoryEntry[]> {
  return (await readIndex()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function loadReport(id: string): Promise<ResearchReport | null> {
  const key = `${REPORT_PREFIX}${id}`;
  const data = await browser.storage.local.get(key);
  return migrateReport(data[key]);
}

export async function saveReport(report: ResearchReport): Promise<void> {
  const check = ResearchReportSchema.safeParse(report);
  if (!check.success) console.warn('[ProductRadar] Reporte fuera de esquema; podría no reabrirse:', check.error.issues.slice(0, 3));
  const entry: HistoryEntry = {
    id: report.id,
    name: report.product.name,
    country: report.country,
    verdict: report.verdict,
    isDemo: report.isDemo,
    savedAt: new Date().toISOString(),
    status: report.status,
  };
  let index = [entry, ...(await readIndex()).filter((e) => e.id !== report.id)];
  const removed = index.slice(MAX_REPORTS);
  index = index.slice(0, MAX_REPORTS);
  try {
    await browser.storage.local.set({ [`${REPORT_PREFIX}${report.id}`]: report, [INDEX_KEY]: index });
  } catch {
    // Cuota llena: liberar los 10 más antiguos y reintentar una vez.
    const extra = index.splice(Math.max(1, index.length - 10));
    removed.push(...extra);
    await browser.storage.local.remove(removed.map((e) => `${REPORT_PREFIX}${e.id}`));
    await browser.storage.local.set({ [`${REPORT_PREFIX}${report.id}`]: report, [INDEX_KEY]: index });
  }
  if (removed.length) await browser.storage.local.remove(removed.map((e) => `${REPORT_PREFIX}${e.id}`));
}

export async function deleteReport(id: string): Promise<void> {
  const index = (await readIndex()).filter((e) => e.id !== id);
  await browser.storage.local.remove(`${REPORT_PREFIX}${id}`);
  await browser.storage.local.set({ [INDEX_KEY]: index });
}

export async function clearHistory(): Promise<void> {
  const index = await readIndex();
  await browser.storage.local.remove([INDEX_KEY, ...index.map((e) => `${REPORT_PREFIX}${e.id}`)]);
}

export async function historyBytes(): Promise<number | null> {
  try {
    const index = await readIndex();
    return await browser.storage.local.getBytesInUse([INDEX_KEY, ...index.map((e) => `${REPORT_PREFIX}${e.id}`)]);
  } catch {
    return null;
  }
}
