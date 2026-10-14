import { originPattern } from '@productradar/core';
import { browser } from 'wxt/browser';

/**
 * Permisos de sitio OPCIONALES. Se piden solo tras un clic del usuario, sitio
 * por sitio. `requestOrigins` debe llamarse sin `await` previos dentro del
 * manejador del clic para que Chrome reconozca el gesto del usuario.
 */

export const BROAD_ORIGIN = 'https://*/*';

export function originsFor(urls: string[]): string[] {
  return [...new Set(urls.map((u) => originPattern(u)).filter((o): o is string => Boolean(o) && o!.startsWith('https://')))];
}

export async function hasOrigin(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

export async function missingOrigins(origins: string[]): Promise<string[]> {
  const checks = await Promise.all(origins.map(async (o) => ((await hasOrigin(o)) ? null : o)));
  return checks.filter((o): o is string => o !== null);
}

export function requestOrigins(origins: string[]): Promise<boolean> {
  if (origins.length === 0) return Promise.resolve(true);
  return browser.permissions.request({ origins }).catch(() => false);
}

export function hasBroadAccess(): Promise<boolean> {
  return hasOrigin(BROAD_ORIGIN);
}

export function requestBroadAccess(): Promise<boolean> {
  return requestOrigins([BROAD_ORIGIN]);
}

export async function removeBroadAccess(): Promise<void> {
  await browser.permissions.remove({ origins: [BROAD_ORIGIN] }).catch(() => undefined);
}

export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/\*$/, '');
}
