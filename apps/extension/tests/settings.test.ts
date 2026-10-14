import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, getInstallId, loadSecrets, loadSettings, saveSecrets, saveSettings, serviceStatus } from '../src/services/settings';

describe('ajustes y claves', () => {
  beforeEach(() => fakeBrowser.reset());

  it('por defecto: Colombia, sin claves y sin consentimiento de fotos', async () => {
    const s = await loadSettings();
    expect(s.market).toBe('CO');
    expect(s.photoConsent).toBe(false);
    expect(s.rememberKeys).toBe(false);
    expect(await loadSecrets()).toEqual({});
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

  it('los ajustes guardados no incluyen claves', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'byok' });
    const raw = JSON.stringify(await fakeBrowser.storage.local.get(null));
    expect(raw).not.toMatch(/apiKey|BRAVE/i);
  });

  it('ajustes corruptos vuelven a los valores por defecto', async () => {
    await fakeBrowser.storage.local.set({ 'settings:v1': { market: 'XX', maxQueries: 99 } });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('estado del servicio', () => {
    expect(serviceStatus({ ...DEFAULT_SETTINGS, gatewayUrl: '' }, {}).kind).toBe('unconfigured');
    expect(serviceStatus({ ...DEFAULT_SETTINGS, gatewayUrl: 'http://inseguro.com' }, {}).kind).toBe('unconfigured');
    expect(serviceStatus({ ...DEFAULT_SETTINGS, gatewayUrl: 'https://gw.ejemplo.com/' }, {})).toEqual({ kind: 'gateway', url: 'https://gw.ejemplo.com' });
    expect(serviceStatus({ ...DEFAULT_SETTINGS, mode: 'byok' }, {}).kind).toBe('unconfigured');
    expect(serviceStatus({ ...DEFAULT_SETTINGS, mode: 'byok' }, { braveApiKey: 'k' })).toEqual({ kind: 'byok', hasVision: false });
  });

  it('el identificador de instalación es estable y anónimo', async () => {
    const a = await getInstallId();
    expect(a).toMatch(/^inst_[0-9a-f]{16}$/);
    expect(await getInstallId()).toBe(a);
  });
});
