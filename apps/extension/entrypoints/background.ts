import '../src/zod-config';
import { collectPageSnapshot } from '../src/services/page-snapshot';
import { setPendingInput } from '../src/services/pending-input';

/**
 * Service worker: abre el panel lateral, crea el menú contextual y recoge
 * metadatos de la pestaña SOLO cuando el usuario lo pide (activeTab).
 */
export default defineBackground(() => {
  const setup = () => {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.warn('[ProductRadar] sidePanel', error));
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({ id: 'pr-page', title: 'Investigar este producto con ProductRadar', contexts: ['page'] });
      browser.contextMenus.create({ id: 'pr-link', title: 'Investigar el producto de este enlace', contexts: ['link'] });
      browser.contextMenus.create({ id: 'pr-image', title: 'Identificar esta imagen con ProductRadar', contexts: ['image'] });
    });
  };

  browser.runtime.onInstalled.addListener(setup);
  browser.runtime.onStartup.addListener(setup);
  // Idempotente: asegura que el clic en el ícono abra el panel aunque el service worker se reinicie.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  async function snapshotTab(tabId: number) {
    try {
      const [result] = await browser.scripting.executeScript({ target: { tabId }, func: collectPageSnapshot });
      if (result?.result) await setPendingInput({ kind: 'snapshot', snapshot: result.result });
      else await setPendingInput({ kind: 'error', message: 'No fue posible leer esta página.' });
    } catch {
      await setPendingInput({ kind: 'error', message: 'Chrome no permite leer esta página (por ejemplo, páginas internas o la Chrome Web Store).' });
    }
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    // sidePanel.open debe llamarse de inmediato, dentro del gesto del usuario.
    if (tab?.windowId !== undefined) browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    if (info.menuItemId === 'pr-page' && tab?.id !== undefined) void snapshotTab(tab.id);
    if (info.menuItemId === 'pr-link' && info.linkUrl) void setPendingInput({ kind: 'url', url: info.linkUrl });
    if (info.menuItemId === 'pr-image' && info.srcUrl) void setPendingInput({ kind: 'imageUrl', url: info.srcUrl, pageUrl: info.pageUrl });
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'analyze-page' || tab?.id === undefined) return;
    if (tab.windowId !== undefined) browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    void snapshotTab(tab.id);
  });
});
