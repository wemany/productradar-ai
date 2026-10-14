import { checkPublicUrl, originPattern, PageFetchError, snapshotFromHtml, type OfferPageFetcher, type PageSnapshot } from '@productradar/core';
import { hasOrigin } from './permissions';

const MAX_BYTES = 2_500_000;
const TIMEOUT_MS = 12_000;
// Señales de páginas de desafío (no de fichas que simplemente incluyen un script de reCAPTCHA en un formulario).
const CHALLENGE_MARKERS = [
  /cf-chl-|challenge-platform|cf_chl_opt/i,
  /<title>\s*(just a moment|attention required|access denied|acceso denegado|un momento)/i,
  /<title>[^<]{0,80}(captcha|are you a robot|verifica que eres humano|no soy un robot)/i,
];

/**
 * Lee páginas públicas de producto desde la extensión, con permiso explícito
 * del usuario para cada sitio. Sin cookies (`credentials: 'omit'`), sin
 * ejecutar JavaScript de la página y sin eludir bloqueos: si el sitio pide
 * captcha o niega el acceso, se informa como "no verificable".
 */
export class ExtensionPageFetcher implements OfferPageFetcher {
  async fetchSnapshot(url: string, signal?: AbortSignal): Promise<PageSnapshot> {
    const safety = checkPublicUrl(url);
    if (!safety.ok) throw new PageFetchError('UNSAFE_URL', safety.reason ?? 'URL no permitida');
    const origin = originPattern(url);
    if (!origin || !(await hasOrigin(origin))) throw new PageFetchError('NO_PERMISSION', 'Sin permiso para leer este sitio');

    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'es-CO,es;q=0.9' },
        signal: combined,
      });
    } catch {
      if (signal?.aborted) throw new PageFetchError('ABORTED', 'Cancelado');
      if (timeout.aborted) throw new PageFetchError('TIMEOUT', 'Tiempo de espera agotado');
      throw new PageFetchError('NETWORK', 'No fue posible conectar con el sitio (puede haber redirigido a otro dominio)');
    }

    const finalUrl = response.url || url;
    if (!checkPublicUrl(finalUrl).ok) throw new PageFetchError('UNSAFE_URL', 'El sitio redirigió a una dirección no permitida');
    if ([401, 403, 429, 451].includes(response.status)) throw new PageFetchError('BLOCKED', 'El sitio bloqueó la lectura automática', response.status);
    if (response.status === 404 || response.status === 410) throw new PageFetchError('NOT_FOUND', 'La página ya no existe', response.status);
    if (!response.ok) throw new PageFetchError(response.status === 503 ? 'BLOCKED' : 'HTTP_ERROR', 'El sitio respondió con un error', response.status);
    const type = response.headers.get('content-type') ?? '';
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new PageFetchError('NOT_HTML', 'La URL no es una página HTML');

    const html = await readLimited(response, MAX_BYTES);
    if (CHALLENGE_MARKERS.some((re) => re.test(html.slice(0, 20_000))) && !/application\/ld\+json/i.test(html)) {
      throw new PageFetchError('BLOCKED', 'El sitio exige verificación humana (captcha); no se elude');
    }
    return snapshotFromHtml(html, finalUrl);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, merged.byteLength - offset));
    merged.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= merged.byteLength) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}
