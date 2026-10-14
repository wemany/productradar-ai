# Gateway de ProductRadar AI

Cloudflare Worker mínimo que guarda las claves del buscador (**Tavily** o **Brave Search**) y de **Anthropic** para que nunca viajen dentro de la extensión. Es infraestructura invisible: la extensión lo llama y el usuario no interactúa con él.

No es un proxy abierto. Solo llama a endpoints fijos (`api.tavily.com`, `api.search.brave.com` y `api.anthropic.com`) y nunca descarga URLs enviadas por el cliente. Hay pruebas que lo verifican.

## Rutas

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/v1/health` | Estado público: versión, si hay buscador y visión configurados, qué buscador se usa (`searchProvider`) y si se exige código de acceso (sin secretos). |
| POST | `/v1/search-market` | 1 a 6 consultas web para un mercado (CO, MX, PE, CL). Un fallo en una consulta no tumba las demás. Acepta `includeDomains` opcional, limitado a una lista fija (ver abajo). |
| POST | `/v1/search-alibaba` | Busca proveedores solo en alibaba.com: quita los `site:` del usuario, restringe la búsqueda a alibaba.com y filtra los resultados por dominio. |
| POST | `/v1/identify-image` | Identifica el producto de una foto con Claude. La imagen no se registra, no se guarda y no se cachea. |

El contrato (esquemas Zod) vive en `packages/core/src/api.ts` y lo comparten el gateway y la extensión. Los errores siempre tienen la forma `{ "error": { "code", "message" } }`, con el mensaje en español.

### Menciones públicas en redes (`includeDomains`)

La extensión hace una búsqueda extra de menciones públicas del producto en Facebook, Instagram y TikTok. Para eso envía `includeDomains` en `/v1/search-market`. El gateway **solo acepta** `facebook.com`, `instagram.com` y `tiktok.com`; cualquier otro valor responde `400 BAD_REQUEST` sin llamar al buscador. Así la ruta no sirve como buscador libre de dominios. Con Tavily se envía como `include_domains`; con Brave se añade `(site:facebook.com OR site:instagram.com OR site:tiktok.com)` a la consulta. En ambos casos se descartan después los resultados de otros dominios.

Son menciones encontradas por el buscador, **no anuncios**: el gateway no consulta la biblioteca de anuncios de Meta ni cuenta anuncios.

## Elegir buscador

| Variable | Tipo | Uso |
| --- | --- | --- |
| `TAVILY_API_KEY` | secreto | Clave de Tavily Search API (`tvly-…`). Plan gratuito con créditos mensuales; cada búsqueda básica cuesta 1 crédito. |
| `BRAVE_API_KEY` | secreto | Clave de Brave Search API (alternativa). |
| `SEARCH_PROVIDER` | variable | `tavily` o `brave`. Si está vacía o tiene otro valor: Tavily cuando existe `TAVILY_API_KEY`; si no, Brave. |

Si eliges un buscador de forma explícita y falta su clave, el gateway **no** cambia al otro: `/v1/health` muestra `providers.search: false` y las búsquedas responden `503 NOT_CONFIGURED`, para que el error de configuración se note.

Con Tavily, el país se envía en `country` (`colombia`, `mexico`, `peru`, `chile`). Según su documentación, solo **prioriza** resultados de ese país (y solo con `topic: general`); no los filtra, así que la extensión sigue aplicando sus propios filtros locales. Brave no admite `CO` ni `PE`, y en esos mercados busca sin país.

## Desarrollo local

```bash
cp apps/gateway/.dev.vars.example apps/gateway/.dev.vars   # completa tus claves (.dev.vars está en .gitignore)
pnpm gateway:dev                                           # wrangler dev en http://localhost:8787
pnpm --filter @productradar/gateway test
pnpm --filter @productradar/gateway typecheck
```

En la extensión, usa `http://localhost:8787` como URL del gateway. Para probar desde la extensión, añade su origen a `ALLOWED_ORIGINS` en `.dev.vars`.

## Secretos

Los secretos nunca van en `wrangler.jsonc` ni en el repositorio. Se definen así:

```bash
cd apps/gateway
npx wrangler secret put TAVILY_API_KEY    # o BRAVE_API_KEY (basta con un buscador)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_CODE       # opcional
```

Si falta una clave, `/v1/health` lo indica y la ruta correspondiente responde `503 NOT_CONFIGURED`. Si el buscador rechaza la clave del servidor, el cliente recibe `NOT_CONFIGURED` sin detalles y el registro del Worker indica qué secreto revisar.

`ACCESS_CODE` es un código compartido para demos o grupos cerrados. La extensión lo envía en la cabecera `X-ProductRadar-Access`. Sirve para filtrar el acceso, pero no reemplaza a cuentas de usuario.

## Despliegue

```bash
pnpm gateway:deploy   # wrangler deploy (pide iniciar sesión en Cloudflare la primera vez)
```

Antes de publicar, configura en `wrangler.jsonc`:

- **`ALLOWED_ORIGINS`**: el origen de la extensión publicada, `chrome-extension://<id>`. El id aparece en `chrome://extensions` o en la ficha de Chrome Web Store. Puedes poner varios separados por comas. Si lo dejas vacío, se rechaza cualquier solicitud de navegador que traiga `Origin`.
- **`SEARCH_PROVIDER`** (opcional): fija el buscador si tienes las dos claves.
- **Presupuesto diario** (opcional, recomendado): crea el KV con `npx wrangler kv namespace create USAGE_KV` y descomenta `kv_namespaces` con el id que te devuelva. Los límites están en `DAILY_SEARCH_LIMIT` (por defecto 2000) y `DAILY_VISION_LIMIT` (por defecto 200).
- **`ratelimits`**: el `namespace_id` es un número que eliges tú y que debe ser único en tu cuenta.

## Límites y advertencias

- **Sin inicio de sesión, la protección tiene huecos.** CORS solo impide que otras páginas web usen el gateway desde un navegador; no autentica, porque curl o un script pueden omitir o falsificar `Origin`. El id de instalación (`X-ProductRadar-Install`) lo genera el cliente y solo sirve para repartir el límite de frecuencia. El código de acceso se puede compartir.
- **El presupuesto importa.** Cada búsqueda (Tavily o Brave) y cada foto analizada por Claude consumen créditos o dinero. Mantén el KV de presupuesto activo y alertas de gasto en los proveedores. Cuando Tavily agota el plan o el límite de pago por uso (HTTP 432 o 433), el cliente recibe `QUOTA_EXCEEDED`.
- **Límite de frecuencia**: `RATE_LIMIT_PER_MINUTE` (30 por defecto) por IP (IPv6 agrupada por /64) y por instalación. El limitador en memoria funciona por isolate y el binding `RATE_LIMITER` por ubicación de Cloudflare, así que ambos son aproximados.
- **Presupuesto diario**: KV es eventualmente consistente y no tiene incrementos atómicos. Con tráfico concurrente el contador puede quedarse algo corto. Sin `USAGE_KV`, este control se omite.
- **Caché**: las respuestas correctas del buscador se cachean 6 horas por buscador, consulta, mercado, cantidad y dominios con la Cache API. Esta caché es local a cada centro de datos y de mejor esfuerzo. Las imágenes y los resultados de visión nunca se cachean.
- No definas variables `ANTHROPIC_*` adicionales. El Worker se ejecuta sin `nodejs_compat`, así que el SDK no las lee, y conviene mantenerlo así.
