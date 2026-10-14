# Política de privacidad — ProductRadar AI

_Última actualización: 14 de octubre de 2026 · versión 0.1.0_

Este documento describe lo que la extensión hace **realmente** con los datos. Sirve como base de la política pública que exige Chrome Web Store. Si publicas tu propia versión, adapta los datos de contacto y el operador del gateway.

## Resumen

- ProductRadar AI **no tiene cuentas**, no usa analítica ni publicidad, y **no vende ni comparte datos**.
- Tu historial de investigaciones se guarda **solo en tu navegador** (`chrome.storage.local`) y puedes borrarlo en cualquier momento.
- La extensión lee una página **solo cuando tú lo pides**, y únicamente los metadatos públicos del producto.
- Para buscar competidores y, si lo eliges, identificar una foto, se envían datos a proveedores externos, descritos abajo. Esto solo ocurre en los modos «Servicio ProductRadar» y «Claves propias».
- En **investigación asistida** (el modo sin claves) no se envía nada a ningún servidor: ni al gateway, ni a buscadores, ni a servicios de IA.

## Qué datos se procesan y dónde

| Dato | Cuándo | Adónde va | Retención |
| --- | --- | --- | --- |
| Metadatos públicos de la ficha (nombre, marca, modelo, GTIN, imagen, precio, JSON-LD, Open Graph, h1, URL) | Al pulsar «Analizar esta página», usar el menú contextual o el atajo | Se procesan **localmente** en la extensión | En tu historial local, si continúas |
| Consultas de búsqueda (nombre, marca, modelo y atributos del producto, más el país), incluidas la de Alibaba y la de menciones en redes (`"marca modelo"` restringida a facebook.com, instagram.com y tiktok.com) | Al pulsar «Buscar competencia» | Al **gateway** configurado y de ahí a **Tavily** o **Brave Search API**; o directo al buscador elegido en modo «claves propias» | El gateway puede guardar en caché resultados de búsqueda hasta 6 horas para reducir costos. Tavily y Brave aplican su propia política. |
| Fichas que agregas en investigación asistida (los mismos metadatos públicos) | Al pulsar «Agregar esta ficha» o el menú contextual «Agregar esta ficha a la investigación abierta» | Se leen en la pestaña ya abierta (no se vuelve a descargar) y se procesan **localmente**. No salen de tu equipo | Nombre, URL, precio y un fragmento breve como evidencia en tu historial local |
| Páginas públicas de competidores | Solo tras tu permiso para esos sitios | Se descargan **desde tu navegador**, sin cookies ni sesión, y se procesan localmente | Solo se guarda un fragmento (≤ 600 caracteres) como evidencia en tu historial local |
| Foto que subes | Solo si aceptas el aviso de consentimiento y pulsas «Identificar producto» | Se comprime y se le quitan los metadatos EXIF (incluida la ubicación GPS) **en tu equipo**; luego va al gateway y de ahí a **Anthropic (Claude)**, o directo en modo «claves propias» | El gateway **no** la registra, guarda ni cachea. Anthropic aplica su propia política de retención de la API. |
| Identificador anónimo de instalación | En cada llamada al gateway | Gateway (cabecera `X-ProductRadar-Install`) | Solo se usa para límites de frecuencia y cuotas. No te identifica. |
| Dirección IP | En cada llamada al gateway | Cloudflare / gateway | Se usa para límites de frecuencia; contadores efímeros |
| Claves de API de Tavily, Brave o Anthropic (solo «claves propias», uso personal) | Si las introduces | `chrome.storage.session` (se borran al cerrar Chrome) o `storage.local` si marcas «Recordar». Solo se envían al proveedor correspondiente, en una cabecera (la de Tavily, `Authorization: Bearer`), nunca en la URL | Hasta que las borres en Configuración |

## Qué NO se recolecta

