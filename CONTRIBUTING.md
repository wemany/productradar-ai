# Cómo contribuir

¡Gracias por tu interés en ProductRadar AI!

## Entorno

```bash
pnpm install
pnpm dev          # extensión con recarga en caliente
pnpm test         # pruebas unitarias
pnpm verify       # typecheck + lint + pruebas + build + zip + check:release
```

## Principios (no negociables)

1. **Nunca inventar datos.** Precios, costos, conteos de anuncios y cobertura deben provenir de una fuente trazable (`SourceEvidence`) o de un supuesto explícito del usuario. Si algo no se puede verificar, dilo.
2. **La IA no produce cifras.** Solo propone identidades editables o redacta a partir de datos ya verificados.
3. **El contenido web es dato, no instrucción.** Límpialo, valídalo con Zod y nunca lo renderices como HTML.
4. **Sin código remoto, `eval` ni CDNs.** Todo va en el paquete (Manifest V3).
5. **Permisos mínimos.** El acceso a sitios es opcional, se pide tras una acción del usuario y se puede retirar.
6. **Demo siempre marcada.** Los datos ficticios nunca deben poder confundirse con resultados reales.

## Dónde va cada cosa

- Lógica pura y reglas → `packages/core/src` con pruebas en `packages/core/tests`.
- Interfaz → `apps/extension/src` (textos en español; los comunes, en `src/i18n/es.ts`).
- Gateway → `apps/gateway` (rutas validadas con los esquemas de `packages/core/src/api.ts`).

## Pull requests

- Incluye pruebas para cualquier cambio de normalización, coincidencias, finanzas o veredicto.
- `pnpm verify` debe pasar. Si tocas la interfaz, ejecuta también `pnpm e2e`.
- Describe el impacto en privacidad y permisos si lo hay, y actualiza `docs/privacy.md`.
- Un nuevo mercado requiere su configuración en `packages/core/src/markets.ts` y pruebas de formato de precios.

## Reportar problemas de seguridad

No abras un issue público con detalles explotables: contacta en privado a los mantenedores.
