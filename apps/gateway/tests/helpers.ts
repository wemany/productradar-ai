import type { ExecutionContext } from '@cloudflare/workers-types';
import { vi } from 'vitest';
import type { Env, UsageKv } from '../src/env';
import worker from '../src/index';

export const BASE = 'https://gateway.test';
export const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BRAVE_API_KEY: 'test-brave-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    ALLOWED_ORIGINS: EXTENSION_ORIGIN,
    RATE_LIMIT_PER_MINUTE: '1000',
    ...overrides,
  };
}

/** Contexto falso que guarda las promesas de `waitUntil` para poder esperarlas. */
export function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => undefined,
  };
  return { ctx: ctx as unknown as ExecutionContext, flush: () => Promise.all(pending) };
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  /** Cuerpo crudo (texto) en lugar de JSON serializado. */
  raw?: string;
  headers?: Record<string, string>;
  env?: Env;
}

export async function call(path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined = options.raw;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] ??= 'application/json';
  }
  const request = new Request(`${BASE}${path}`, { method: options.method ?? (body !== undefined ? 'POST' : 'GET'), headers, body });
  return send(request, options.env);
}

/** Ejecuta el Worker con una Request ya construida y espera los `waitUntil`. */
export async function send(request: Request, env: Env = makeEnv()) {
  const { ctx, flush } = makeCtx();
  const response = await worker.fetch(request, env, ctx);
  await flush();
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, status: response.status, json: json as Record<string, unknown> & { error?: { code: string; message: string } } };
}

export function fakeKv(initial: Record<string, string> = {}): UsageKv & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => void store.set(key, value),
  };
}

export function requestUrl(input: unknown): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL((input as Request).url);
}

export function jsonReply(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function braveBody(results: Array<{ title: string; url: string; description?: string }>) {
  return {
    web: {
      results: results.map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description ?? `Descripción de ${r.title}`,
        extra_snippets: ['Envío gratis', 'Precio $ 129.900'],
        profile: { name: 'Tienda Ejemplo' },
      })),
    },
  };
}

/** Mock de fetch global; `handler` decide la respuesta según la URL. */
export function mockFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(requestUrl(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function fetchedHosts(fn: ReturnType<typeof mockFetch>): string[] {
  return fn.mock.calls.map(([input]) => requestUrl(input).hostname);
}

/** JPEG mínimo (solo cabecera + relleno) codificado en base64, ≥ 100 caracteres. */
export function fakeImageBase64(kind: 'jpeg' | 'png' = 'jpeg'): string {
  const head = kind === 'jpeg' ? [0xff, 0xd8, 0xff, 0xe0] : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = [...head, ...Array.from({ length: 120 }, (_, i) => i % 256)];
  return btoa(String.fromCharCode(...bytes));
}
