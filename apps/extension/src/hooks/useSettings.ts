import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, loadSecrets, loadSettings, saveSecrets, saveSettings, serviceStatus, type Secrets, type ServiceStatus, type Settings } from '../services/settings';

export interface SettingsState {
  loaded: boolean;
  settings: Settings;
  secrets: Secrets;
  status: ServiceStatus;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  updateSecrets: (secrets: Secrets, remember: boolean) => Promise<void>;
}

export function useSettings(): SettingsState {
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [secrets, setSecrets] = useState<Secrets>({});
  // Referencia al último valor: evita que dos actualizaciones seguidas se pisen.
  const latest = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void Promise.all([loadSettings(), loadSecrets()]).then(([s, k]) => {
      latest.current = s;
      setSettings(s);
      setSecrets(k);
      setLoaded(true);
    });
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setSettings(next);
    await saveSettings(next);
  }, []);

  const updateSecrets = useCallback(async (next: Secrets, remember: boolean) => {
    setSecrets(next);
    await saveSecrets(next, remember);
  }, []);

  return { loaded, settings, secrets, status: serviceStatus(settings, secrets), updateSettings, updateSecrets };
}
