import {
  checkPublicUrl,
  getMarketConfig,
  identityFromSnapshot,
  identityFromUrlOnly,
  originPattern,
  PageFetchError,
  FETCH_FAILURE_MESSAGES,
  SUPPORTED_MARKETS,
  type Market,
  type ProductIdentity,
} from '@productradar/core';
import { Camera, ChevronRight, Clock, FlaskConical, Globe2, ImageUp, Link2, MousePointerClick, PencilLine, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Badge, Button, Callout, Card, Field, Segmented } from '../components/ui';
import { es } from '../i18n/es';
import { cx, shortDate } from '../lib/format';
import { ExtensionPageFetcher } from '../services/fetcher';
import { listHistory, type HistoryEntry } from '../services/history';
import { fetchImageBlob, ImageInputError, prepareImage, type PreparedImage } from '../services/image';
import { requestOrigins } from '../services/permissions';
import { identifyPhoto, visionProviderLabel } from '../services/providers';
import type { Secrets, ServiceStatus, Settings } from '../services/settings';
import { analyzeActiveTab } from '../services/tab';
import { VERDICT_LABELS } from '@productradar/core';

export type HomeTab = 'page' | 'url' | 'photo';

interface HomeProps {
  market: Market;
  onMarketChange: (m: Market) => void;
  status: ServiceStatus;
  settings: Settings;
  secrets: Secrets;
  notice?: string;
  initialTab?: HomeTab;
  initialUrl?: string;
  initialImageUrl?: string;
  onIdentity: (identity: ProductIdentity) => void;
  onOpenDemo: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenReport: (id: string) => void;
  onPhotoConsent: () => void;
}

