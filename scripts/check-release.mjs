#!/usr/bin/env node
/**
 * Verificaciones previas a publicar (criterios de aceptación automatizables):
 *  1. Manifiesto MV3 con permisos mínimos.
 *  2. Sin código remoto ni CDNs en el paquete; sin eval/new Function propios.
 *  3. Sin credenciales en el repositorio ni en el paquete.
 *  4. Sin menciones a integraciones excluidas por la especificación.
 *  5. ZIP distribuible generado.
 * Uso: pnpm check:release
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = resolve(root, 'apps/extension/.output/chrome-mv3');
const outputDir = resolve(root, 'apps/extension/.output');
const problems = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.log(`  ✗ ${msg}`);
  problems.push(msg);
};
const verify = (condition, okMessage, failMessage) => (condition ? ok(okMessage) : fail(failMessage));

const SKIP_DIRS = new Set(['node_modules', '.git', '.wxt', '.wrangler', 'dist', 'coverage', 'test-results', 'playwright-report']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.jsonc', '.md', '.html', '.css', '.yaml', '.yml', '.txt', '.example', '.svg', '']);

function walk(dir, { includeOutput = false } = {}) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || (!includeOutput && name === '.output')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, { includeOutput }));
    else if (TEXT_EXT.has(extname(name)) || name.startsWith('.')) out.push(full);
  }
  return out;
}

// --- 1. Manifiesto ---------------------------------------------------------
console.log('1. Manifiesto');
const manifestPath = join(buildDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('No existe el build. Ejecuta `pnpm build` primero.');
} else {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  verify(m.manifest_version === 3, 'manifest_version 3', 'manifest_version no es 3');
  const allowed = new Set(['activeTab', 'scripting', 'storage', 'sidePanel', 'contextMenus']);
  const extra = (m.permissions ?? []).filter((p) => !allowed.has(p));
  verify(extra.length === 0, `permisos mínimos: ${(m.permissions ?? []).join(', ')}`, `permisos no previstos: ${extra.join(', ')}`);
  const broadHost = (m.host_permissions ?? []).filter((h) => /<all_urls>|\*:\/\/\*|https?:\/\/\*\//.test(h));
  verify(broadHost.length === 0, `host_permissions: ${JSON.stringify(m.host_permissions ?? [])}`, `host_permissions demasiado amplios: ${broadHost.join(', ')}`);
  const optional = m.optional_host_permissions ?? [];
  verify(optional.every((o) => o === 'https://*/*'), 'acceso a sitios solo opcional (https)', `optional_host_permissions inesperados: ${optional.join(', ')}`);
  verify(Boolean(m.side_panel?.default_path), `panel lateral: ${m.side_panel?.default_path}`, 'falta side_panel.default_path');
  verify(!m.content_scripts, 'sin content_scripts persistentes', 'content_scripts declarados (la extensión solo debe inyectar tras una acción del usuario)');
  const csp = JSON.stringify(m.content_security_policy ?? {});
  verify(!/unsafe-eval|unsafe-inline|https?:/.test(csp), 'CSP por defecto de MV3 (sin unsafe-eval)', `CSP debilitada: ${csp}`);
}

// --- 2. Código remoto ---------------------------------------------------------
console.log('2. Código remoto');
if (existsSync(buildDir)) {
  const files = walk(buildDir, { includeOutput: true }).filter((f) => /\.(js|html|css)$/.test(f));
  const cdn = /(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|ajax\.googleapis\.com)/;
  const remoteScript = /<script[^>]+src=["']https?:|importScripts\(\s*["']https?:|import\(\s*["']https?:/;
  let found = false;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    if (cdn.test(text)) {
      fail(`referencia a CDN en ${relative(root, f)}: ${text.match(cdn)[0]}`);
      found = true;
    }
    if (remoteScript.test(text)) {
      fail(`carga de script remoto en ${relative(root, f)}`);
      found = true;
    }
  }
  if (!found) ok(`sin CDNs ni scripts remotos (${files.length} archivos revisados)`);
}
const ownSources = walk(resolve(root, 'apps')).concat(walk(resolve(root, 'packages'))).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/]tests[\\/]/.test(f));
const dynamicCode = ownSources.filter((f) => /\beval\s*\(|new\s+Function\s*\(/.test(readFileSync(f, 'utf8')));
verify(dynamicCode.length === 0, 'sin eval ni new Function en el código propio', `eval/new Function en código propio: ${dynamicCode.map((f) => relative(root, f)).join(', ')}`);

// --- 3. Credenciales -------------------------------------------------------
console.log('3. Credenciales');
const secretPatterns = [
  ['clave de Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['clave de Brave', /\bBSA[A-Za-z0-9_-]{20,}/],
  ['clave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['token asignado en código', /(api[_-]?key|subscription[_-]?token|secret)\s*[:=]\s*["'][A-Za-z0-9_-]{24,}["']/i],
];
const repoFiles = walk(root).filter((f) => !f.includes(`${'scripts'}${process.platform === 'win32' ? '\\' : '/'}check-release.mjs`));
const buildFiles = existsSync(buildDir) ? walk(buildDir, { includeOutput: true }) : [];
let secretHits = 0;
for (const f of [...repoFiles, ...buildFiles]) {
  const text = readFileSync(f, 'utf8');
  for (const [label, re] of secretPatterns) {
    if (re.test(text)) {
      fail(`posible ${label} en ${relative(root, f)}`);
      secretHits += 1;
    }
  }
}
for (const forbidden of ['.env', 'apps/gateway/.dev.vars']) {
  if (existsSync(resolve(root, forbidden))) fail(`archivo de secretos presente: ${forbidden} (no debe publicarse)`);
}
if (!secretHits) ok(`sin credenciales (${repoFiles.length + buildFiles.length} archivos revisados)`);

// --- 4. Integraciones excluidas ---------------------------------------------
console.log('4. Integraciones excluidas');
// Nombres codificados para que esta verificación no los contenga en texto plano.
const excluded = [
  [100, 114, 111, 112, 105],
  [101, 102, 102, 105],
].map((codes) => String.fromCharCode(...codes));
const excludedRe = new RegExp(`\\b(${excluded.join('|')})\\b`, 'i');
const mentions = [...repoFiles, ...buildFiles].filter((f) => excludedRe.test(readFileSync(f, 'utf8')));
verify(mentions.length === 0, 'ninguna mención en código, interfaz ni documentación', `menciones a integraciones excluidas en: ${mentions.map((f) => relative(root, f)).join(', ')}`);

// --- 5. ZIP -----------------------------------------------------------------
console.log('5. Paquete');
const zips = existsSync(outputDir) ? readdirSync(outputDir).filter((f) => f.endsWith('-chrome.zip')) : [];
verify(zips.length, `ZIP listo: apps/extension/.output/${zips.join(', ')}`, 'No se encontró el ZIP. Ejecuta `pnpm zip`.');

if (problems.length) {
  console.error(`\n${problems.length} problema(s) encontrados.`);
  process.exit(1);
}
console.log('\nListo para publicar (revisa también docs/publishing.md).');
