import { MATCH_LABELS, MODULE_LABELS, MODULE_ORDER, type ModuleStatus, type ResearchReport } from '@productradar/core';
import { AlertTriangle, Check, CircleDashed, Minus, ShieldCheck, X } from 'lucide-react';
import { RadarScope } from '../components/RadarMark';
import { Badge, Button, Card } from '../components/ui';
import { es } from '../i18n/es';
import { cx, money, plural } from '../lib/format';
import type { PermissionPrompt } from '../hooks/useResearch';
import { hostOf, requestOrigins } from '../services/permissions';

const STATUS_ICON: Record<ModuleStatus, { icon: typeof Check; cls: string }> = {
  PENDING: { icon: CircleDashed, cls: 'text-faint' },
  RUNNING: { icon: CircleDashed, cls: 'text-accent animate-spin [animation-duration:2.5s]' },
  OK: { icon: Check, cls: 'text-ok' },
  PARTIAL: { icon: AlertTriangle, cls: 'text-warn' },
  FAILED: { icon: X, cls: 'text-bad' },
  SKIPPED: { icon: Minus, cls: 'text-muted' },
};

interface ProgressProps {
  productName: string;
  report: ResearchReport | null;
  prompt: PermissionPrompt | null;
  onCancel: () => void;
}

export function ProgressScreen({ productName, report, prompt, onCancel }: ProgressProps) {
  const offers = report?.offers ?? [];
  const verified = offers.filter((o) => o.evidence.verification === 'PAGE_VERIFIED').length;

  return (
    <div className="space-y-4">
      <div className="rise flex items-center gap-4 pt-1">
        <RadarScope size={92} />
        <div className="min-w-0">
          <div className="eyebrow">Investigando</div>
          <h1 className="mt-1 line-clamp-2 font-serif text-[22px] leading-[1.1] text-ink">{productName}</h1>
          <p className="mt-1 text-[12px] text-muted" aria-live="polite">
            {plural(offers.length, 'página candidata', 'páginas candidatas')} · {plural(verified, 'precio verificado', 'precios verificados')}
          </p>
        </div>
      </div>

      {prompt && <PermissionCard prompt={prompt} />}

      <Card className="p-2">
        <ol aria-label="Etapas de la investigación">
          {MODULE_ORDER.map((key, i) => {
            const state = report?.modules[key] ?? { status: 'PENDING' as ModuleStatus };
            const { icon: Icon, cls } = STATUS_ICON[state.status];
            return (
              <li key={key} className={cx('flex gap-3 rounded-lg px-2.5 py-2', state.status === 'RUNNING' && 'bg-accent-soft/50')}>
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                  <Icon className={cx('size-4', cls)} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cx('text-[13px] font-medium', state.status === 'PENDING' ? 'text-muted' : 'text-ink')}>
                      <span className="mr-1.5 font-mono text-[10.5px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                      {MODULE_LABELS[key]}
                    </span>
                    <span className="sr-only">{es.moduleStatus[state.status]}</span>
                  </div>
                  {state.message && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{state.message}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {offers.length > 0 && (
        <section aria-labelledby="partial-title" className="space-y-2">
          <h2 id="partial-title" className="eyebrow">
            Hallazgos hasta ahora
          </h2>
          <ul className="space-y-1.5">
            {offers.slice(0, 6).map((o) => (
              <li key={o.id} className="rise flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{o.seller}</span>
                  <span className="text-[11px] text-muted">{MATCH_LABELS[o.matchType]}</span>
                </span>
                {o.price ? (
                  <span className="text-right">
                    <span className="num block text-[12.5px] font-semibold">{money(o.price.amount, o.price.currency, report?.country)}</span>
                    <span className={cx('text-[10.5px]', o.evidence.verification === 'PAGE_VERIFIED' ? 'text-ok' : 'text-muted')}>{es.verification[o.evidence.verification]}</span>
                  </span>
                ) : (
                  <Badge>Sin precio</Badge>
                )}
              </li>
            ))}
          </ul>
          {offers.length > 6 && <p className="text-[11.5px] text-muted">y {offers.length - 6} más…</p>}
        </section>
      )}

      <Button className="w-full" onClick={onCancel}>
        Cancelar
      </Button>
      <p className="text-center text-[11px] text-muted">Si cancelas, conservarás los resultados parciales reales obtenidos hasta ese momento.</p>
    </div>
  );
}

function PermissionCard({ prompt }: { prompt: PermissionPrompt }) {
  const hosts = prompt.origins.map(hostOf);
  return (
    <Card className="rise border-accent-line p-4 shadow-[var(--shadow-lift)]">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 space-y-2">
          <h2 className="text-[14px] font-semibold text-ink">Verificar precios en las fichas</h2>
          <p className="text-[12.5px] text-ink-2">
            Para confirmar precios necesitamos leer {plural(hosts.length, 'sitio público', 'sitios públicos')}. Solo leemos los datos del producto, sin cookies ni tu sesión, y
            puedes retirar el permiso cuando quieras.
          </p>
          <ul className="flex flex-wrap gap-1">
            {hosts.slice(0, 8).map((h) => (
              <li key={h}>
                <Badge tone="outline" mono>
                  {h}
                </Badge>
              </li>
            ))}
            {hosts.length > 8 && <li className="text-[11px] text-muted">y {hosts.length - 8} más</li>}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                // Llamada directa dentro del clic: requisito de Chrome para pedir permisos.
                void requestOrigins(prompt.origins).then(prompt.resolve);
              }}
            >
              Permitir y verificar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => prompt.resolve(false)}>
              Continuar sin verificar
            </Button>
          </div>
          <p className="text-[11px] text-muted">Sin verificación, los precios del buscador se muestran aparte y no entran en mínimo, mediana ni máximo.</p>
        </div>
      </div>
    </Card>
  );
}
