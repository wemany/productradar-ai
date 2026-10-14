# Gateway de ProductRadar AI

Cloudflare Worker mínimo que guarda las claves de **Brave Search** y **Anthropic** para que nunca viajen dentro de la extensión. Es infraestructura invisible: la extensión lo llama y el usuario no interactúa con él.

No es un proxy abierto. Solo llama a dos endpoints fijos (`api.search.brave.com` y `api.anthropic.com`) y nunca descarga URLs enviadas por el cliente. Hay una prueba que lo verifica.

## Rutas

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/v1/health` | Estado público: versión, proveedores configurados y si se exige código de acceso (sin secretos). |
| POST | `/v1/search-market` | 1 a 6 consultas web para un mercado (CO, MX, PE, CL). Un fallo en una consulta no tumba las demás. |
| POST | `/v1/search-alibaba` | Busca proveedores solo en alibaba.com: quita los `site:` del usuario, antepone `site:alibaba.com` y filtra los resultados por dominio. |
| POST | `/v1/identify-image` | Identifica el producto de una foto con Claude. La imagen no se registra, no se guarda y no se cachea. |

El contrato (esquemas Zod) vive en `packages/core/src/api.ts` y lo comparten el gateway y la extensión. Los errores siempre tienen la forma `{ "error": { "code", "message" } }`, con el mensaje en español.

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
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_CODE   # opcional
```

Si falta una clave, `/v1/health` lo indica y la ruta correspondiente responde `503 NOT_CONFIGURED`.

`ACCESS_CODE` es un código compartido para demos o grupos cerrados. La extensión lo envía en la cabecera `X-ProductRadar-Access`. Sirve para filtrar el acceso, pero no reemplaza a cuentas de usuario.

## Despliegue

```bash
pnpm gateway:deploy   # wrangler deploy (pide iniciar sesión en Cloudflare la primera vez)
```

Antes de publicar, configura en `wrangler.jsonc`:

- **`ALLOWED_ORIGINS`**: el origen de la extensión publicada, `chrome-extension://<id>`. El id aparece en `chrome://extensions` o en la ficha de Chrome Web Store. Puedes poner varios separados por comas. Si lo dejas vacío, se rechaza cualquier solicitud de navegador que traiga `Origin`.
- **Presupuesto diario** (opcional, recomendado): crea el KV con `npx wrangler kv namespace create USAGE_KV` y descomenta `kv_namespaces` con el id que te devuelva. Los límites están en `DAILY_SEARCH_LIMIT` (por defecto 2000) y `DAILY_VISION_LIMIT` (por defecto 200).
- **`ratelimits`**: el `namespace_id` es un número que eliges tú y que debe ser único en tu cuenta.

## Límites y advertencias

- **Sin inicio de sesión, la protección tiene huecos.** CORS solo impide que otras páginas web usen el gateway desde un navegador; no autentica, porque curl o un script pueden omitir o falsificar `Origin`. El id de instalación (`X-ProductRadar-Install`) lo genera el cliente y solo sirve para repartir el límite de frecuencia. El código de acceso se puede compartir.
- **El presupuesto importa.** Cada búsqueda en Brave y cada foto analizada por Claude cuestan dinero. Mantén el KV de presupuesto activo y alertas de gasto en ambos proveedores.
- **Límite de frecuencia**: `RATE_LIMIT_PER_MINUTE` (30 por defecto) por IP (IPv6 agrupada por /64) y por instalación. El limitador en memoria funciona por isolate y el binding `RATE_LIMITER` por ubicación de Cloudflare, así que ambos son aproximados.
- **Presupuesto diario**: KV es eventualmente consistente y no tiene incrementos atómicos. Con tráfico concurrente el contador puede quedarse algo corto. Sin `USAGE_KV`, este control se omite.
- **Caché**: las respuestas correctas de Brave se cachean 6 horas por consulta, mercado y cantidad con la Cache API. Esta caché es local a cada centro de datos y de mejor esfuerzo. Las imágenes y los resultados de visión nunca se cachean.
- No definas variables `ANTHROPIC_*` adicionales. El Worker se ejecuta sin `nodejs_compat`, así que el SDK no las lee, y conviene mantenerlo así.
