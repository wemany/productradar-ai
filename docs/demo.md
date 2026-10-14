# Guion de demostración (2–3 minutos)

## Preparación (antes de presentar)

```bash
pnpm install && pnpm build
```

Carga `apps/extension/.output/chrome-mv3` en `chrome://extensions` (modo desarrollador → «Cargar descomprimida») y fija el ícono.

Para la parte **real** (opcional), configura el gateway o tus claves de desarrollo en ⚙ Configuración y ten abierta la ficha pública de un producto con marca y modelo conocidos en una tienda colombiana.

## Guion

**0:00 — El problema (15 s).** «Encontré este producto. ¿Ya lo venden en Colombia? ¿A cuánto? ¿Me deja margen?». Hoy eso se responde con 20 pestañas y una hoja de cálculo.

**0:15 — Demostración segura (60 s).** Abre el panel → **«Abrir demostración (datos ficticios)»**.
- Señala la franja **DATOS DE DEMOSTRACIÓN**: todo lo que sigue es ficticio (marca DemoSonic, tiendas `.example`).
- Pantalla de confirmación: el usuario **corrige** nombre, marca, modelo, GTIN y atributos antes de buscar.
- **Buscar competencia en Colombia**: progreso por etapas y hallazgos parciales en vivo.
- Reporte:
  - Veredicto «Interesante para probar» con **confianza media**, con razones explícitas.
  - Mercado: la mediana verificada ($ 104.900) se calcula **solo** con precios leídos en la ficha. La tienda que bloqueó la lectura (HTTP 403) aparece como **«Visible solo en buscador»** y **no** altera la mediana.
  - Competidores: el «Pack x2» y el «Reacondicionado» salen como **variante distinta**; el genérico, como **producto parecido**; la tienda en USD, como **vendedor internacional**.
  - Alibaba: rangos y MOQ con el aviso «no son costos puestos en Colombia».
  - Publicidad: «Anuncios activos: **no verificable**» y enlace a Meta Ads Library.

**1:15 — Supuestos editables (30 s).** En la calculadora, sube el CPA a 60.000: el veredicto cambia a **«No recomendable bajo estos supuestos»** y explica el CPA de equilibrio ($ 45.000). Excluye una oferta y las estadísticas se recalculan.

**1:45 — Caso real (45 s, si hay claves).** En la ficha real: clic en el ícono → **Analizar esta página** → confirma → Buscar. Chrome pide permiso **una vez** para leer las fichas públicas encontradas. Muestra enlaces reales con fecha de observación. Introduce tu costo y tu CPA.

**2:30 — Cierre (15 s).** Exporta CSV, JSON o PDF. Es código abierto (MIT), no requiere cuenta y no incluye claves: la búsqueda y la IA pasan por un gateway que puedes alojar tú.

## Qué decir si preguntan

- **¿Escanean todas las tiendas?** No: es una muestra de un buscador oficial, y así se rotula.
- **¿Cuántos anuncios tiene la competencia?** No hay una fuente pública confiable para contarlos; enlazamos la biblioteca oficial.
- **¿Es rentable?** Mostramos el margen de contribución con **tus** supuestos. No prometemos ventas.

## Fixtures de demostración

`fixtures/explicitly-demo-data.json` se genera con `pnpm demo-fixture` (`scripts/generate-demo-fixture.mjs`). Contiene:

- Producto ficticio «DemoSonic Aura X2» (GTIN de circulación restringida, prefijo 200).
- 11 resultados de búsqueda en dominios reservados `.example` (RFC 2606): 3 fichas verificables (JSON-LD, `@graph` con precio en texto y Open Graph), 1 tienda que responde 403, 1 pack x2, 1 reacondicionado, 1 genérico, 1 blog y 1 listado (descartados), 1 tienda en USD y 1 ficha con precio sin moneda.
- 3 referencias de «proveedores ficticios» que enlazan a búsquedas reales de Alibaba.
- Supuestos financieros ilustrativos de la especificación (contribución de $ 30.000).

Los datos de demo pasan por el **mismo pipeline real** (búsqueda → verificación → coincidencias → estadísticas → veredicto) mediante proveedores de demostración, y el reporte queda marcado con `isDemo: true` en la interfaz, el historial y todas las exportaciones. **El modo demo no cuenta como validación de búsquedas reales.**
