# Guion de demostración (2–3 minutos)

## Preparación (antes de presentar)

```bash
pnpm install && pnpm build
```

Carga `apps/extension/.output/chrome-mv3` en `chrome://extensions` (modo desarrollador → «Cargar descomprimida») y fija el ícono.

Para la parte **real** con búsqueda automática (opcional), configura una clave gratuita de Tavily (⚙ Configuración → «Claves propias» → Buscador: Tavily) o el gateway, y ten abierta la ficha pública de un producto con marca y modelo conocidos en una tienda colombiana.

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

**1:45 — Caso real (45 s, si hay claves).** En la ficha real: clic en el ícono → **Analizar esta página** → confirma → Buscar. Chrome pide permiso **una vez** para leer las fichas públicas encontradas. Muestra enlaces reales con fecha de observación y, en Publicidad, las menciones públicas en redes (recalca que no son anuncios). Introduce tu costo y tu CPA. Sin claves, usa el guion de investigación asistida (abajo).

**2:30 — Cierre (15 s).** Exporta CSV, JSON o PDF. Es código abierto (MIT), no requiere cuenta y no incluye claves: la búsqueda y la IA pasan por un gateway que puedes alojar tú.

## Guion real sin claves: investigación asistida (2–3 minutos)

Datos **reales**, sin gateway ni claves: compila sin `WXT_GATEWAY_URL` o elige ⚙ Configuración → «Investigación asistida» → **Guardar**. Las fichas, los precios y su estructura cambian a menudo: **ensaya el guion en vivo el mismo día** y ten a mano otra tienda u otro producto por si una ficha cambió. Lo que sigue describe lo observado el 14 de octubre de 2026.

**0:00 — Producto (20 s).** Abre el panel → «¿Ya sabes qué producto es? Escríbelo tú mismo»: nombre «Audífonos Sony WH-1000XM5», marca Sony, modelo WH-1000XM5. País: Colombia → **«Buscar en tiendas de Colombia»**.

**0:20 — Reporte honesto desde el inicio (20 s).** El reporte nace «Parcial», sin ofertas y con veredicto «Datos insuficientes»: no se inventa nada. Señala la tarjeta **«Agregar competidores»** con 8 enlaces a búsquedas públicas. La extensión no descarga esas páginas: solo las abre en una pestaña nueva.

**0:40 — Permiso acotado (15 s).** Pulsa **«Permitir lectura en estas tiendas»**. Chrome pide solo los dominios de esas tiendas, no «todos los sitios». Es opcional: sin él, se usa el clic derecho en la ficha → *Agregar esta ficha a la investigación abierta*.

**0:55 — Precios verificados (45 s).** Abre **Alkosto**, entra a la ficha de los audífonos, vuelve al panel → **«Agregar esta ficha»**: «Agregada: … (precio verificado en la ficha)». Alkosto publica precio y moneda (COP) como microdatos. Repite con **Ktronix**. El contador queda en «2 fichas agregadas · 2 con precio verificado» y, si ambas son «mismo producto», el mercado muestra mínimo, mediana y máximo.

**1:40 — Varios precios en una ficha (25 s).** Agrega la ficha de **Falabella**: publica dos precios del mismo artículo (el de oferta y el normal, que la página muestra tachado). Se verifica el de oferta, con la nota «Precio más bajo publicado en la ficha (varios vendedores u oferta)», y el contador sube a 3 con precio verificado. La de **Éxito** lista una oferta por vendedor: se toma el precio más bajo entre las disponibles, pero su nombre no menciona el modelo y queda como «variante»; si es el mismo producto, usa «Marcar coincidencia exacta». Una ficha con variantes reales (tallas, capacidades) cuyo precio no se pueda atar al producto sigue sin verificar: preferimos «sin verificar» a adivinar.

**2:05 — Supuestos (30 s).** En la calculadora, introduce tu precio de venta y tu costo, y luego el CPA. Sin CPA, el veredicto llega como mucho a «Precaución»; el CPA de equilibrio indica cuánto podrías pagar en publicidad por venta. La confianza de la evidencia es independiente: con 2 o 3 precios verificados del mismo producto en otros tantos dominios es «media» (la «alta» pide al menos 4 en 3 dominios). Recalca que es margen de contribución, no utilidad neta.

**2:35 — Cierre (15 s).** Sin claves, sin cuentas y sin servidores: el reporte se creó y se guarda solo en tu navegador. Para búsqueda automática basta una clave gratuita de Tavily en ⚙. Exporta CSV, JSON o PDF.

Si una tienda no tiene el producto o cambió su ficha, usa otra del mismo modelo o cambia de producto. Las fichas de Mercado Libre y Olímpica no se pudieron comprobar de forma automática: pruébalas antes de incluirlas en la demo.

## Qué decir si preguntan

- **¿Por qué no busca sola sin claves?** Porque no encontramos una fuente gratuita que respete las reglas de las tiendas: la API pública de Mercado Libre ahora exige OAuth, la de catálogo de Éxito está vetada en su `robots.txt` y descargar páginas de resultados de buscadores o tiendas va contra sus términos. Ver [limitations.md](limitations.md).
- **¿Escanean todas las tiendas?** No: es una muestra de un buscador oficial, y así se rotula. En investigación asistida, la muestra son las fichas que agregas tú.
- **¿Cuántos anuncios tiene la competencia?** No hay una fuente pública confiable para contarlos (para Colombia, la API de Meta solo expone anuncios políticos o de temas sociales); enlazamos la biblioteca oficial y, con buscador, mostramos menciones públicas en redes, que no son anuncios.
- **¿Es rentable?** Mostramos el margen de contribución con **tus** supuestos. No prometemos ventas.

## Fixtures de demostración

`fixtures/explicitly-demo-data.json` se genera con `pnpm demo-fixture` (`scripts/generate-demo-fixture.mjs`). Contiene:

- Producto ficticio «DemoSonic Aura X2» (GTIN de circulación restringida, prefijo 200).
- 11 resultados de búsqueda en dominios reservados `.example` (RFC 2606): 3 fichas verificables (JSON-LD, `@graph` con precio en texto y Open Graph), 1 tienda que responde 403, 1 pack x2, 1 reacondicionado, 1 genérico, 1 blog y 1 listado (descartados), 1 tienda en USD y 1 ficha con precio sin moneda.
- 3 referencias de «proveedores ficticios» que enlazan a búsquedas reales de Alibaba.
- Supuestos financieros ilustrativos de la especificación (contribución de $ 30.000).

Los datos de demo pasan por el **mismo pipeline real** (búsqueda → verificación → coincidencias → estadísticas → veredicto) mediante proveedores de demostración, y el reporte queda marcado con `isDemo: true` en la interfaz, el historial y todas las exportaciones. **El modo demo no cuenta como validación de búsquedas reales.**
