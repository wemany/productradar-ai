import { DEFAULT_VISION_MODEL, MarketSchema, normalizeGatewayUrl, randomId } from '@productradar/core';
import { browser } from 'wxt/browser';
import { z } from 'zod';

/**
 * Ajustes NO secretos → chrome.storage.local.
 * Claves (modo desarrollo) → chrome.storage.session por defecto (se borran al
 * cerrar Chrome); solo pasan a storage.local si el usuario marca "Recordar".
 * Guardar claves en una extensión NO las protege de quien inspeccione el equipo.
 */

export const SettingsSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['gateway', 'byok']),
  gatewayUrl: z.string().max(300),
  market: MarketSchema,
  maxQueries: z.number().int().min(3).max(6),
  maxPagesToVerify: z.number().int().min(0).max(15),
  visionModel: z.string().min(1).max(80),
  rememberKeys: z.boolean(),
  photoConsent: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SecretsSchema = z.object({
  accessCode: z.string().max(200).optional(),
  braveApiKey: z.string().max(200).optional(),
  anthropicApiKey: z.string().max(300).optional(),
});
export type Secrets = z.infer<typeof SecretsSchema>;

export const BUILD_GATEWAY_URL = typeof __GATEWAY_URL__ === 'string' ? __GATEWAY_URL__ : '';
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  mode: 'gateway',
  gatewayUrl: BUILD_GATEWAY_URL,
  market: 'CO',
  maxQueries: 5,
  maxPagesToVerify: 10,
  visionModel: DEFAULT_VISION_MODEL,
  rememberKeys: false,
  photoConsent: false,
};

const SETTINGS_KEY = 'settings:v1';
const SECRETS_KEY = 'secrets:v1';
const INSTALL_KEY = 'install:id';

export async function loadSettings(): Promise<Settings> {
  const data = await browser.storage.local.get(SETTINGS_KEY);
  const parsed = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] as object | undefined) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: SettingsSchema.parse(settings) });
}

export async function loadSecrets(): Promise<Secrets> {
  const session = await browser.storage.session.get(SECRETS_KEY);
  const local = await browser.storage.local.get(SECRETS_KEY);
  const parsed = SecretsSchema.safeParse({ ...(local[SECRETS_KEY] as object | undefined), ...(session[SECRETS_KEY] as object | undefined) });
  return parsed.success ? parsed.data : {};
}

export async function saveSecrets(secrets: Secrets, remember: boolean): Promise<void> {
  const clean = SecretsSchema.parse(
    Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, typeof v === 'string' && v.trim() ? v.trim() : undefined])),
  );
  await browser.storage.session.set({ [SECRETS_KEY]: clean });
  if (remember) await browser.storage.local.set({ [SECRETS_KEY]: clean });
  else await browser.storage.local.remove(SECRETS_KEY);
}

export async function clearSecrets(): Promise<void> {
  await browser.storage.session.remove(SECRETS_KEY);
  await browser.storage.local.remove(SECRETS_KEY);
}

/** Identificador anónimo de instalación, solo para cuotas del gateway (no es autenticación). */
export async function getInstallId(): Promise<string> {
  const data = await browser.storage.local.get(INSTALL_KEY);
  const existing = data[INSTALL_KEY];
  if (typeof existing === 'string' && /^[a-z0-9_-]{8,64}$/i.test(existing)) return existing;
  const id = randomId('inst');
  await browser.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

export type ServiceStatus =
  | { kind: 'gateway'; url: string }
  | { kind: 'byok'; hasVision: boolean }
  | { kind: 'unconfigured'; reason: string };

export function serviceStatus(settings: Settings, secrets: Secrets): ServiceStatus {
  if (settings.mode === 'gateway') {
    const url = normalizeGatewayUrl(settings.gatewayUrl);
    return url ? { kind: 'gateway', url } : { kind: 'unconfigured', reason: 'No hay un servicio de búsqueda configurado.' };
  }
  if (!secrets.braveApiKey) return { kind: 'unconfigured', reason: 'Falta tu clave de Brave Search.' };
  return { kind: 'byok', hasVision: Boolean(secrets.anthropicApiKey) };
}
