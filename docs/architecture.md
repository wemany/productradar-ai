# Arquitectura

ProductRadar AI tiene **una sola interfaz pública**: la extensión de Chrome. El gateway es infraestructura opcional e invisible, y puede alojarlo cada quien.

```text
              USUARIO (CHROME)
                      │
         ┌────────────────────────────┐
         │ EXTENSIÓN (panel lateral)  │
         │  · pestaña / URL / foto    │
         │  · confirmación editable   │
         │  · orquestación (core)     │
         │  · lectura de fichas con   │──── fetch con permiso del usuario,
         │    permiso, sin cookies    │     sin cookies → tiendas públicas
         │  · cálculo local de margen │
         │  · historial local         │
         └─────────────┬──────────────┘
                       │ HTTPS (JSON validado con Zod)
         ┌─────────────▼──────────────┐
         │ GATEWAY (Cloudflare Worker)│
         │  · /v1/search-market       │── Tavily o Brave Search API
         │    (+ menciones en redes)  │   (SEARCH_PROVIDER)
         │  · /v1/search-alibaba      │── Tavily o Brave (solo alibaba.com)
         │  · /v1/identify-image      │── Anthropic Claude (visión)
         │  · CORS, límites, cuotas,  │
         │    código de acceso, caché │
         └────────────────────────────┘
```

En «Claves propias» no hay gateway: la extensión llama directamente al buscador elegido (Tavily o Brave) y, para fotos, a Anthropic, con las claves guardadas en el navegador. En investigación asistida no hay llamadas de red (ver más abajo).

**Decisión clave:** el gateway **no lee páginas de terceros**. La verificación de precios la hace la extensión desde el navegador del usuario, con permisos opcionales sitio por sitio. Así el Worker no puede usarse como proxy abierto ni sufrir SSRF, y las tiendas ven una lectura normal de una página pública, sin cookies.

## Paquetes

| Paquete | Responsabilidad |
| --- | --- |
| `packages/core` | Lógica pura y testeable: esquemas Zod (`schemas.ts`), mercados, normalización de precios (`money.ts`), URLs y protección SSRF (`url.ts`), atributos duros (`attributes.ts`), coincidencias (`matching.ts`), estadísticas (`pricing.ts`), finanzas (`finance.ts`), veredicto y confianza (`verdict.ts`), extracción JSON-LD, Open Graph y microdatos (`extract.ts`), resultados de búsqueda (`search-results.ts`), verificación (`verify.ts`), Alibaba, anuncios, orquestador (`research.ts`), investigación asistida (`assisted.ts`), exportaciones, contrato del gateway (`api.ts`), proveedores (`providers/`) y demo. |
| `apps/extension` | WXT + React. `background.ts` (panel, menú contextual, atajo), `sidepanel/` (interfaz), `print/` (vista imprimible), servicios (lectura de pestaña, fetcher, permisos, historial, ajustes, imagen, exportación). |
| `apps/gateway` | Worker con rutas validadas, CORS, código de acceso, límites por IP e instalación, presupuesto diario en KV y caché de búsquedas. Usa Tavily o Brave según `SEARCH_PROVIDER` (sin valor: Tavily si tiene su clave; si no, Brave). Un buscador elegido sin clave no cambia al otro: `/v1/health` informa `search: false` y las búsquedas responden 503. `/v1/health` también devuelve `searchProvider`. Detalles en [apps/gateway/README.md](../apps/gateway/README.md). |

## Flujo de una investigación (`runResearch`)

1. **Identificación**: la identidad confirmada por el usuario (nunca se busca sin confirmación).
2. **Búsqueda**: 3–6 consultas (`buildMarketQueries`) que incluyen el país (con Tavily, además, el parámetro `country`, que solo prioriza); los resultados se deduplican por URL canónica. Se descartan redes sociales, blogs, listados y páginas de inicio (`classifyResultUrl`). El precio del fragmento o de los datos estructurados del buscador queda como `SEARCH_SNIPPET_ONLY`.
3. **Verificación**: hasta N fichas candidatas (no las «no relacionadas»). Se pide permiso de lectura una vez; se lee el HTML (máx. 2,5 MB, 12 s, sin cookies) y se extraen JSON-LD (incluido `@graph`, `ProductGroup`, `AggregateOffer`, `priceSpecification`), Open Graph y microdatos. Si hay precio estructurado con moneda ISO, pasa a `PAGE_VERIFIED`; si la página bloquea, falla o no publica precio, se registra el motivo. Si la ficha publica varios precios (variantes o un rango `AggregateOffer`), solo se verifica la oferta atada a la identidad por GTIN, SKU o nombre; si no se puede atar, el precio **no** entra en la estadística (`resolveOffer`). Excepción: varias ofertas del mismo artículo sin señales de variante (una por vendedor en una ficha con SKU o GTIN, dos idénticas salvo el precio normal y el de oferta, o un `AggregateOffer` con `offerCount` > 1 y GTIN) se verifican con el precio actual más bajo entre las disponibles y la nota «Precio más bajo publicado en la ficha (varios vendedores u oferta)». Los precios de lista o tachados de `priceSpecification` nunca se usan como precio. La URL que se lee conserva el host original (`cleanUrl`); la versión sin `www` (`canonicalizeUrl`) solo sirve para deduplicar.
4. **Alibaba**: búsqueda restringida a alibaba.com (`include_domains` con Tavily, `site:alibaba.com` con Brave); se extraen rango de precio (USD), MOQ e incoterm; se compara contra la descripción genérica (sin marca).
5. **Publicidad**: enlaces a Meta Ads Library (país + término) y al Centro de transparencia de Google; conteos en `null`. Además, una consulta de **menciones públicas** (`socialMentionQuery`: `"marca modelo"` o el nombre) restringida a facebook.com, instagram.com y tiktok.com (`SOCIAL_MENTION_DOMAINS`; con Brave, operadores `site:`). Hasta 8 resultados quedan como evidencia `SEARCH_API` / `SEARCH_SNIPPET_ONLY` (`resultsToSocialEvidence`) y en «Evidencias» la consulta se rotula [redes]. Una mención no es un anuncio: los conteos siguen en `null`. No se ejecuta en la demo, en investigación asistida ni si fallaron todas las búsquedas de mercado; si falla, el módulo queda `OK` con el aviso y el reporte no cambia.
6. **Análisis**: veredicto, confianza y riesgos (`recomputeReport`), que se recalculan con cada edición del usuario.

