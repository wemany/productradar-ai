# Limitaciones conocidas

ProductRadar AI prefiere decir «no verificable» antes que inventar. Estas son las limitaciones reales del MVP.

## Cobertura de búsqueda

- **Es una muestra, no un censo.** Se ejecutan de 3 a 6 consultas y se leen hasta 15 fichas (10 por defecto). El reporte habla de «tiendas encontradas en la muestra» y nunca de «todas las tiendas del país».
- **Regionalización imperfecta.** En la documentación de Brave Search API consultada (octubre de 2026), el parámetro `country` **no incluye Colombia (CO) ni Perú (PE)**. Para esos mercados se usa `country=ALL` con `search_lang=es`, el nombre del país en la consulta y un filtrado posterior por señales locales: comercios conocidos, dominio `.com.co`, precio en COP y menciones del país. México y Chile sí usan `country=MX/CL`.
- **Un dominio `.co` no garantiza un vendedor colombiano** (también lo usan empresas de todo el mundo), y aparecer en una búsqueda regional no garantiza que el vendedor despache al país. Cada oferta muestra sus señales («Comercio local», «Probablemente local», «Origen sin confirmar», «Vendedor internacional»).
- La consulta automática depende de la calidad del nombre. Revisa y edita las consultas en «Búsqueda avanzada».

## Verificación de precios

- Se verifican precios **solo** a partir de datos estructurados (JSON-LD de Schema.org, Open Graph `product:price`, microdatos `itemprop`). Las tiendas que pintan el precio solo con JavaScript, sin datos estructurados en el HTML inicial, quedan como «no verificables».
- Las páginas que bloquean la lectura automática (403/429, captcha, desafíos anti-bot) se reportan como tales. **No se eluden.**
- Un precio estructurado sin moneda no se usa en la estadística.
- Para `AggregateOffer` se usa el precio mínimo (`lowPrice`) y se informa el rango.
- La verificación no confirma inventario real ni condiciones (envío, cuotas, descuentos con tarjeta).
- **Fichas con variantes:** si una ficha lista varias presentaciones, se elige la que mejor coincide con la identidad confirmada; puede equivocarse si los nombres de las variantes son ambiguos.

## Coincidencias

- Las reglas son deterministas y conservadoras (prefieren «variante» o «parecido» a «mismo producto»), pero no son infalibles: abreviaturas, nombres comerciales distintos o atributos escritos de formas poco comunes pueden confundirlas. Usa «Marcar coincidencia exacta» y «Excluir de comparación».
- Los productos sin marca ni modelo (genéricos) rara vez alcanzan «mismo producto» de forma automática.

## Alibaba

- Solo búsqueda web pública con `site:alibaba.com`; no se usa la API privada de Alibaba ni se inicia sesión.
- Los precios y el MOQ provienen del **fragmento del buscador** y son **indicativos**: sujetos a negociación, volumen y vigencia. No incluyen flete, seguro, aranceles, IVA ni despacho local.
- Los títulos suelen estar en inglés. Sin un «nombre en inglés», la coincidencia puede marcarse como incierta.
- Usar una referencia como costo exige que introduzcas tú el tipo de cambio, con fecha y fuente.

## Publicidad

- La API pública de Meta Ad Library no da acceso general a todos los anuncios comerciales de un país ni a su histórico completo. Por eso **no hay conteos** de anuncios activos o históricos ni métricas de «saturación». Solo hay enlaces a las bibliotecas oficiales para revisarlas manualmente.
- La biblioteca de anuncios de TikTok solo cubre ciertas regiones (UE y Reino Unido, entre otras), por lo que no se incluye para LATAM.

## Finanzas

- La métrica es **margen de contribución por pedido**, no utilidad neta: no incluye gastos fijos, impuesto de renta ni capital de trabajo.
- IVA y aranceles no se calculan: solo puedes descontar un monto que tú hayas calculado.
- No hay conversión automática de monedas: el tipo de cambio lo introduces tú.

## Identificación por foto

- Depende de la calidad de la foto y del modelo de visión. La IA solo **propone**; marca y modelo quedan vacíos si no son legibles, y siempre debes confirmar.
- Requiere el gateway con clave de Anthropic, o tu clave en modo desarrollo.

## Seguridad y operación

- Desde el navegador no se puede comprobar si un dominio público **resuelve** a una IP privada (rebinding de DNS). Se bloquean IPs literales, localhost y dominios internos (también con punto final, p. ej. `localhost.`), y la lectura solo ocurre con tu permiso por sitio.
- El `fetch` del navegador no permite inspeccionar cada salto de una redirección (las respuestas `redirect: 'manual'` son opacas). Se valida la URL final antes de leerla, pero una tienda podría redirigir la petición GET a otra dirección antes de esa validación. Es lo mismo que puede hacer cualquier página que visites. La respuesta solo se lee si el destino es público y tiene permiso.
- El gateway sin inicio de sesión **no es infalible**: CORS no autentica, el identificador de instalación lo genera el cliente y el código de acceso se puede compartir. Los límites por IP, las cuotas diarias y el presupuesto reducen el abuso, pero no lo eliminan.
- Activar el panel en una pestaña distinta a la que se analizó puede requerir volver a pulsar el ícono o usar el menú contextual (así funciona `activeTab`), o conceder acceso al sitio.

## Mercados

Colombia es el mercado principal. México, Perú y Chile están marcados como **beta**: se configuraron moneda, idioma y comercios conocidos, pero no se validaron con búsquedas reales.

## Integraciones sin probar con credenciales reales

En este repositorio, las llamadas reales a **Brave Search API** y a **Anthropic (visión)** se probaron con respuestas simuladas y contra el gateway local sin claves, pero **no con claves reales**. La primera ejecución con claves debería revisarse manualmente (formatos de respuesta, límites del plan, latencia).
