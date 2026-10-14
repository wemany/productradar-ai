import { buildAlibabaQuery, buildMarketQueries, getMarketConfig, suggestedAttributes, SUPPORTED_MARKETS, type Market, type ProductIdentity } from '@productradar/core';
import { ArrowLeft, Check, FlaskConical, Package, Plus, Search, Settings2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DemoStamp } from '../components/DemoBanner';
import { Badge, Button, Callout, Card, Disclosure, Field } from '../components/ui';
import { es } from '../i18n/es';
import { money } from '../lib/format';
import type { ServiceStatus } from '../services/settings';

interface ConfirmProps {
  draft: ProductIdentity;
  demo: boolean;
  market: Market;
  maxQueries: number;
  status: ServiceStatus;
  onMarketChange: (m: Market) => void;
  onBack: () => void;
  onSubmit: (identity: ProductIdentity, market: Market) => void;
  onOpenSettings: () => void;
  onOpenDemo: () => void;
}

/** Atributos de medida sugeridos a partir del nombre (se recalculan al elegir otra variante). */
const MEASURE_KEYS = new Set(['Capacidad', 'Volumen', 'Peso/contenido', 'Unidades por paquete', 'Pantalla', 'Batería']);

interface AttrRow {
  key: string;
  value: string;
}

export function ConfirmScreen(props: ConfirmProps) {
  const { draft } = props;
  const [name, setName] = useState(draft.name);
  const [brand, setBrand] = useState(draft.brand ?? '');
  const [model, setModel] = useState(draft.model ?? '');
  const [gtin, setGtin] = useState(draft.gtin ?? '');
  const [englishName, setEnglishName] = useState(draft.englishName ?? '');
  const [rows, setRows] = useState<AttrRow[]>(Object.entries(draft.attributes).map(([key, value]) => ({ key, value })));
  const [uncertainties, setUncertainties] = useState(draft.uncertainties);
  const [queriesText, setQueriesText] = useState<string | null>(draft.searchQueries.length ? draft.searchQueries.join('\n') : null);
  const [touched, setTouched] = useState(false);
  const [skuCleared, setSkuCleared] = useState(false);
  const country = getMarketConfig(props.market);

  const identity: ProductIdentity = useMemo(() => {
    const attributes: Record<string, string> = {};
    for (const r of rows) if (r.key.trim() && r.value.trim()) attributes[r.key.trim()] = r.value.trim();
    return {
      ...draft,
      name: name.trim(),
      brand: brand.trim() || undefined,
      model: model.trim() || undefined,
      gtin: gtin.trim() || undefined,
      sku: skuCleared ? undefined : draft.sku,
      englishName: englishName.trim() || undefined,
      attributes,
      uncertainties,
      searchQueries: [],
    };
  }, [draft, name, brand, model, gtin, englishName, rows, uncertainties, skuCleared]);

  const generatedQueries = useMemo(() => (identity.name ? buildMarketQueries(identity, country, props.maxQueries) : []), [identity, country, props.maxQueries]);
  const nameError = touched && name.trim().length < 2 ? 'Escribe el nombre del producto.' : null;
  const gtinError = gtin.trim() && !/^\d{8,14}$/.test(gtin.trim()) ? 'El GTIN/EAN tiene entre 8 y 14 dígitos.' : null;
  const unconfigured = props.status.kind === 'unconfigured' && !props.demo;

  const submit = () => {
    setTouched(true);
    if (name.trim().length < 2 || gtinError || unconfigured) return;
    const edited = queriesText
      ?.split('\n')
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 6);
    props.onSubmit({ ...identity, searchQueries: edited && edited.length ? edited : [] }, props.market);
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={props.onBack} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> {es.nav.back}
      </button>

      <Card className="rise overflow-hidden">
        <div className="flex gap-3 border-b border-line p-4">
          <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-paper">
            {draft.imageUrl ? (
              <img src={draft.imageUrl} alt="" className="size-full object-contain" referrerPolicy="no-referrer" />
            ) : (
              <Package className="size-7 text-faint" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="eyebrow">{es.confirm.eyebrow}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={draft.identifiedBy === 'VISION_AI' || draft.identifiedBy === 'URL_SLUG' ? 'warn' : 'accent'}>{es.identifiedBy[draft.identifiedBy]}</Badge>
              {props.demo && <DemoStamp />}
            </div>
            {draft.sourcePrice && (
              <p className="mt-1.5 text-[11.5px] text-muted">
                Precio en la página de origen: <span className="num font-semibold text-ink-2">{money(draft.sourcePrice.amount, draft.sourcePrice.currency, props.market)}</span>{' '}
                (solo referencia, no es tu costo)
              </p>
            )}
            {draft.confidence !== undefined && draft.identifiedBy === 'VISION_AI' && (
              <p className="mt-1 text-[11.5px] text-muted">Certeza estimada por la IA: {Math.round(draft.confidence * 100)} %</p>
            )}
          </div>
        </div>

        {draft.alternatives && draft.alternatives.length > 0 && (
          <div className="border-b border-line bg-paper px-4 py-3">
            <div className="text-[12px] font-semibold text-ink-2">¿O quizás es uno de estos?</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft.alternatives.map((alt) => (
                <button
                  key={alt.name}
                  type="button"
                  onClick={() => {
                    setName(alt.name);
                    setBrand(alt.brand ?? '');
                    setModel(alt.model ?? '');
                    // Los códigos y medidas de la variante original ya no aplican.
                    setGtin('');
                    setSkuCleared(true);
                    setRows((r) => [
                      ...r.filter((x) => !MEASURE_KEYS.has(x.key)),
                      ...Object.entries(suggestedAttributes(alt.name)).map(([key, value]) => ({ key, value })),
                    ]);
                  }}
                  className="rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[12px] text-ink-2 hover:border-accent hover:text-accent-ink"
                >
                  {alt.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 p-4">
          {uncertainties.length > 0 && (
            <Callout tone="warn" title="Revisa antes de buscar">
              <ul className="mt-1 space-y-1">
                {uncertainties.map((u) => (
                  <li key={u} className="flex items-start justify-between gap-2">
                    <span>{u}</span>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
                      onClick={() => setUncertainties((list) => list.filter((x) => x !== u))}
                      aria-label={`Marcar como revisado: ${u}`}
                    >
                      <Check className="size-3" aria-hidden /> Revisado
                    </button>
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          <Field label="Nombre del producto" htmlFor="p-name">
            <input
              id="p-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Ej.: Audífonos inalámbricos de diadema"
              aria-invalid={Boolean(nameError)}
              autoFocus={!draft.name}
            />
          </Field>
          {nameError && (
            <p role="alert" className="-mt-2 text-[12px] text-bad">
              {nameError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marca" htmlFor="p-brand" optional>
              <input id="p-brand" className="field" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Sin marca" />
            </Field>
            <Field label="Modelo" htmlFor="p-model" optional>
              <input id="p-model" className="field" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Ej.: WH-1000XM5" />
            </Field>
          </div>
          <Field label="GTIN / EAN" htmlFor="p-gtin" optional hint={gtinError ?? 'Código de barras: mejora la precisión de la comparación.'}>
            <input id="p-gtin" className="field num" inputMode="numeric" value={gtin} onChange={(e) => setGtin(e.target.value.replace(/\D/g, ''))} aria-invalid={Boolean(gtinError)} />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-semibold text-ink-2">Atributos que definen la presentación</legend>
            <p className="text-[11.5px] text-muted">Capacidad, volumen, talla, color, unidades por paquete… Si una ficha indica otro valor, no se compara como el mismo producto.</p>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  aria-label={`Atributo ${i + 1}`}
                  className="field w-[42%]"
                  value={row.key}
                  placeholder="Atributo"
                  onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                />
                <input
                  aria-label={`Valor del atributo ${i + 1}`}
                  className="field flex-1"
                  value={row.value}
                  placeholder="Valor"
                  onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <button type="button" aria-label="Quitar atributo" className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setRows((r) => [...r, { key: '', value: '' }])}>
              Añadir atributo
            </Button>
          </fieldset>

          <Disclosure summary="Búsqueda avanzada (consultas y Alibaba)">
            <div className="space-y-3">
              <Field label="Nombre en inglés (para Alibaba)" htmlFor="p-en" optional hint={`Consulta: ${buildAlibabaQuery(identity)}`}>
                <input id="p-en" className="field" value={englishName} onChange={(e) => setEnglishName(e.target.value)} placeholder="Ej.: wireless over-ear headphones" />
              </Field>
              <Field
                label="Consultas en el buscador"
                htmlFor="p-queries"
                hint={queriesText === null ? 'Generadas automáticamente a partir de los datos. Edítalas si quieres (una por línea, máx. 6).' : 'Consultas personalizadas.'}
              >
                <textarea
                  id="p-queries"
                  rows={Math.max(3, generatedQueries.length)}
                  className="field font-mono text-[11.5px] leading-relaxed"
                  value={queriesText ?? generatedQueries.join('\n')}
                  onChange={(e) => setQueriesText(e.target.value)}
                />
              </Field>
              {queriesText !== null && (
                <Button size="sm" variant="ghost" onClick={() => setQueriesText(null)}>
                  Volver a las consultas automáticas
                </Button>
              )}
            </div>
          </Disclosure>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <Field label={es.home.market} htmlFor="confirm-market">
          <select id="confirm-market" className="field" value={props.market} onChange={(e) => props.onMarketChange(e.target.value as Market)}>
            {SUPPORTED_MARKETS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name} ({m.currency})
              </option>
            ))}
          </select>
        </Field>
        {unconfigured && (
          <Callout tone="info" title="Falta configurar el buscador">
            Para buscar competencia real configura el servicio o tu clave de Brave Search.
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" icon={<Settings2 className="size-3.5" />} onClick={props.onOpenSettings}>
                Configurar
              </Button>
              <Button size="sm" variant="ghost" icon={<FlaskConical className="size-3.5" />} onClick={props.onOpenDemo}>
                Ver demostración
              </Button>
            </div>
          </Callout>
        )}
        <Button variant="primary" size="lg" className="w-full" icon={<Search className="size-4" aria-hidden />} onClick={submit} disabled={unconfigured}>
          {es.confirm.search(country.name)}
        </Button>
        <p className="text-center text-[11px] text-muted">
          Consultaremos un buscador web y leeremos fichas públicas con tu permiso. La cobertura es una muestra, no todas las tiendas del país.
        </p>
      </Card>
    </div>
  );
}