Cada módulo tiene estado (`PENDING/RUNNING/OK/PARTIAL/FAILED/SKIPPED`): un fallo de Alibaba o de una tienda deja el reporte **parcial**, no lo invalida. La cancelación conserva los resultados reales obtenidos hasta ese momento.

## Investigación asistida (modo sin claves)

Sin gateway ni claves no se ejecuta `runResearch`: no hay buscador ni llamadas de red. Todo está en `packages/core/src/assisted.ts`:

- `createAssistedReport` crea el reporte vacío y local, con `mode: 'assisted'`, estado `PARTIAL` y `searchProvider` «Investigación asistida (fichas agregadas por ti)». Módulos: identificación `OK`; búsqueda `SKIPPED` («Búsqueda automática no configurada…»); verificación `OK` con «N fichas agregadas, M con precio verificado»; Alibaba `SKIPPED`; publicidad `OK` (solo enlaces); análisis `OK`. El veredicto inicial es `INSUFFICIENT_DATA`.
- `buildStoreSearchLinks` arma, a partir de marca y modelo (o del nombre), los enlaces a la búsqueda pública de cada tienda del mercado y el origen de permiso de cada una. Los de Colombia se comprobaron el 2026-10-14; los de México, Perú y Chile no. `buildAlibabaSearchUrl` hace lo mismo para Alibaba.
- `offerFromSnapshot` convierte la ficha leída en una oferta. Rechaza Alibaba, listados, páginas de inicio y URLs inseguras (`classifyResultUrl`); si la ficha no tiene `og:title`, usa el `h1` como nombre, y aplica la misma regla de precio que la verificación automática (`applySnapshotToOffer` → `resolveOffer`). Nunca inventa precios.
- `addOfferToReport` agrega la oferta o reemplaza la de la misma URL canónica (conserva la decisión manual del usuario) y recalcula el reporte (`recomputeReport`).

En la extensión, `AssistedPanel` (tarjeta «Agregar competidores» del reporte) muestra los enlaces, pide los permisos opcionales de esos orígenes dentro del clic y lee la pestaña activa con `snapshotActiveTab`. El menú contextual `pr-add-offer` de `background.ts` lee la pestaña con `activeTab` y deja una entrada pendiente `{ kind: 'addOffer' }`; `App.tsx` la aplica solo si hay un reporte asistido abierto.

`ResearchReport.mode` (`'automatic' | 'assisted'`) es opcional: los reportes anteriores, sin ese campo, se cargan sin cambios.

## Reglas de coincidencia (`classifyMatch`)

En orden:

1. **GTIN** igual → `EXACT` (o `VARIANT` si cambia la condición o la presentación). GTIN distinto → nunca `EXACT`.
2. **Accesorio o repuesto** («funda para…», «cargador…») o **genérico/compatible** frente a un producto de marca → como máximo `SIMILAR`.
3. **Atributos duros** distintos (capacidad GB/TB, volumen ml/L/oz, peso, unidades por paquete, pantalla, mAh, W) o producto usado/reacondicionado → como máximo `VARIANT`. El modelo confirmado se retira del texto antes de extraer atributos («Aura X2» no es «paquete x2»).
4. **Modelo**: si la identidad tiene modelo, debe aparecer en la oferta (WH-1000XM5 ≈ WH1000XM5). Si tiene marca, debe aparecer como palabra completa («LG» no coincide dentro de «algodón»).
4b. **Versión**: los identificadores con dígitos del nombre (A54, 15, «etapa 3») deben aparecer en la oferta. Los niveles Pro/Max/Plus/Ultra/Mini/Lite (y «S24+») deben coincidir. Los atributos que confirmó el usuario (color, talla, sabor…) generan conflicto si la oferta declara otro valor. Un GTIN o SKU igual prevalece sobre estas reglas.
5. **Cobertura de términos** (umbrales en `MATCH_THRESHOLDS`): con modelo ≥ 40 %, con marca sin modelo ≥ 80 %, sin marca ≥ 85 % para `EXACT`; ≥ 35 % para `SIMILAR`.

