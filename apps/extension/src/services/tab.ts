import { identityFromSnapshot, type PageSnapshot, type ProductIdentity } from '@productradar/core';
import { browser } from 'wxt/browser';
import { collectPageSnapshot } from './page-snapshot';

export type TabAnalysis =
  | { ok: true; identity: ProductIdentity; snapshot: PageSnapshot }
  | { ok: false; reason: 'NO_TAB' | 'NO_ACCESS' | 'RESTRICTED'; message: string };

const RESTRICTED = /^(chrome|chrome-extension|edge|about|devtools|view-source|file):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i;

/**
 * Lee metadatos de producto de la pestaña activa. Funciona con el permiso
 * `activeTab` (otorgado al hacer clic en el ícono o en el menú contextual) o
 * con el permiso del sitio si el usuario lo concedió.
 */
export async function analyzeActiveTab(marketCurrency: string): Promise<TabAnalysis> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return { ok: false, reason: 'NO_TAB', message: 'No hay una pestaña activa.' };
  if (tab.url && RESTRICTED.test(tab.url)) {
    return { ok: false, reason: 'RESTRICTED', message: 'Chrome no permite leer esta página (páginas internas o la Chrome Web Store).' };
  }
  try {
    const [result] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageSnapshot });
    const snapshot = result?.result as PageSnapshot | undefined;
    if (!snapshot) return { ok: false, reason: 'NO_ACCESS', message: 'No fue posible leer esta página.' };
    return { ok: true, snapshot, identity: identityFromSnapshot(snapshot, marketCurrency) };
  } catch {
    return {
      ok: false,
      reason: 'NO_ACCESS',
      message: 'Chrome necesita tu autorización para leer esta pestaña.',
    };
  }
}
