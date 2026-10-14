# Limitaciones conocidas

ProductRadar AI prefiere decir «no verificable» antes que inventar. Estas son las limitaciones reales del MVP.

## Cobertura de búsqueda

- **Es una muestra, no un censo.** Se ejecutan de 3 a 6 consultas y se leen hasta 15 fichas (10 por defecto). El reporte habla de «tiendas encontradas en la muestra» y nunca de «todas las tiendas del país».
- **Regionalización imperfecta.** En la documentación de Brave Search API consultada (octubre de 2026), el parámetro `country` **no incluye Colombia (CO) ni Perú (PE)**. Para esos mercados se usa `country=ALL` con `search_lang=es`, el nombre del país en la consulta y un filtrado posterior por señales locales: comercios conocidos, dominio `.com.co`, precio en COP y menciones del país. México y Chile sí usan `country=MX/CL`.
- **Tavily solo prioriza el país.** Su parámetro `country` (`colombia`, `mexico`, `peru`, `chile`) favorece resultados de ese país, pero no los filtra, y solo aplica con `topic: general` (documentación consultada el 14 de octubre de 2026). Se aplica el mismo filtrado posterior por señales locales.
- **Cuotas del buscador.** Una clave inválida (HTTP 401), el límite de frecuencia (429) o los créditos agotados de Tavily (432 del plan o de la clave, 433 del pago por uso) se muestran como mensajes de clave o de cuota; la investigación no inventa resultados para compensar.
- **Un dominio `.co` no garantiza un vendedor colombiano** (también lo usan empresas de todo el mundo), y aparecer en una búsqueda regional no garantiza que el vendedor despache al país. Cada oferta muestra sus señales («Comercio local», «Probablemente local», «Origen sin confirmar», «Vendedor internacional»).
- La consulta automática depende de la calidad del nombre. Revisa y edita las consultas en «Búsqueda avanzada».

## Verificación de precios

- Se verifican precios **solo** a partir de datos estructurados (JSON-LD de Schema.org, Open Graph `product:price`, microdatos `itemprop`). Las tiendas que pintan el precio solo con JavaScript, sin datos estructurados en el HTML inicial, quedan como «no verificables».
- Las páginas que bloquean la lectura automática (403/429, captcha, desafíos anti-bot) se reportan como tales. **No se eluden.**
- Un precio estructurado sin moneda no se usa en la estadística.
- Un `AggregateOffer` con rango (`lowPrice` ≠ `highPrice`) solo se verifica, con `lowPrice`, si resume varias ofertas (`offerCount` > 1) de un producto con GTIN; si no, queda sin verificar.
- Los precios de lista o tachados (`priceSpecification` con `priceType` ListPrice o StrikethroughPrice) nunca se usan como precio.
- La verificación no confirma inventario real ni condiciones (envío, cuotas, descuentos con tarjeta).
- **Fichas con variantes:** si una ficha lista varias presentaciones, se elige la que mejor coincide con la identidad confirmada; puede equivocarse si los nombres de las variantes son ambiguos.
- **Varios vendedores o precio normal y de oferta:** si las ofertas no muestran señales de variante (nombre, SKU, GTIN o URL distintos, condición no nueva) y son una por vendedor en una ficha con SKU o GTIN, o dos idénticas (mismo SKU y vendedor) que solo difieren en el precio, se verifica el precio más bajo entre las disponibles, con la nota «Precio más bajo publicado en la ficha (varios vendedores u oferta)». En el par sin etiquetas se asume que el precio alto es el normal; si el bajo tuviera condiciones (p. ej. pago con tarjeta de la tienda), se tomaría igual. Tres o más precios del mismo vendedor quedan sin verificar.

## Investigación asistida (sin claves)

### Por qué no hay búsqueda automática sin claves

Comprobado el 14 de octubre de 2026:

