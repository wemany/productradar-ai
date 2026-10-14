import { DEFAULT_VISION_MODEL, MarketSchema, normalizeGatewayUrl, randomId } from '@productradar/core';
import { browser } from 'wxt/browser';
import { z } from 'zod';

/**
 * Ajustes NO secretos → chrome.storage.local.
 * Claves (modo claves propias) → chrome.storage.session por defecto (se borran al
 * cerrar Chrome); solo pasan a storage.local si el usuario marca "Recordar".
 * Guardar claves en una extensión NO las protege de quien inspeccione el equipo.
 */

/**
 * Modos de servicio:
 *  - assisted: sin claves; el usuario abre las búsquedas en las tiendas y agrega fichas.
 *  - gateway: búsqueda e IA a través de un gateway (claves fuera de la extensión).
 *  - byok: claves propias guardadas en este navegador (Tavily o Brave + Anthropic opcional).
 */
export const ServiceModeSchema = z.enum(['assisted', 'gateway', 'byok']);
export type ServiceMode = z.infer<typeof ServiceModeSchema>;

export const SearchProviderIdSchema = z.enum(['tavily', 'brave']);
export type SearchProviderId = z.infer<typeof SearchProviderIdSchema>;

/** Orígenes que hay que autorizar para llamar a cada buscador con clave propia. */
export const SEARCH_API_ORIGINS: Record<SearchProviderId, string> = {
  tavily: 'https://api.tavily.com/*',
  brave: 'https://api.search.brave.com/*',
};

export const SettingsSchema = z.object({
  version: z.literal(1),
  mode: ServiceModeSchema,
  gatewayUrl: z.string().max(300),
  searchProvider: SearchProviderIdSchema,
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
  tavilyApiKey: z.string().max(200).optional(),
  braveApiKey: z.string().max(200).optional(),
  anthropicApiKey: z.string().max(300).optional(),
});
export type Secrets = z.infer<typeof SecretsSchema>;

export const BUILD_GATEWAY_URL = typeof __GATEWAY_URL__ === 'string' ? __GATEWAY_URL__ : '';
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';

/**
 * Valores por defecto. Sin gateway inyectado al compilar, el modo inicial es la
 * investigación asistida (no requiere claves). Los ajustes guardados siempre
 * incluyen `mode`, así que este valor no cambia el modo de usuarios existentes.
 */
export function defaultSettings(buildGatewayUrl: string): Settings {
  const url = buildGatewayUrl.trim();
  return {
    version: 1,
    mode: url ? 'gateway' : 'assisted',
    gatewayUrl: url,
    searchProvider: 'tavily',
    market: 'CO',
    maxQueries: 5,
    maxPagesToVerify: 10,
    visionModel: DEFAULT_VISION_MODEL,
    rememberKeys: false,
    photoConsent: false,
  };
}

export const DEFAULT_SETTINGS: Settings = defaultSettings(BUILD_GATEWAY_URL);

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
  | { kind: 'assisted' }
  | { kind: 'gateway'; url: string }
  /** `search` es el buscador que realmente se usará (el elegido o, si falta su clave, el otro). */
  | { kind: 'byok'; hasVision: boolean; search: SearchProviderId }
  | { kind: 'unconfigured'; reason: string };

export function searchApiKey(secrets: Secrets, provider: SearchProviderId): string | undefined {
  return provider === 'tavily' ? secrets.tavilyApiKey : secrets.braveApiKey;
}

export function serviceStatus(settings: Settings, secrets: Secrets): ServiceStatus {
  if (settings.mode === 'assisted') return { kind: 'assisted' };
  if (settings.mode === 'gateway') {
    const url = normalizeGatewayUrl(settings.gatewayUrl);
    return url ? { kind: 'gateway', url } : { kind: 'unconfigured', reason: 'No hay un servicio de búsqueda configurado.' };
  }
  // Si falta la clave del buscador elegido se usa la del otro (usuarios previos solo con Brave).
  const preferred = settings.searchProvider;
  const other: SearchProviderId = preferred === 'tavily' ? 'brave' : 'tavily';
  const search = searchApiKey(secrets, preferred) ? preferred : searchApiKey(secrets, other) ? other : null;
  if (!search) return { kind: 'unconfigured', reason: 'Falta tu clave de Tavily (gratis) o de Brave Search.' };
  return { kind: 'byok', hasVision: Boolean(secrets.anthropicApiKey), search };
}