export function HomeScreen(props: HomeProps) {
  const [tab, setTab] = useState<HomeTab>(props.initialTab ?? 'page');
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const country = getMarketConfig(props.market);

  useEffect(() => {
    void listHistory().then((h) => setRecent(h.slice(0, 3)));
  }, []);
  useEffect(() => {
    if (props.initialTab) setTab(props.initialTab);
  }, [props.initialTab]);

  return (
    <div className="space-y-5">
      <section className="rise pt-1">
        <h1 className="font-serif text-[30px] leading-[1.05] tracking-[-0.01em] text-ink">
          ¿Vale la pena <em className="text-accent">venderlo</em>?
        </h1>
        <p className="mt-2 text-[13px] text-muted">
          Identifica el producto, revisa quién lo vende en {country.name} y a cuánto, y calcula tu margen con fuentes que puedes abrir.
        </p>
      </section>

      {props.notice && (
        <Callout tone="warn" role="alert">
          {props.notice}
        </Callout>
      )}

      {props.status.kind === 'unconfigured' && (
        <Card className="rise overflow-hidden">
          <div className="grain border-b border-line bg-sunken/50 px-4 py-3">
            <div className="eyebrow">Configuración pendiente</div>
            <p className="mt-1 text-[13px] text-ink-2">
              Para buscar competencia real necesitas un servicio de búsqueda. Puedes identificar productos y probar la demostración sin configurar nada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 p-3">
            <Button variant="primary" size="sm" icon={<Settings2 className="size-3.5" />} onClick={props.onOpenSettings}>
              Configurar servicio
            </Button>
            <Button size="sm" icon={<FlaskConical className="size-3.5" />} onClick={props.onOpenDemo}>
              {es.home.demo}
            </Button>
          </div>
        </Card>
      )}

      {props.status.kind === 'assisted' && (
        <Callout tone="info" title="Investigación asistida (sin claves)">
          Te daremos enlaces a la búsqueda de cada tienda y tú agregas las fichas que elijas; solo se leen esas páginas. Para búsqueda automática en internet, usa una clave gratuita de Tavily o
          un servicio ProductRadar en{' '}
          <Button variant="link" className="text-[12.5px]" onClick={props.onOpenSettings}>
            Configuración
          </Button>
          .
        </Callout>
      )}

      <Card className="rise space-y-4 p-4 [animation-delay:60ms]">
        <Field label={es.home.market} htmlFor="market">
          <div className="relative">
            <Globe2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <select id="market" className="field appearance-none pl-9" value={props.market} onChange={(e) => props.onMarketChange(e.target.value as Market)}>
              {SUPPORTED_MARKETS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name} ({m.currency}){m.code === 'CO' ? '' : ' · beta'}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <Segmented<HomeTab>
          label="Forma de entrada"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'page', label: es.home.tabs.page, icon: <MousePointerClick className="size-3.5" aria-hidden /> },
            { value: 'url', label: es.home.tabs.url, icon: <Link2 className="size-3.5" aria-hidden /> },
            { value: 'photo', label: es.home.tabs.photo, icon: <Camera className="size-3.5" aria-hidden /> },
          ]}
        />

        <div role="tabpanel">
          {tab === 'page' && <PageTab market={props.market} onIdentity={props.onIdentity} onOpenSettings={props.onOpenSettings} />}
          {tab === 'url' && <UrlTab market={props.market} initialUrl={props.initialUrl} onIdentity={props.onIdentity} />}
          {tab === 'photo' && (
            <PhotoTab
              market={props.market}
              settings={props.settings}
              secrets={props.secrets}
              initialImageUrl={props.initialImageUrl}
              onIdentity={props.onIdentity}
              onOpenSettings={props.onOpenSettings}
              onConsent={props.onPhotoConsent}
            />
          )}
        </div>
      </Card>

      <button
        type="button"
        onClick={() => props.onIdentity({ name: '', attributes: {}, searchQueries: [], uncertainties: [], identifiedBy: 'USER_INPUT' })}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3 text-left text-[12.5px] text-ink-2 transition-colors hover:border-ink/30 hover:bg-surface"
      >
        <PencilLine className="size-4 text-muted" aria-hidden />
        <span className="flex-1">¿Ya sabes qué producto es? Escríbelo tú mismo</span>
        <ChevronRight className="size-4 text-muted" aria-hidden />
      </button>

      <section aria-labelledby="recent-title" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 id="recent-title" className="eyebrow">
            {es.nav.history}
          </h2>
          <Button variant="link" className="text-[12px]" onClick={props.onOpenHistory}>
            Ver todas
          </Button>
        </div>
        {recent.length === 0 ? (
          <p className="text-[12.5px] text-muted">Aún no tienes investigaciones guardadas en este equipo.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => props.onOpenReport(r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-sunken/40">
                  <Clock className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
                    <span className="text-[11.5px] text-muted">
                      {shortDate(r.savedAt)} · {r.country} · {VERDICT_LABELS[r.verdict]}
                    </span>
                  </span>
                  {r.isDemo && <Badge tone="warn">Demo</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {props.status.kind !== 'unconfigured' && (
        <div className="text-center">
          <Button variant="link" className="text-[12px]" onClick={props.onOpenDemo}>
            {es.home.demo}
          </Button>
        </div>
      )}
    </div>
  );
}

function PageTab({ market, onIdentity, onOpenSettings }: { market: Market; onIdentity: (i: ProductIdentity) => void; onOpenSettings: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ reason: string; message: string } | null>(null);
  const analyze = async () => {
    setBusy(true);
    setError(null);
    const result = await analyzeActiveTab(getMarketConfig(market).currency);
    setBusy(false);
    if (result.ok) onIdentity(result.identity);
    else setError({ reason: result.reason, message: result.message });
  };
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Leemos solo los datos públicos del producto en la pestaña activa (nombre, imagen, marca, precio) y únicamente cuando presionas el botón.
      </p>
      <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={analyze}>
        Analizar esta página
      </Button>
      {error && (
        <Callout tone="warn" role="alert" title={error.message}>
          {error.reason === 'NO_ACCESS' && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>
                Haz <b>clic derecho</b> en la página → <i>Investigar este producto con ProductRadar</i>.
              </li>
              <li>O vuelve a hacer clic en el ícono de ProductRadar en la barra y presiona «Analizar esta página».</li>
              <li>
                O activa el acceso a sitios en{' '}
                <button type="button" className="font-semibold text-accent underline" onClick={onOpenSettings}>
                  Configuración
                </button>
                .
              </li>
            </ul>
          )}
        </Callout>
      )}
    </div>
  );
}

