#!/usr/bin/env node
/**
 * Genera los íconos PNG de la extensión a partir de un SVG (marca de radar).
 * Uso: pnpm icons
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = resolve(root, 'apps/extension/public/icons');
const storeDir = resolve(root, 'docs/store');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(storeDir, { recursive: true });

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#a99ff5" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#a99ff5" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="c"><circle cx="64" cy="64" r="44"/></clipPath>
  </defs>
  <rect width="128" height="128" rx="30" fill="#1c1917"/>
  <g clip-path="url(#c)">
    <path d="M64 64 L64 20 A44 44 0 0 1 102.1 42 Z" fill="url(#g)"/>
  </g>
  <circle cx="64" cy="64" r="44" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="4"/>
  <circle cx="64" cy="64" r="27" fill="none" stroke="#ffffff" stroke-opacity="0.34" stroke-width="4"/>
  <circle cx="64" cy="64" r="9" fill="#ffffff"/>
  <circle cx="90" cy="40" r="7.5" fill="#a99ff5"/>
</svg>`;

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(ICON_SVG, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(iconsDir, `${size}.png`), png);
}
writeFileSync(resolve(storeDir, 'icon.svg'), ICON_SVG);

// Mosaico promocional pequeño para Chrome Web Store (440×280).
const PROMO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 280">
  <rect width="440" height="280" fill="#f7f5f1"/>
  <g transform="translate(30 76)">${ICON_SVG.replace(/<\/?svg[^>]*>/g, '')}</g>
  <text x="180" y="128" font-family="Georgia, serif" font-size="27" fill="#1c1917">ProductRadar AI</text>
  <text x="180" y="158" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="#6f6964">¿Vale la pena venderlo?</text>
  <text x="180" y="182" font-family="Segoe UI, Arial, sans-serif" font-size="12.5" fill="#5546d0">Precios con fuente · Alibaba · Margen</text>
</svg>`;
writeFileSync(resolve(storeDir, 'promo-440x280.png'), new Resvg(PROMO_SVG, { fitTo: { mode: 'width', value: 440 }, font: { loadSystemFonts: true } }).render().asPng());

console.log(`Íconos generados en ${iconsDir}`);
