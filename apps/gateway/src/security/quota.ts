import { readLimit, type Env } from '../env';
import { HttpError } from '../http';

/**
 * Presupuesto diario global (aproximado) con Workers KV (`USAGE_KV`).
 *
 * Cada búsqueda y cada identificación por foto cuestan dinero, así que se fija
 * un techo diario para todo el gateway. Es de mejor esfuerzo: KV es
 * eventualmente consistente y no tiene incrementos atómicos, por lo que con
 * tráfico concurrente el contador puede quedarse algo corto. Si `USAGE_KV` no
 * está vinculado, este control se omite.
 */

export type QuotaKind = 'search' | 'vision';

const DEFAULT_DAILY_LIMITS: Record<QuotaKind, number> = { search: 2000, vision: 200 };
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

const MESSAGES: Record<QuotaKind, string> = {
  search: 'Se alcanzó el presupuesto diario de búsquedas del servicio; intenta de nuevo mañana',
  vision: 'Se alcanzó el presupuesto diario de identificación por foto; intenta de nuevo mañana',
};

export function dailyLimit(env: Env, kind: QuotaKind): number {
  return readLimit(kind === 'search' ? env.DAILY_SEARCH_LIMIT : env.DAILY_VISION_LIMIT, DEFAULT_DAILY_LIMITS[kind]);
}

/** Clave por día UTC, p. ej. `usage:search:2026-10-12`. */
export function usageKey(kind: QuotaKind, now = new Date()): string {
  return `usage:${kind}:${now.toISOString().slice(0, 10)}`;
}

function secondsUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

function parseCount(value: string | null): number {
  const n = Number.parseInt(value ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Lanza 429 QUOTA_EXCEEDED si `units` más lo ya usado hoy supera el límite. */
export async function checkQuota(env: Env, kind: QuotaKind, units: number, now = new Date()): Promise<void> {
  if (!env.USAGE_KV) return;
  let used: number;
  try {
    used = parseCount(await env.USAGE_KV.get(usageKey(kind, now)));
  } catch {
    console.warn('USAGE_KV no disponible; se omite el control de presupuesto');
    return;
  }
  if (used + units > dailyLimit(env, kind)) {
    throw new HttpError(429, 'QUOTA_EXCEEDED', MESSAGES[kind], { 'Retry-After': String(secondsUntilUtcMidnight(now)) });
  }
}

/** Suma `units` al contador del día. Pensado para `ctx.waitUntil` (no bloquea la respuesta). */
export async function recordUsage(env: Env, kind: QuotaKind, units: number, now = new Date()): Promise<void> {
  if (!env.USAGE_KV || units <= 0) return;
  const key = usageKey(kind, now);
  try {
    const used = parseCount(await env.USAGE_KV.get(key));
    await env.USAGE_KV.put(key, String(used + units), { expirationTtl: COUNTER_TTL_SECONDS });
  } catch {
    console.warn('No se pudo actualizar el contador diario de uso');
  }
}
