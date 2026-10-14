import { addOfferToReport, buildStoreSearchLinks, getMarketConfig, offerFromSnapshot, safeHref, type ResearchReport } from '@productradar/core';
import { CheckCircle2, ExternalLink, KeyRound, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { money } from '../../lib/format';
import { missingOrigins, requestOrigins } from '../../services/permissions';
import { snapshotActiveTab } from '../../services/tab';
import { Badge, Button, Callout, Card } from '../ui';

type Feedback = { tone: 'ok' | 'warn' | 'error'; text: string };

const CONTEXT_MENU_HINT = 'También puedes hacer clic derecho en la ficha → «Agregar esta ficha a la investigación abierta».';

/**
 * Investigación asistida: el usuario abre la búsqueda de cada tienda en una
 * pestaña nueva, entra a una ficha y la agrega. Solo se lee la pestaña activa
 * tras su clic; las páginas de resultados nunca se descargan.
 */
export function AssistedPanel({ report, onChange }: { report: ResearchReport; onChange: (r: ResearchReport) => void }) {
  const market = getMarketConfig(report.country);
  const links = useMemo(() => buildStoreSearchLinks(report.product, market), [report.product, market]);
  const origins = useMemo(() => [...new Set(links.map((l) => l.origin))], [links]);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let alive = true;
    void missingOrigins(origins).then((missing) => alive && setGranted(missing.length === 0));
    return () => {
      alive = false;
    };
  }, [origins]);

  // Chrome exige el gesto del usuario: la solicitud va sin `await` previos dentro del clic.
  const allow = () => {
    void requestOrigins(origins).then((ok) => setGranted(ok));
  };

  const add = async () => {
    setBusy(true);
    setFeedback(null);
    const tab = await snapshotActiveTab();
    setBusy(false);
    if (!tab.ok) {
      const text =
        tab.reason === 'NO_ACCESS'
          ? `No tengo permiso para leer esta pestaña. Si es una de las tiendas de arriba, pulsa «Permitir lectura en estas tiendas». ${CONTEXT_MENU_HINT}`
          : tab.reason === 'RESTRICTED'
            ? `${tab.message} Abre la ficha del producto en la tienda y vuelve a intentarlo.`
            : tab.message;
      setFeedback({ tone: 'error', text });
      return;
    }
    const { offer, error } = offerFromSnapshot(tab.snapshot, report.product, market, new Date().toISOString());
    if (!offer) {
      setFeedback({ tone: 'warn', text: error ?? 'No fue posible usar esta página.' });
      return;
    }
    onChange(addOfferToReport(report, offer));
    setFeedback(
      offer.evidence.verification === 'PAGE_VERIFIED' && offer.price
        ? { tone: 'ok', text: `Agregada: ${offer.seller} · ${money(offer.price.amount, offer.price.currency, report.country)} (precio verificado en la ficha).` }
        : { tone: 'warn', text: `Agregada sin precio verificado: ${offer.verificationError ?? 'la ficha no publica un precio estructurado'}.` },
    );
  };

  const verified = report.offers.filter((o) => o.evidence.verification === 'PAGE_VERIFIED').length;

  return (
    <Card as="section" className="rise space-y-3 p-3.5">
      <div id="agregar-competidores" className="scroll-mt-14">
        <div className="eyebrow">Investigación asistida</div>
        <h2 className="mt-0.5 text-[16px] font-semibold text-ink">Agregar competidores</h2>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[12.5px] text-ink-2">
          <li>Abre la búsqueda en una tienda.</li>
          <li>Abre una ficha de producto.</li>
          <li>
            Pulsa <strong>«Agregar esta ficha»</strong>.
          </li>
        </ol>
      </div>

      <ul aria-label={`Búsquedas en tiendas de ${market.name}`} className="grid grid-cols-2 gap-1.5">
        {links.map((l) => (
          <li key={l.url}>
            <a
              href={safeHref(l.url)}
              target="_blank"
              rel="noopener noreferrer"
              data-store-host={l.host}
              className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-[12px] font-semibold text-ink no-underline hover:border-accent"
            >
              <span className="min-w-0 leading-tight">{l.store}</span>
              <ExternalLink className="size-3.5 shrink-0 text-accent" aria-hidden />
            </a>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {granted ? (
          <Badge tone="ok">
            <CheckCircle2 className="mr-1 inline size-3" aria-hidden />
            Lectura permitida en estas tiendas
          </Badge>
        ) : (
          <Button size="sm" icon={<KeyRound className="size-3.5" aria-hidden />} onClick={allow}>
            Permitir lectura en estas tiendas
          </Button>
        )}
        <span className="text-[11px] text-muted">Opcional. Solo se lee la ficha que agregas, sin cookies.</span>
      </div>

      <Button variant="primary" className="w-full" icon={<Plus className="size-4" aria-hidden />} onClick={() => void add()} disabled={busy}>
        {busy ? 'Leyendo la ficha…' : 'Agregar esta ficha'}
      </Button>
      <p className="text-center text-[12px] font-semibold text-ink-2" aria-live="polite">
        {report.offers.length} {report.offers.length === 1 ? 'ficha agregada' : 'fichas agregadas'} · {verified} con precio verificado
      </p>
      {feedback && (
        <Callout tone={feedback.tone === 'ok' ? 'info' : feedback.tone === 'warn' ? 'warn' : 'error'} role={feedback.tone === 'ok' ? 'status' : 'alert'}>
          {feedback.text}
        </Callout>
      )}
      <p className="text-[11px] leading-snug text-muted">
        Las ofertas son solo las fichas que agregas tú: una muestra, no todas las tiendas de {market.name}. Los enlaces abren la búsqueda pública de cada tienda en una pestaña nueva; ProductRadar no
        descarga esas páginas. {CONTEXT_MENU_HINT}
      </p>
    </Card>
  );
}
