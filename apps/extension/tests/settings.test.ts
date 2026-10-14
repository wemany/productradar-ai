import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  defaultSettings,
  getInstallId,
  loadSecrets,
  loadSettings,
  saveSecrets,
  saveSettings,
  serviceStatus,
  SettingsSchema,
  type Settings,
} from '../src/services/settings';

const SIN_BUILD = defaultSettings('');
const byok = (patch: Partial<Settings> = {}): Settings => ({ ...SIN_BUILD, mode: 'byok', ...patch });

describe('ajustes y claves', () => {
  beforeEach(() => fakeBrowser.reset());

  it('por defecto: Colombia, sin claves y sin consentimiento de fotos', async () => {
    const s = await loadSettings();
    expect(s.market).toBe('CO');
    expect(s.photoConsent).toBe(false);
    expect(s.rememberKeys).toBe(false);
    expect(s.searchProvider).toBe('tavily');
    expect(await loadSecrets()).toEqual({});
  });

  it('modo por defecto: asistido sin gateway de compilación, gateway si se inyectó una URL', () => {
    expect(defaultSettings('').mode).toBe('assisted');
    expect(defaultSettings('  ').mode).toBe('assisted');
    const conGateway = defaultSettings('https://gw.ejemplo.com');
    expect(conGateway.mode).toBe('gateway');
    expect(conGateway.gatewayUrl).toBe('https://gw.ejemplo.com');
    expect(SettingsSchema.safeParse(SIN_BUILD).success).toBe(true);
    expect(SettingsSchema.safeParse(conGateway).success).toBe(true);
  });

  it('el esquema acepta los tres modos y rechaza otros', () => {
    for (const mode of ['assisted', 'gateway', 'byok']) expect(SettingsSchema.safeParse({ ...SIN_BUILD, mode }).success).toBe(true);
    for (const mode of ['auto', 'BYOK', '', undefined]) expect(SettingsSchema.safeParse({ ...SIN_BUILD, mode }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...SIN_BUILD, searchProvider: 'otro' }).success).toBe(false);
  });

  it('las claves van a storage.session salvo que el usuario pida recordarlas', async () => {
    await saveSecrets({ braveApiKey: 'BRAVE' }, false);
    expect(await fakeBrowser.storage.local.get('secrets:v1')).toEqual({});
    expect((await fakeBrowser.storage.session.get('secrets:v1'))['secrets:v1']).toEqual({ braveApiKey: 'BRAVE' });

    await saveSecrets({ braveApiKey: 'BRAVE' }, true);
    expect((await fakeBrowser.storage.local.get('secrets:v1'))['secrets:v1']).toEqual({ braveApiKey: 'BRAVE' });

    await saveSecrets({ braveApiKey: 'BRAVE' }, false);
    expect(await fakeBrowser.storage.local.get('secrets:v1')).toEqual({});
  });

  it('la clave de Tavily se guarda recortada y vacía se descarta', async () => {
    await saveSecrets({ tavilyApiKey: '  tvly-abc  ', braveApiKey: '' }, false);
    expect(await loadSecrets()).toEqual({ tavilyApiKey: 'tvly-abc' });
  });

  it('los ajustes guardados no incluyen claves', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'byok' });
    const raw = JSON.stringify(await fakeBrowser.storage.local.get(null));
    expect(raw).not.toMatch(/apiKey|BRAVE|tvly/i);
  });

  it('ajustes corruptos vuelven a los valores por defecto', async () => {
    await fakeBrowser.storage.local.set({ 'settings:v1': { market: 'XX', maxQueries: 99 } });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('un usuario previo con gateway sin URL sigue sin configurar (no se cambia su modo)', async () => {
    // Formato anterior: sin `searchProvider`.
    const previo = { version: 1, mode: 'gateway', gatewayUrl: '', market: 'PE', maxQueries: 4, maxPagesToVerify: 5, visionModel: 'modelo-x', rememberKeys: false, photoConsent: true };
    await fakeBrowser.storage.local.set({ 'settings:v1': previo });
    const s = await loadSettings();
    expect(s.mode).toBe('gateway');
    expect(s.market).toBe('PE');
    expect(s.searchProvider).toBe('tavily');
    expect(serviceStatus(s, {})).toEqual({ kind: 'unconfigured', reason: 'No hay un servicio de búsqueda configurado.' });
  });

  it('un usuario previo con solo clave de Brave sigue funcionando', async () => {
    const previo = { version: 1, mode: 'byok', gatewayUrl: '', market: 'CO', maxQueries: 5, maxPagesToVerify: 10, visionModel: 'modelo-x', rememberKeys: true, photoConsent: false };
    await fakeBrowser.storage.local.set({ 'settings:v1': previo });
    await saveSecrets({ braveApiKey: 'k' }, true);
    expect(serviceStatus(await loadSettings(), await loadSecrets())).toEqual({ kind: 'byok', hasVision: false, search: 'brave' });
  });

  it('estado del servicio: asistido y gateway', () => {
    expect(serviceStatus(SIN_BUILD, {})).toEqual({ kind: 'assisted' });
    expect(serviceStatus({ ...SIN_BUILD, mode: 'assisted' }, { braveApiKey: 'k' })).toEqual({ kind: 'assisted' });
    expect(serviceStatus({ ...SIN_BUILD, mode: 'gateway', gatewayUrl: '' }, {}).kind).toBe('unconfigured');
    expect(serviceStatus({ ...SIN_BUILD, mode: 'gateway', gatewayUrl: 'http://inseguro.com' }, {}).kind).toBe('unconfigured');
    expect(serviceStatus({ ...SIN_BUILD, mode: 'gateway', gatewayUrl: 'https://gw.ejemplo.com/' }, {})).toEqual({ kind: 'gateway', url: 'https://gw.ejemplo.com' });
  });

  it('estado del servicio: claves propias con Tavily, con Brave de respaldo o sin claves', () => {
    expect(serviceStatus(byok(), {})).toEqual({ kind: 'unconfigured', reason: 'Falta tu clave de Tavily (gratis) o de Brave Search.' });
    expect(serviceStatus(byok(), { anthropicApiKey: 'a' }).kind).toBe('unconfigured');
    expect(serviceStatus(byok(), { tavilyApiKey: 't' })).toEqual({ kind: 'byok', hasVision: false, search: 'tavily' });
    expect(serviceStatus(byok(), { braveApiKey: 'k' })).toEqual({ kind: 'byok', hasVision: false, search: 'brave' });
    expect(serviceStatus(byok(), { tavilyApiKey: 't', braveApiKey: 'k', anthropicApiKey: 'a' })).toEqual({ kind: 'byok', hasVision: true, search: 'tavily' });
    expect(serviceStatus(byok({ searchProvider: 'brave' }), { tavilyApiKey: 't', braveApiKey: 'k' })).toEqual({ kind: 'byok', hasVision: false, search: 'brave' });
    expect(serviceStatus(byok({ searchProvider: 'brave' }), { tavilyApiKey: 't' })).toEqual({ kind: 'byok', hasVision: false, search: 'tavily' });
  });

  it('el identificador de instalación es estable y anónimo', async () => {
    const a = await getInstallId();
    expect(a).toMatch(/^inst_[0-9a-f]{16}$/);
    expect(await getInstallId()).toBe(a);
  });
});
