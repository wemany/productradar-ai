import { DEFAULT_VISION_MODEL, gatewayHealth, normalizeGatewayUrl, type HealthResponse } from '@productradar/core';
import { ArrowLeft, Check, Copy, ExternalLink, Eye, EyeOff, FlaskConical, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Badge, Button, Callout, Card, Field, Segmented, SectionTitle } from '../components/ui';
import type { SettingsState } from '../hooks/useSettings';
import { clearHistory, historyBytes } from '../services/history';
import { hasBroadAccess, removeBroadAccess, requestBroadAccess, requestOrigins } from '../services/permissions';
import { APP_VERSION, clearSecrets, getInstallId, SEARCH_API_ORIGINS, type SearchProviderId } from '../services/settings';

export function SettingsScreen({ state, onBack, onOpenDemo }: { state: SettingsState; onBack: () => void; onOpenDemo: () => void }) {
  const { settings, secrets } = state;
  const [mode, setMode] = useState(settings.mode);
  const [gatewayUrl, setGatewayUrl] = useState(settings.gatewayUrl);
  const [accessCode, setAccessCode] = useState(secrets.accessCode ?? '');
  // Muestra el buscador que realmente se usa (p. ej., usuarios previos solo con clave de Brave).
  const [search, setSearch] = useState<SearchProviderId>(state.status.kind === 'byok' ? state.status.search : settings.searchProvider);
  const [tavily, setTavily] = useState(secrets.tavilyApiKey ?? '');
  const [brave, setBrave] = useState(secrets.braveApiKey ?? '');
  const [anthropic, setAnthropic] = useState(secrets.anthropicApiKey ?? '');
  const [model, setModel] = useState(settings.visionModel);
  const [remember, setRemember] = useState(settings.rememberKeys);
  const [showKeys, setShowKeys] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; data?: HealthResponse; message?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [broad, setBroad] = useState(false);
  const [bytes, setBytes] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copied, setCopied] = useState(false);
  const extensionOrigin = `chrome-extension://${browser.runtime.id}`;

  useEffect(() => {
    void hasBroadAccess().then(setBroad);
    void historyBytes().then(setBytes);
  }, []);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2500);
  };

  const saveService = () => {
    if (mode === 'assisted') {
      void state.updateSettings({ mode: 'assisted' }).then(() => flash('Investigación asistida activada'));
    } else if (mode === 'gateway') {
      const url = normalizeGatewayUrl(gatewayUrl);
      if (gatewayUrl.trim() && !url) return setHealth({ ok: false, message: 'La URL debe empezar por https://' });
      const origin = url && url.startsWith('https://') ? `${new URL(url).origin}/*` : null;
      const permission = origin ? requestOrigins([origin]) : Promise.resolve(true);
      void permission.then(async () => {
        await state.updateSettings({ mode: 'gateway', gatewayUrl: url ?? '', rememberKeys: remember });
        await state.updateSecrets({ ...secrets, accessCode }, remember);
        flash('Servicio guardado');
      });
    } else {
      const key = search === 'tavily' ? tavily : brave;
      if (!key.trim()) return setKeyError(search === 'tavily' ? 'Escribe tu clave de Tavily.' : 'Escribe tu clave de Brave Search.');
      setKeyError(null);
      // Sin `await` antes de pedir el permiso: Chrome exige el gesto del clic.
      const permission = requestOrigins([SEARCH_API_ORIGINS[search], 'https://api.anthropic.com/*']);
      void permission.then(async (granted) => {
        await state.updateSettings({ mode: 'byok', searchProvider: search, visionModel: model.trim() || DEFAULT_VISION_MODEL, rememberKeys: remember });
        await state.updateSecrets({ accessCode, tavilyApiKey: tavily, braveApiKey: brave, anthropicApiKey: anthropic }, remember);
        flash(granted ? 'Claves guardadas' : 'Claves guardadas, pero sin permiso para llamar a las APIs');
      });
    }
  };

  const test = async () => {
    const url = normalizeGatewayUrl(gatewayUrl);
    if (!url) return setHealth({ ok: false, message: 'Escribe una URL https:// válida.' });
    setTesting(true);
    try {
      const data = await gatewayHealth({ baseUrl: url, accessCode, installId: await getInstallId(), timeoutMs: 10_000 });
      setHealth({ ok: true, data });
    } catch (e) {
      setHealth({ ok: false, message: e instanceof Error ? e.message : 'No fue posible conectar' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 pb-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Volver
      </button>
      <h1 className="font-serif text-[28px] leading-none text-ink">Configuración</h1>

      <section className="space-y-3">
        <SectionTitle eyebrow="Búsqueda e IA" title="Servicio" />
        {/* Tres opciones en un panel estrecho: sin íconos para que quepan las etiquetas. */}
        <Segmented
          label="Modo de servicio"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setKeyError(null);
          }}
          options={[
            { value: 'assisted', label: 'Investigación asistida' },
            { value: 'gateway', label: 'Servicio ProductRadar' },
            { value: 'byok', label: 'Claves propias' },
          ]}
        />
        <Card className="space-y-3 p-4">
          {mode === 'assisted' ? (
            <>
              <p className="text-[13px] font-semibold text-ink">Investigación asistida (sin claves)</p>
              <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-muted">
                <li>No necesitas claves ni cuentas.</li>
                <li>Tú abres las búsquedas en las tiendas y agregas las fichas de producto que te interesen: aparecen como «fichas agregadas por ti».</li>
                <li>Los precios se leen solo de las páginas que agregues.</li>
              </ul>
              <Callout title="¿Quieres búsqueda automática en internet?">
                Usa una clave gratuita de Tavily en «Claves propias» o un gateway en «Servicio ProductRadar».
              </Callout>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={saveService}>
                  Guardar
                </Button>
              </div>
            </>
          ) : mode === 'gateway' ? (
            <>
              <p className="text-[12.5px] text-muted">
                Un gateway (Cloudflare Worker) guarda las claves de búsqueda e IA fuera de la extensión. Puedes usar el del proyecto o desplegar el tuyo (ver README).
              </p>
              <Field label="URL del servicio" htmlFor="gw-url" hint="Ej.: https://productradar-gateway.tu-cuenta.workers.dev">
                <input id="gw-url" className="field font-mono text-[12px]" value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} placeholder="https://…" />
              </Field>
              <Field label="Código de acceso" htmlFor="gw-code" optional hint="Solo si el gateway lo exige (acceso de demostración limitado).">
                <input id="gw-code" className="field" type={showKeys ? 'text' : 'password'} value={accessCode} onChange={(e) => setAccessCode(e.target.value)} autoComplete="off" />
              </Field>
              <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Recordar el código en este equipo (si no, se borra al cerrar Chrome)
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={test} loading={testing}>
                  Probar conexión
                </Button>
                <Button size="sm" variant="primary" onClick={saveService}>
                  Guardar
                </Button>
              </div>
              {health &&
                (health.ok && health.data ? (
                  <Callout tone="ok" title="Conectado">
                    Búsqueda: {health.data.providers.search ? 'disponible' : 'sin configurar'} · Visión: {health.data.providers.vision ? 'disponible' : 'sin configurar'}
                    {health.data.accessCodeRequired ? ' · requiere código de acceso' : ''}
                  </Callout>
                ) : (
                  <Callout tone="error" title="No se pudo conectar">
                    {health.message}
                  </Callout>
                ))}
              <div className="rounded-lg bg-paper px-3 py-2 text-[11.5px] text-muted">
                Si despliegas tu propio gateway, autoriza este origen en ALLOWED_ORIGINS:
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-2">{extensionOrigin}</code>
                  <button
                    type="button"
                    aria-label="Copiar origen de la extensión"
                    className="rounded p-1 hover:bg-sunken"
                    onClick={() => {
                      void navigator.clipboard.writeText(extensionOrigin).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Callout tone="warn" title="Solo para uso personal">
                Tus claves de Tavily o Brave (y la de Anthropic) quedan en este navegador: cualquiera con acceso al equipo podría leerlas. No es una forma de ocultar un secreto. No uses este modo para distribuir la extensión; para eso usa un gateway.
              </Callout>
              <Field label="Buscador" htmlFor="k-search">
                <select
                  id="k-search"
                  className="field"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value === 'brave' ? 'brave' : 'tavily');
                    setKeyError(null);
                  }}
                >
                  <option value="tavily">Tavily — recomendado, gratis sin tarjeta</option>
                  <option value="brave">Brave Search</option>
                </select>
              </Field>
              {search === 'tavily' ? (
                <Field
                  label="Clave de Tavily"
                  htmlFor="k-tavily"
                  hint={
                    <>
                      Créala gratis y sin tarjeta en{' '}
                      <a href="https://app.tavily.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold">
                        app.tavily.com <ExternalLink className="size-3" aria-hidden />
                      </a>{' '}
                      · el plan gratuito tiene un cupo mensual de consultas.
                    </>
                  }
                >
                  <input
                    id="k-tavily"
                    className="field font-mono text-[12px]"
                    type={showKeys ? 'text' : 'password'}
                    value={tavily}
                    onChange={(e) => setTavily(e.target.value)}
                    autoComplete="off"
                    aria-invalid={keyError ? true : undefined}
                  />
                </Field>
              ) : (
                <Field label="Clave de Brave Search API" htmlFor="k-brave" hint="api-dashboard.search.brave.com · se cobra por consulta según tu plan.">
                  <input
                    id="k-brave"
                    className="field font-mono text-[12px]"
                    type={showKeys ? 'text' : 'password'}
                    value={brave}
                    onChange={(e) => setBrave(e.target.value)}
                    autoComplete="off"
                    aria-invalid={keyError ? true : undefined}
                  />
                </Field>
              )}
              {keyError && (
                <Callout tone="error" role="alert">
                  {keyError}
                </Callout>
              )}
              <Field label="Clave de Anthropic (visión)" htmlFor="k-anthropic" optional hint="Necesaria solo para identificar fotos.">
                <input id="k-anthropic" className="field font-mono text-[12px]" type={showKeys ? 'text' : 'password'} value={anthropic} onChange={(e) => setAnthropic(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Modelo de visión" htmlFor="k-model">
                <input id="k-model" className="field font-mono text-[12px]" value={model} onChange={(e) => setModel(e.target.value)} />
              </Field>
              <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Recordar en este equipo (si no, se borran al cerrar Chrome)
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={saveService}>
                  Guardar claves
                </Button>
                <Button size="sm" variant="ghost" icon={showKeys ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} onClick={() => setShowKeys((s) => !s)}>
                  {showKeys ? 'Ocultar' : 'Mostrar'}
                </Button>
              </div>
            </>
          )}
          {saved && (
            <p role="status" className="text-[12px] font-semibold text-ok">
              {saved}
            </p>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle eyebrow="Investigación" title="Alcance y costo" />
        <Card className="grid grid-cols-2 gap-3 p-4">
          <Field label="Consultas por investigación" htmlFor="s-q" hint="Cada consulta cuesta dinero al proveedor.">
            <select id="s-q" className="field" value={settings.maxQueries} onChange={(e) => void state.updateSettings({ maxQueries: Number(e.target.value) })}>
              {[3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fichas a verificar" htmlFor="s-p" hint="Lectura directa desde tu navegador.">
            <select id="s-p" className="field" value={settings.maxPagesToVerify} onChange={(e) => void state.updateSettings({ maxPagesToVerify: Number(e.target.value) })}>
              {[0, 5, 10, 15].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle eyebrow="Privacidad" title="Permisos y datos" />
        <Card className="divide-y divide-line">
          <div className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink">Acceso ampliado a sitios</span>
              <Badge tone={broad ? 'accent' : 'neutral'}>{broad ? 'Activado' : 'Desactivado'}</Badge>
            </div>
            <p className="text-[12px] text-muted">
              Opcional. Permite analizar cualquier pestaña y verificar precios sin pedir permiso sitio por sitio. Puedes retirarlo cuando quieras.
            </p>
            <Button
              size="sm"
              icon={<ShieldCheck className="size-3.5" />}
              onClick={() => {
                if (broad) void removeBroadAccess().then(() => setBroad(false));
                else void requestBroadAccess().then(setBroad);
              }}
            >
              {broad ? 'Retirar acceso ampliado' : 'Activar acceso ampliado'}
            </Button>
          </div>
          <div className="space-y-2 p-4">
            <span className="text-[13px] font-semibold text-ink">Historial local</span>
            <p className="text-[12px] text-muted">
              Tus investigaciones solo se guardan en este navegador{bytes !== null ? ` (${(bytes / 1024).toFixed(0)} KB)` : ''}. No se suben a ningún servidor.
            </p>
            {confirmClear ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() =>
                    void clearHistory().then(() => {
                      setConfirmClear(false);
                      setBytes(0);
                      flash('Historial borrado');
                    })
                  }
                >
                  Sí, borrar todo
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
                Borrar historial
              </Button>
            )}
          </div>
          <div className="space-y-2 p-4">
            <span className="text-[13px] font-semibold text-ink">Claves y consentimientos</span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  void clearSecrets().then(() => {
                    void state.updateSecrets({}, false);
                    setTavily('');
                    setBrave('');
                    setAnthropic('');
                    setAccessCode('');
                    flash('Claves borradas');
                  })
                }
              >
                Borrar claves guardadas
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void state.updateSettings({ photoConsent: false }).then(() => flash('Consentimiento de fotos restablecido'))}>
                Restablecer consentimiento de fotos
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <section className="space-y-2 text-center">
        <Button icon={<FlaskConical className="size-4" />} onClick={onOpenDemo}>
          Abrir demostración (datos ficticios)
        </Button>
        <p className="text-[11px] text-muted">ProductRadar AI {APP_VERSION} · Código abierto (MIT)</p>
      </section>
    </div>
  );
}
