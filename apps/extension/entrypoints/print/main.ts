import '../../src/zod-config';
import { renderPrintableReport } from '@productradar/core';
import { loadReport } from '../../src/services/history';

/**
 * Vista imprimible: carga el reporte guardado localmente y lo muestra con el
 * HTML generado por el núcleo (todo el contenido externo va escapado y no
 * contiene scripts). Desde aquí el usuario imprime o guarda como PDF.
 */
async function main() {
  const status = document.getElementById('status');
  const id = new URLSearchParams(location.search).get('id');
  const report = id ? await loadReport(id) : null;
  if (!report) {
    if (status) status.textContent = 'No encontramos este reporte en el historial local.';
    return;
  }
  const parsed = new DOMParser().parseFromString(renderPrintableReport(report), 'text/html');
  document.title = parsed.title;
  for (const style of Array.from(parsed.head.querySelectorAll('style'))) document.head.appendChild(document.importNode(style, true));

  const toolbar = document.createElement('div');
  toolbar.className = 'noprint';
  toolbar.style.cssText = 'position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px 0;background:#fff;border-bottom:1px solid #e7e5e4;margin-bottom:16px;';
  const button = document.createElement('button');
  button.textContent = 'Imprimir o guardar como PDF';
  button.style.cssText = 'font:600 13px system-ui;padding:8px 14px;border-radius:8px;border:0;background:#5546d0;color:#fff;cursor:pointer;';
  button.addEventListener('click', () => window.print());
  toolbar.appendChild(button);

  document.body.replaceChildren(toolbar, ...Array.from(parsed.body.childNodes).map((n) => document.importNode(n, true)));
  setTimeout(() => window.print(), 400);
}

void main();