1. La API pública de Mercado Libre (`https://api.mercadolibre.com/sites/MCO/search?q=…`) ahora responde **403 `forbidden`** sin OAuth.
2. Las API de catálogo VTEX (p. ej. `exito.com/api/catalog_system/pub/products/search`) responden JSON, pero el `robots.txt` de exito.com tiene `Disallow: /api/`. **No se usan:** respetamos las restricciones de acceso y los términos de uso.
3. Descargar páginas de resultados de Google o Bing, o las búsquedas de las tiendas, está prohibido por la especificación del proyecto y por los términos de esos servicios. La extensión no lo hace.

Por eso el modo sin claves es **asistido**: la extensión arma el enlace a la búsqueda de cada tienda, tú lo abres y eliges las fichas.

### Cobertura

- Solo las fichas que agregas: una muestra elegida por ti, no un censo. Si agregas solo las más baratas (o las más caras), las estadísticas lo reflejarán.
- Sin buscador no hay precios de «solo buscador», referencias de Alibaba, menciones en redes ni identificación por foto. Para Alibaba hay un enlace a su búsqueda; sus precios siguen siendo indicativos.
- El botón «Agregar esta ficha» necesita el permiso opcional de esas tiendas. Para otras tiendas, o sin ese permiso, usa el clic derecho → *Agregar esta ficha a la investigación abierta* (permiso `activeTab` solo para esa pestaña).
- Se rechazan las páginas de resultados, las de inicio y las de Alibaba (es un proveedor, no un competidor).
- Los enlaces de México, Perú y Chile **no se verificaron** con solicitudes reales.

### Lo observado en tiendas de Colombia

Una solicitud por tienda con `curl`, el 14 de octubre de 2026. Las tiendas cambian sus páginas sin aviso.

- **Búsquedas:** los 8 patrones de enlace respondieron HTTP 200 (Olímpica y Amazon rechazan `HEAD` con 405; con `GET`, 200). Mercado Libre redirigió la petición automatizada a una página de verificación de cuenta; en un navegador normal se ve el listado. Un 200 no prueba que se muestren resultados.
- **Fichas** (una por tienda):

| Tienda | Qué publica | Resultado |
| --- | --- | --- |
| Éxito | JSON-LD `Product` con SKU propio y 4 ofertas en COP, una por vendedor (`seller` distinto, misma URL, sin nombre ni SKU por oferta): 2 disponibles y 2 agotadas | Verificado: el precio disponible más bajo (999.900 COP, el del vendedor predeterminado de la ficha). La coincidencia queda «variante» porque el nombre de la ficha no menciona el modelo: márcala como exacta si corresponde |
| Falabella | JSON-LD `Product` con 2 ofertas en COP idénticas (mismo SKU y vendedor) salvo el precio: 1.049.900 (oferta) y 2.249.903 (normal, tachado en la página) | Verificado: el precio de oferta (1.049.900 COP) |
| Alkosto, Ktronix | Precio y moneda (COP) en microdatos, sin JSON-LD `Product` ni `og:title` | Verificado; el nombre sale del `h1` visible |
| Homecenter | JSON-LD con `@type` en minúsculas («product») | Ahora se reconoce |
| Mercado Libre, Olímpica | No se pudieron revisar de forma automática (muro anti-bot, página retirada) | Sin comprobar |

- **Varios precios en la ficha:** se aplica la misma regla que en la verificación automática. Varios vendedores o un precio normal y otro de oferta del mismo artículo se verifican con el precio disponible más bajo (ver «Verificación de precios»). Si son variantes y ninguna se puede atar al producto por GTIN, SKU o nombre, o la estructura no permite distinguirlas, la ficha se agrega **sin precio verificado** y queda fuera de mínimo, mediana y máximo.
- **`robots.txt`:** Éxito, Falabella, Alkosto, Ktronix, Homecenter y Olímpica permiten las fichas de producto, pero varias vetan sus páginas de búsqueda a los rastreadores. Por eso la extensión nunca descarga búsquedas: solo te da el enlace.

## Coincidencias

- Las reglas son deterministas y conservadoras (prefieren «variante» o «parecido» a «mismo producto»), pero no son infalibles: abreviaturas, nombres comerciales distintos o atributos escritos de formas poco comunes pueden confundirlas. Usa «Marcar coincidencia exacta» y «Excluir de comparación».
- Los productos sin marca ni modelo (genéricos) rara vez alcanzan «mismo producto» de forma automática.