Historial de navegación, cookies, contraseñas, formularios, campos de checkout, datos personales de compradores, correo electrónico, ubicación ni contenido de otras pestañas. El script que lee la página ignora explícitamente los formularios (ver `apps/extension/src/services/page-snapshot.ts` y sus pruebas).

## Permisos de Chrome y por qué se necesitan

| Permiso | Uso |
| --- | --- |
| `activeTab` | Leer la pestaña activa **solo** después de que hagas clic en el ícono, el menú contextual o el atajo. |
| `scripting` | Inyectar, una sola vez y bajo demanda, la función que lee los metadatos públicos del producto. |
| `sidePanel` | Mostrar la interfaz en el panel lateral. |
| `storage` | Guardar ajustes e historial en tu navegador. |
| `contextMenus` | Opciones de clic derecho «Investigar este producto» y «Agregar esta ficha a la investigación abierta». |
| `optional_host_permissions: https://*/*` | **Opcional**. Se pide sitio por sitio cuando quieres verificar precios o leer una URL. En «Claves propias», al guardar se pide acceso solo a la API del buscador elegido (`https://api.tavily.com/*` o la de Brave) y a la de Anthropic. En investigación asistida, «Permitir lectura en estas tiendas» pide solo los orígenes de las tiendas enlazadas. Puedes concederlo para todos los sitios en Configuración y retirarlo cuando quieras. |

## Investigación asistida (sin claves)

- **Solo se leen las pestañas que agregas tú**, con el botón «Agregar esta ficha» o el menú contextual, y siempre después de tu clic. El script es el mismo de «Analizar esta página» y lee solo los metadatos públicos del producto descritos arriba: ni formularios, ni cookies, ni almacenamiento de la página.
- **El permiso de las tiendas es opcional** y se limita a los orígenes listados (p. ej. `https://*.mercadolibre.com.co/*`, `https://www.exito.com/*`, `https://www.alkosto.com/*`). Se pide dentro de tu clic en «Permitir lectura en estas tiendas». Sin él, el menú contextual usa `activeTab` solo para esa pestaña.
- **Los enlaces de búsqueda los abres tú** en una pestaña nueva, como cualquier enlace. La extensión no descarga páginas de resultados.
- **Nada sale de tu equipo.** El reporte se crea localmente y se guarda en `chrome.storage.local`. La extensión no llama al gateway, a buscadores ni a servicios de IA. Las únicas cargas de red son las que inicias tú (las pestañas que abres) y la imagen del producto que muestra el reporte, si la ficha analizada publicaba una: se carga desde la tienda, sin referer.

## Terceros

- **Tavily Search API** (búsqueda web): <https://tavily.com/privacy> y los términos de la API.
- **Brave Search API** (búsqueda web): <https://search.brave.com/help/privacy-policy> y los términos de la API.
- **Anthropic** (visión, solo con fotos): <https://www.anthropic.com/legal/privacy> y los términos comerciales de la API.
- **Cloudflare** (aloja el gateway): <https://www.cloudflare.com/privacypolicy/>.
- Los enlaces a Meta Ads Library y Google Ads Transparency se abren en tu navegador. La extensión no consulta esos servicios. Lo mismo ocurre con los enlaces a las búsquedas de las tiendas y de Alibaba en investigación asistida: aplica la política de cada sitio.

## Tus controles

- **Borrar historial**: Configuración → Privacidad → «Borrar historial», o desde «Mis investigaciones».
- **Borrar claves**: Configuración → «Borrar claves guardadas».
- **Retirar permisos de sitios**: Configuración → «Retirar acceso ampliado», o `chrome://extensions` → ProductRadar AI → Detalles → Acceso a sitios.
- **Revocar el consentimiento de fotos**: Configuración → «Restablecer consentimiento de fotos».
- Desinstalar la extensión elimina todos los datos locales.

## Contacto

Publica aquí el correo o el repositorio de contacto del operador de la extensión y del gateway antes de enviarla a Chrome Web Store.
