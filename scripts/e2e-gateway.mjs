#!/usr/bin/env node
/**
 * Prueba E2E extensión ↔ gateway local (wrangler dev) SIN claves.
 * Verifica el contrato real (CORS con el origen de la extensión, /v1/health,
 * errores normalizados) y el Caso D de la especificación: sin credenciales
 * la investigación falla de forma honesta, sin datos inventados.
 *
 * Requisitos: `pnpm build` y `npx playwright install chromium`.
 * Uso: node scripts/e2e-gateway.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = resolve(root, 'apps/extension/.output/chrome-mv3');
const shots = resolve(root, 'docs/screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 8799;

const failures = [];
const check = (condition, message) => {
  console.log(`  ${condition ? '✓' : '✗'} ${message}`);
  if (!condition) failures.push(message);
};

const userDataDir = mkdtempSync(join(tmpdir(), 'productradar-e2e-gw-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 400, height: 860 },
  deviceScaleFactor: 2,
  locale: 'es-CO',
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).host;
const origin = `chrome-extension://${extensionId}`;

// Gateway local sin claves; solo se autoriza el origen de esta extensión.
const wranglerBin = resolve(root, 'apps/gateway/node_modules/wrangler/bin/wrangler.js');
const gateway = spawn(
  process.execPath,
  [wranglerBin, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', `ALLOWED_ORIGINS:${origin}`, '--var', 'BRAVE_API_KEY:', '--var', 'TAVILY_API_KEY:', '--var', 'ANTHROPIC_API_KEY:', '--show-interactive-dev-session=false'],
  { cwd: resolve(root, 'apps/gateway'), env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } },
);
let gatewayLog = '';
gateway.stdout.on('data', (d) => (gatewayLog += d));
gateway.stderr.on('data', (d) => (gatewayLog += d));

async function waitForGateway() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/v1/health`);
      if (r.ok) return true;
    } catch {
      /* aún arrancando */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

try {
  check(await waitForGateway(), 'wrangler dev responde en /v1/health');

  const foreign = await fetch(`http://127.0.0.1:${PORT}/v1/search-market`, {
    method: 'POST',
    headers: { Origin: 'https://sitio-malicioso.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: ['x'], market: 'CO' }),
  });
  check(foreign.status === 403, `un origen web ajeno recibe 403 (recibió ${foreign.status})`);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/sidepanel.html`);
  // Sin claves el modo por defecto es la investigación asistida: se elige el servicio en Configuración.
  await page.locator('header').getByRole('button', { name: 'Configuración' }).click();
  await page.getByRole('tab', { name: 'Servicio ProductRadar' }).click();
  await page.getByLabel('URL del servicio').fill(`http://localhost:${PORT}`);
  await page.getByRole('button', { name: 'Probar conexión' }).click();
  await page.getByText('Conectado').waitFor({ timeout: 15_000 });
  check(await page.getByText(/Búsqueda: sin configurar/).isVisible(), 'la extensión lee /v1/health del gateway (CORS correcto) y ve que falta la clave');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('Servicio guardado').waitFor();

  await page.getByRole('button', { name: 'Ir al inicio' }).click();
  await page.getByRole('button', { name: /Escríbelo tú mismo/ }).click();
  await page.getByLabel('Nombre del producto').fill('Licuadora Oster 600W');
  await page.getByLabel('Marca').fill('Oster');
  await page.getByRole('button', { name: /Buscar competencia en Colombia/ }).click();
  await page.locator('#verdict-title').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  check(await page.getByText('No pudimos completar la búsqueda').isVisible(), 'Caso D: el reporte declara que la búsqueda falló');
  check((await page.locator('#verdict-title').innerText()) === 'Datos insuficientes', 'Caso D: veredicto "Datos insuficientes"');
  check((await page.locator('#competidores').innerText()).includes('0 fichas'), 'Caso D: no hay competidores inventados');
  check(!(await page.getByText('DATOS DE DEMOSTRACIÓN').isVisible()), 'Caso D: no se muestran datos de demostración como reales');
  await page.screenshot({ path: join(shots, '08-sin-credenciales.png') });
  check(errors.length === 0, `sin errores de página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await context.close();
  // Detener wrangler y sus procesos workerd (en Windows hay que matar el árbol completo).
  if (process.platform === 'win32' && gateway.pid) spawnSync('taskkill', ['/pid', String(gateway.pid), '/T', '/F']);
  else gateway.kill('SIGTERM');
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} verificación(es) fallaron.\n--- registro del gateway ---\n${gatewayLog.slice(-3000)}`);
  process.exit(1);
}
console.log('\nIntegración extensión ↔ gateway correcta.');