El usuario puede marcar «coincidencia exacta» o «excluir de comparación», y las estadísticas se recalculan.

## Regla de oro de precios (`exclusionReason`)

Una oferta entra en mínimo, mediana y máximo **solo si**: no está excluida, es `EXACT` (o marcada así), tiene precio verificado en la página (`PAGE_VERIFIED`) y está en la moneda del mercado. Las demás se cuentan por motivo de exclusión. Los precios del buscador forman una referencia secundaria separada.

## Finanzas (`computeContribution`)

```text
comision_pasarela  = precio × fee% / 100 + fee_fijo
ingreso_ajustado   = precio − ajuste_tributario (solo si el usuario lo aporta)
contribucion       = ingreso_ajustado − costo − importación − envío − comisión − CPA − devoluciones − otros
margen_pct         = contribucion / ingreso_ajustado × 100
CPA_equilibrio     = contribución sin CPA
```

Las validaciones cubren negativos, valores no numéricos, comisiones fuera de 0–100 y división por cero. Sin costo, no hay margen (estado `MISSING_COST`). Sin CPA, se muestra la contribución **antes de publicidad**. El caso ilustrativo de la especificación (100.000 / 40.000 / 8.000 / 3 % + 1.000 / 15.000 / 2.000 / 1.000) da 30.000 de contribución, 30 % de margen y 45.000 de CPA de equilibrio, y está cubierto por pruebas.

Escenarios (`defaultScenarios`): conservador (precio = mínimo verificado si es menor, CPA y devoluciones +50 %), base y optimista (CPA y devoluciones −25 %). Son valores iniciales editables.

## Veredicto y confianza (`computeVerdict`)

| Veredicto | Condición |
| --- | --- |
| `INSUFFICIENT_DATA` | Sin precio o costo, valores inválidos, búsqueda fallida o ninguna oferta del mismo producto. |
| `AVOID` | Contribución ≤ 0, o margen < 8 % (`VERDICT_THRESHOLDS.avoidMarginPct`). Explica el CPA de equilibrio o qué mejorar. |
| `CAUTION` | Contribución positiva con alguna señal de riesgo: sin CPA, margen < 20 %, < 2 precios verificados, precio propio sobre el máximo o > 25 % sobre la mediana, costo tomado de un proveedor o dudas de identidad. |
| `TEST` | Ninguna de las anteriores. Siempre con la nota «prueba con un lote pequeño». |

Confianza de la evidencia (independiente del veredicto):

- **HIGH**: ≥ 4 precios verificados en ≥ 3 dominios, identidad con marca, modelo o GTIN, ≤ 1 duda y sin precios atípicos.
- **MEDIUM**: ≥ 2 precios verificados en ≥ 2 dominios.
- **LOW**: el resto.

Ninguna combinación demuestra demanda ni retorno publicitario.

## Trazabilidad

Cada oferta y cada referencia tiene `SourceEvidence`: URL canónica, publicador, fecha ISO, método (`PAGE`, `SEARCH_API`, `USER_INPUT`, `DEMO_FIXTURE`), estado de verificación, fragmento limitado (≤ 600 caracteres) y consulta de origen. Los reportes se versionan (`schemaVersion`) y se migran con `migrateReport`.

## Seguridad

- Sin código remoto, `eval` ni `new Function` (Zod en modo `jitless`); sin CDNs; las tipografías van empaquetadas.
- El contenido externo se trata como dato: se limpia (`cleanExternalText`), se valida con Zod, nunca se renderiza como HTML en React y se escapa en las exportaciones. Los enlaces solo aceptan `http(s)` (`safeHref`).
- Protección SSRF en la lectura de fichas (`checkPublicUrl`): solo https, sin IPs literales, localhost, dominios internos, credenciales en la URL ni puertos no estándar; también se valida la URL final tras las redirecciones.
- Los captchas y bloqueos se informan, nunca se eluden.
- El texto de las páginas y de las imágenes nunca se usa como instrucción para la IA. El prompt de visión indica ignorar instrucciones dentro de la imagen, y la IA no produce cifras.
- Gateway: CORS con lista blanca, código de acceso opcional comparado en tiempo constante, límites de frecuencia, presupuesto diario y tamaño máximo de cuerpo. No registra imágenes y solo usa endpoints fijos. `includeDomains` solo admite la lista fija de redes (facebook.com, instagram.com, tiktok.com): cualquier otro dominio responde 400, así que no sirve como buscador abierto.
- Las claves de Tavily viajan en la cabecera `Authorization: Bearer …`, nunca en la URL.
