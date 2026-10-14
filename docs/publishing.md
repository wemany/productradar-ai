# Publicación

## 1. Hackatón / pruebas técnicas

```bash
pnpm install
pnpm verify          # typecheck, lint, pruebas, build, zip y verificación de publicación
```

Comparte el repositorio y el ZIP `apps/extension/.output/productradar-ai-0.1.0-chrome.zip`. Los participantes técnicos lo descomprimen y lo cargan con **«Cargar descomprimida»** en `chrome://extensions`, o cargan directamente la carpeta `apps/extension/.output/chrome-mv3`.

## 2. Desplegar el gateway (necesario para búsquedas reales sin claves en el cliente)

1. Cuenta de Cloudflare → `cd apps/gateway`.
2. `npx wrangler secret put BRAVE_API_KEY` y `npx wrangler secret put ANTHROPIC_API_KEY` (y, opcionalmente, `ACCESS_CODE`).
3. Recomendado: `npx wrangler kv namespace create USAGE_KV` y descomenta `kv_namespaces` en `wrangler.jsonc` para activar el presupuesto diario.
4. Configura **alertas de gasto** en Brave y en Anthropic.
5. `pnpm gateway:deploy`.
6. Cuando conozcas el ID definitivo de la extensión (ver paso 3.4), pon `ALLOWED_ORIGINS = "chrome-extension://<id>"` y vuelve a desplegar.

## 3. Chrome Web Store

1. **Cuenta de desarrollador**: regístrate en el [panel de Chrome Web Store](https://chrome.google.com/webstore/devconsole) (pago único de registro; verifica el monto vigente) y completa la verificación de identidad.
2. **Compila con la URL del gateway**:
   ```bash
   WXT_GATEWAY_URL=https://productradar-gateway.<cuenta>.workers.dev pnpm build && pnpm zip && pnpm check:release
   ```
   La URL del gateway entra en `host_permissions`, limitada a ese dominio.
3. **Sube el ZIP** y completa la ficha:
   - **Propósito único**: «Investigar la viabilidad de vender un producto: identificarlo, comparar precios públicos con fuentes y estimar el margen de contribución».
   - **Justificación de permisos**: copia la tabla de [privacy.md](privacy.md#permisos-de-chrome-y-por-qué-se-necesitan).
   - **Código remoto**: «No, todo el código está incluido en el paquete».
   - **Uso de datos**: declara «contenido del sitio web» (metadatos públicos del producto) e «imágenes» (solo si el usuario sube una foto). Declara que los datos no se venden ni se usan para publicidad o crédito, y que solo se transfieren a terceros para la funcionalidad principal (Brave Search y Anthropic, vía tu gateway).
   - **Política de privacidad**: publica [privacy.md](privacy.md) en una URL pública (por ejemplo, GitHub Pages) con tus datos de contacto.
   - **Recursos gráficos**: ícono 128 px (`apps/extension/public/icons/128.png`), mosaico 440×280 (`docs/store/promo-440x280.png`) y capturas de 1280×800 o 640×400 (puedes generarlas a partir de `docs/screenshots/`). Las capturas de la demo deben mostrar la franja «DATOS DE DEMOSTRACIÓN».
4. **ID definitivo**: tras la primera carga, el panel muestra el ID de la extensión. Actualiza `ALLOWED_ORIGINS` del gateway con ese ID.
5. **Revisión**: no supongas aprobación inmediata; puede tardar desde días hasta semanas, y los permisos opcionales amplios (`https://*/*`) pueden requerir justificación adicional.
6. **Nombre**: «ProductRadar AI» es provisional. Revisa marcas registradas y otras extensiones antes de publicar.

## 4. Versiones

- Sube `version` en `apps/extension/package.json` (WXT la copia al manifiesto) y en el `package.json` raíz.
- `pnpm verify && pnpm zip` → sube el nuevo ZIP en el panel.
- Si cambias el esquema de `ResearchReport`, incrementa `REPORT_SCHEMA_VERSION` y añade la migración en `migrateReport` (`packages/core/src/report.ts`).

## 5. Microsoft Edge (opcional, sin probar)

`pnpm build:edge && pnpm zip:edge` genera la variante para Edge (que también admite el panel lateral MV3). Pruébala manualmente antes de publicarla en Edge Add-ons.
