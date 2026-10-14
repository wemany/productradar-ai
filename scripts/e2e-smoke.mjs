#!/usr/bin/env node
/**
 * Prueba de humo E2E: carga la extensión compilada en Chromium (Playwright),
 * abre el panel como pestaña y recorre el flujo de DEMOSTRACIÓN completo.
 * Verifica invariantes clave y guarda capturas en docs/screenshots/.
 *
 * Requisitos: `pnpm build` y `npx playwright install chromium`.
 * Uso: pnpm e2e  (añade --headed para ver el navegador)
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const shots = resolve(root, 'docs/screenshots');
mkdirSync(shots, { recursive: true });
const headed = process.argv.includes('--headed');

const failures = [];
const check = (condition, message) => {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}`);
    failures.push(message);
  }
};

const userDataDir = mkdtempSync(join(tmpdir(), 'productradar-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !headed,
  viewport: { width: 400, height: 860 },
  deviceScaleFactor: 2,
  locale: 'es-CO',
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

try {
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  console.log(`Extensión cargada: ${extensionId}`);
  const behavior = await worker.evaluate(async () => {
    for (let i = 0; i < 20; i += 1) {
      const b = await chrome.sidePanel.getPanelBehavior();
      if (b.openPanelOnActionClick) return b;
      await new Promise((r) => setTimeout(r, 100));
    }
    return chrome.sidePanel.getPanelBehavior();
  });
  check(behavior.openPanelOnActionClick === true, 'al pulsar el ícono se abre el panel lateral (openPanelOnActionClick)');

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.getByRole('heading', { name: /Vale la pena/ }).waitFor();
  await page.waitForTimeout(400);
  console.log('Inicio');
  check(await page.getByText('Configuración pendiente').isVisible(), 'sin servicio configurado se muestra la pantalla de configuración');
  check(!(await page.getByText('DATOS DE DEMOSTRACIÓN').isVisible()), 'fuera de la demo no aparece la marca de demostración');
  await page.screenshot({ path: join(shots, '01-inicio.png') });

  console.log('Demo: confirmación');
  await page.getByRole('button', { name: 'Abrir demostración (datos ficticios)' }).first().click();
  await page.getByText('Confirma que encontramos el producto correcto').waitFor();
  await page.waitForTimeout(600);
  check(await page.getByText('DATOS DE DEMOSTRACIÓN').isVisible(), 'la marca DATOS DE DEMOSTRACIÓN es visible');
  check((await page.getByLabel('Nombre del producto').inputValue()).includes('DemoSonic'), 'el nombre es editable y viene del fixture');
  await page.screenshot({ path: join(shots, '02-confirmacion.png') });

  console.log('Demo: progreso');
  await page.getByRole('button', { name: /Buscar competencia en Colombia/ }).click();
  await page.getByText('Investigando', { exact: true }).waitFor();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(shots, '03-progreso.png') });

  console.log('Demo: reporte');
  await page.locator('#verdict-title').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const verdict = await page.locator('#verdict-title').innerText();
  check(verdict === 'Interesante para probar', `veredicto de la demo = "${verdict}"`);
  check(await page.getByText('DATOS DE DEMOSTRACIÓN').isVisible(), 'la marca de demo persiste en el reporte');
  check(await page.locator('#publicidad').getByText(/no verificable/).first().isVisible(), 'los conteos de anuncios se declaran no verificables');
  check(await page.getByText('Tiendas encontradas en la muestra').first().isVisible(), 'se habla de "muestra", no de todo el país');
  check((await page.locator('#mercado').innerText()).includes('$ 104.900 COP'), 'mediana verificada = $ 104.900 COP (la tienda bloqueada no la altera)');
  check(await page.getByText('El sitio bloqueó la lectura automática (HTTP 403)').isVisible(), 'la tienda bloqueada aparece como no verificable');
  check((await page.locator('#calculadora').innerText()).includes('$ 30.000 COP'), 'la calculadora muestra la contribución de $ 30.000 COP');
  await page.screenshot({ path: join(shots, '04-reporte.png') });
  await page.screenshot({ path: join(shots, '04-reporte-completo.png'), fullPage: true });

  console.log('Edición de supuestos');
  await page.getByLabel('CPA (publicidad por pedido)').fill('60000');
  await page.getByLabel('CPA (publicidad por pedido)').blur();
  await page.waitForTimeout(300);
  check((await page.locator('#verdict-title').innerText()) === 'No recomendable bajo estos supuestos', 'con CPA $ 60.000 el veredicto cambia a "No recomendable"');
  await page.locator('#calculadora').screenshot({ path: join(shots, '05-calculadora.png') });

  console.log('Corrección manual de coincidencias');
  const before = await page.locator('#mercado').innerText();
  await page.getByRole('button', { name: /Excluir de comparación/ }).first().click();
  await page.waitForTimeout(300);
  check((await page.locator('#mercado').innerText()) !== before, 'excluir una oferta recalcula las estadísticas');

  console.log('Vista imprimible');
  const reportId = await page.evaluate(async () => {
    const data = await chrome.storage.local.get('history:index:v1');
    return data['history:index:v1']?.[0]?.id;
  });
  check(Boolean(reportId), 'el reporte se guardó en el historial local');
  const print = await context.newPage();
  await print.addInitScript(() => {
    window.print = () => undefined;
  });
  await print.goto(`chrome-extension://${extensionId}/print.html?id=${reportId}`);
  await print.getByText('DATOS DE DEMOSTRACIÓN — FICTICIOS').first().waitFor();
  check(await print.getByText('Tiendas encontradas en la muestra').isVisible(), 'la vista imprimible carga el reporte');
  await print.setViewportSize({ width: 900, height: 1100 });
  await print.screenshot({ path: join(shots, '07-imprimible.png') });
  await print.close();

  console.log('Configuración e historial');
  await page.getByRole('button', { name: 'Configuración' }).click();
  await page.getByRole('heading', { name: 'Configuración' }).waitFor();
  await page.screenshot({ path: join(shots, '06-configuracion.png') });
  await page.getByRole('button', { name: 'Mis investigaciones' }).click();
  await page.getByRole('heading', { name: 'Mis investigaciones' }).waitFor();
  check(await page.getByText('Demo ficticia').first().isVisible(), 'el historial marca la investigación como demo');
  await page.getByRole('button', { name: 'Borrar todo' }).click();
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.getByText('Aún no hay investigaciones guardadas.').waitFor();
  check(true, 'el historial local se puede borrar');

  const relevantErrors = errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND/.test(e));
  check(relevantErrors.length === 0, `sin errores de consola${relevantErrors.length ? `: ${relevantErrors.join(' | ')}` : ''}`);
} finally {
  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} verificación(es) fallaron.`);
  process.exit(1);
}
console.log(`\nTodo correcto. Capturas en ${shots}`);
