import type { z } from 'zod';

/** Error con estado HTTP y código estable para el cliente. El mensaje se muestra al usuario. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** Forma de error común: `{ error: { code, message } }` (sin trazas ni cuerpos de terceros). */
export function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error: { code, message } }, status, headers);
}

export function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

function isJsonContentType(value: string | null): boolean {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json';
}

const tooLarge = () => new HttpError(413, 'PAYLOAD_TOO_LARGE', 'La solicitud supera el tamaño máximo permitido');

/** Lee el cuerpo cortando en cuanto supera `maxBytes` (no confía solo en Content-Length). */
async function readLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Mensaje breve en español a partir del primer problema de validación (sin detalles internos). */
function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.filter((p) => typeof p === 'string' || typeof p === 'number').join('.');
  return path ? `Solicitud inválida: revisa el campo "${path}"` : 'Solicitud inválida';
}

/**
 * Valida tipo de contenido, tamaño y JSON del cuerpo, y lo parsea con el esquema Zod.
 * Orden: 415 → 413 (Content-Length) → 413 (lectura) → 400 (JSON) → 400 (esquema).
 */
export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>, maxBytes: number): Promise<T> {
  if (!isJsonContentType(request.headers.get('Content-Type'))) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo debe ser JSON (Content-Type: application/json)');
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0) throw new HttpError(400, 'BAD_REQUEST', 'Content-Length inválido');
    if (length > maxBytes) throw tooLarge();
  }
  const bytes = await readLimited(request, maxBytes);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'El cuerpo no es JSON válido');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, 'BAD_REQUEST', validationMessage(parsed.error));
  return parsed.data;
}