## Alibaba

- Solo búsqueda web pública restringida a alibaba.com (`include_domains` con Tavily, `site:alibaba.com` con Brave); no se usa la API privada de Alibaba ni se inicia sesión.
- Los precios y el MOQ provienen del **fragmento del buscador** y son **indicativos**: sujetos a negociación, volumen y vigencia. No incluyen flete, seguro, aranceles, IVA ni despacho local.
- Los títulos suelen estar en inglés. Sin un «nombre en inglés», la coincidencia puede marcarse como incierta.
- Usar una referencia como costo exige que introduzcas tú el tipo de cambio, con fecha y fuente.

## Publicidad

- La API de Meta Ad Library solo expone, para Colombia, anuncios **políticos o de temas sociales**; los anuncios comerciales solo están disponibles para la UE y el Reino Unido (por la DSA). Extraer datos del sitio web de la biblioteca viola los términos de Meta y la especificación del proyecto. Por eso **no hay conteos** de anuncios activos o históricos ni métricas de «saturación»: solo el enlace oficial para revisarla manualmente.
- **Menciones públicas en redes.** Con buscador, una consulta extra (`"marca modelo"` o el nombre) restringida a facebook.com, instagram.com y tiktok.com reúne hasta 8 resultados, guardados como fragmentos del buscador. Una mención **no es un anuncio**: no prueba que exista una campaña ni dice nada de su gasto o alcance. No se ejecuta en la demo, en investigación asistida ni si fallaron todas las búsquedas de mercado; si falla, el reporte no se ve afectado.
- La biblioteca de anuncios de TikTok solo cubre ciertas regiones (UE y Reino Unido, entre otras), por lo que no se incluye para LATAM.

## Finanzas

- La métrica es **margen de contribución por pedido**, no utilidad neta: no incluye gastos fijos, impuesto de renta ni capital de trabajo.
- IVA y aranceles no se calculan: solo puedes descontar un monto que tú hayas calculado.
- No hay conversión automática de monedas: el tipo de cambio lo introduces tú.

## Identificación por foto

- Depende de la calidad de la foto y del modelo de visión. La IA solo **propone**; marca y modelo quedan vacíos si no son legibles, y siempre debes confirmar.
- Requiere el gateway con clave de Anthropic, o tu clave en modo desarrollo. No está disponible en investigación asistida.

## Seguridad y operación

- Desde el navegador no se puede comprobar si un dominio público **resuelve** a una IP privada (rebinding de DNS). Se bloquean IPs literales, localhost y dominios internos (también con punto final, p. ej. `localhost.`), y la lectura solo ocurre con tu permiso por sitio.
- El `fetch` del navegador no permite inspeccionar cada salto de una redirección (las respuestas `redirect: 'manual'` son opacas). Se valida la URL final antes de leerla, pero una tienda podría redirigir la petición GET a otra dirección antes de esa validación. Es lo mismo que puede hacer cualquier página que visites. La respuesta solo se lee si el destino es público y tiene permiso.
- El gateway sin inicio de sesión **no es infalible**: CORS no autentica, el identificador de instalación lo genera el cliente y el código de acceso se puede compartir. Los límites por IP, las cuotas diarias y el presupuesto reducen el abuso, pero no lo eliminan.
- Activar el panel en una pestaña distinta a la que se analizó puede requerir volver a pulsar el ícono o usar el menú contextual (así funciona `activeTab`), o conceder acceso al sitio.

## Mercados

Colombia es el mercado principal. México, Perú y Chile están marcados como **beta**: se configuraron moneda, idioma y comercios conocidos, pero no se validaron con búsquedas reales.

## Integraciones sin probar con credenciales reales

En este repositorio, las llamadas reales a **Tavily**, **Brave Search API** y **Anthropic (visión)** se probaron con respuestas simuladas y contra el gateway local sin claves, pero **no con claves reales**. El adaptador de Tavily sigue su documentación consultada el 14 de octubre de 2026. La primera ejecución con claves debería revisarse manualmente (formatos de respuesta, límites del plan, latencia).