function UrlTab({ market, initialUrl, onIdentity }: { market: Market; initialUrl?: string; onIdentity: (i: ProductIdentity) => void }) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  const submit = () => {
    setError(null);
    const trimmed = url.trim();
    const safety = checkPublicUrl(trimmed);
    if (!safety.ok) {
      setError(trimmed ? `URL no válida: ${safety.reason}. Usa una dirección https:// pública.` : 'Pega la dirección de una ficha de producto.');
      return;
    }
    const origin = originPattern(trimmed);
    // El permiso se pide de inmediato, dentro del clic (requisito de Chrome).
    const permission = origin ? requestOrigins([origin]) : Promise.resolve(false);
    setBusy(true);
    void permission.then(async (granted) => {
      try {
        if (!granted) {
          onIdentity(identityFromUrlOnly(trimmed, 'No concediste permiso para leer el sitio: no verificamos la página.'));
          return;
        }
        const snapshot = await new ExtensionPageFetcher().fetchSnapshot(trimmed);
        onIdentity(identityFromSnapshot(snapshot, getMarketConfig(market).currency));
      } catch (e) {
        const reason = e instanceof PageFetchError ? FETCH_FAILURE_MESSAGES[e.kind] : 'No fue posible leer la página';
        onIdentity(identityFromUrlOnly(trimmed, `${reason}: no verificamos la página.`));
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="URL de la ficha de producto" htmlFor="product-url" hint="Chrome te pedirá permiso para leer ese sitio una sola vez. Sin cookies ni tu sesión.">
        <input
          id="product-url"
          className="field"
          type="url"
          inputMode="url"
          placeholder="https://tienda.com/producto/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'url-error' : undefined}
        />
      </Field>
      {error && (
        <p id="url-error" role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      )}
      <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={submit}>
        {es.home.analyze}
      </Button>
    </form>
  );
}

function PhotoTab({
  market,
  settings,
  secrets,
  initialImageUrl,
  onIdentity,
  onOpenSettings,
  onConsent,
}: {
  market: Market;
  settings: Settings;
  secrets: Secrets;
  initialImageUrl?: string;
  onIdentity: (i: ProductIdentity) => void;
  onOpenSettings: () => void;
  onConsent: () => void;
}) {
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(settings.photoConsent);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const provider = visionProviderLabel(settings, secrets);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const load = async (blob: Blob) => {
    setError(null);
    try {
      setImage(await prepareImage(blob));
    } catch (e) {
      setError(e instanceof ImageInputError ? e.message : 'No se pudo procesar la imagen.');
    }
  };

  const loadFromUrl = () => {
    if (!initialImageUrl) return;
    const origin = originPattern(initialImageUrl);
    const permission = origin ? requestOrigins([origin]) : Promise.resolve(false);
    void permission.then(async (granted) => {
      if (!granted) return setError('Sin permiso para descargar la imagen de ese sitio.');
      try {
        await load(await fetchImageBlob(initialImageUrl));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo descargar la imagen.');
      }
    });
  };

  const identify = async () => {
    if (!image) return;
    setBusy(true);
    setError(null);
    controllerRef.current = new AbortController();
    try {
      onIdentity(await identifyPhoto(settings, secrets, { base64: image.base64, mimeType: image.mimeType }, market, controllerRef.current.signal));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible identificar la foto.');
    } finally {
      setBusy(false);
    }
  };

  if (!provider) {
    return (
      <Callout tone="info" title="La identificación por foto requiere un proveedor de visión">
        Configura el servicio de ProductRadar o tu clave de Anthropic. El análisis por página o URL funciona sin visión.{' '}
        <button type="button" className="font-semibold text-accent underline" onClick={onOpenSettings}>
          Ir a configuración
        </button>
      </Callout>
    );
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void load(file);
  };
  const onPaste = (e: ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files)[0];
    if (file) void load(file);
  };

  return (
    <div className="space-y-3" onPaste={onPaste}>
      {initialImageUrl && !image && (
        <Callout tone="info" title="Imagen seleccionada en la página">
          <Button size="sm" className="mt-2" onClick={loadFromUrl}>
            Cargar esta imagen
          </Button>
        </Callout>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'relative flex min-h-[148px] flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed p-4 text-center transition-colors',
          dragging ? 'border-accent bg-accent-soft/50' : 'border-line-strong bg-paper',
        )}
      >
        {image ? (
          <img src={image.previewUrl} alt="Vista previa de la foto" className="max-h-44 rounded-lg object-contain" />
        ) : (
          <>
            <ImageUp className="size-6 text-muted" aria-hidden />
            <p className="text-[12.5px] text-ink-2">Arrastra una foto, pégala o elígela</p>
            <p className="text-[11px] text-muted">PNG, JPG o WEBP · hasta 15 MB · se comprime en tu equipo</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          id="photo-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(file);
            e.target.value = '';
          }}
        />
        <Button size="sm" onClick={() => inputRef.current?.click()}>
          {image ? 'Cambiar foto' : 'Elegir foto'}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-[12px] text-ink-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--color-accent)]"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (e.target.checked) onConsent();
          }}
        />
        <span>
          Acepto enviar esta foto a {provider} para identificar el producto. No se guarda en el servidor de ProductRadar.
        </span>
      </label>
      {error && (
        <p role="alert" className="text-[12px] text-bad">
          {error}
        </p>
      )}
      <Button variant="primary" size="lg" className="w-full" disabled={!image || !consent} loading={busy} onClick={identify}>
        Identificar producto
      </Button>
    </div>
  );
}
