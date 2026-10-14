import { getMarketConfig, VERDICT_LABELS, type Market } from '@productradar/core';
import { ArrowLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button } from '../components/ui';
import { dateTime } from '../lib/format';
import { clearHistory, deleteReport, listHistory, type HistoryEntry } from '../services/history';

export function HistoryScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [confirm, setConfirm] = useState(false);

  const refresh = () => void listHistory().then(setEntries);
  useEffect(refresh, []);

  return (
    <div className="space-y-4 pb-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Volver
      </button>
      <div className="flex items-end justify-between gap-2">
        <h1 className="font-serif text-[28px] leading-none text-ink">Mis investigaciones</h1>
        {entries && entries.length > 0 && !confirm && (
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
            Borrar todo
          </Button>
        )}
      </div>
      <p className="text-[12px] text-muted">Guardadas solo en este navegador (máximo 50). Puedes borrarlas cuando quieras.</p>
      {confirm && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-bad/30 bg-bad-soft px-3 py-2.5 text-[12.5px]">
          <span className="flex-1 text-ink">¿Borrar todo el historial? No se puede deshacer.</span>
          <Button size="sm" variant="danger" onClick={() => void clearHistory().then(() => (setConfirm(false), refresh()))}>
            Borrar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
        </div>
      )}
      {entries === null ? null : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[12.5px] text-muted">Aún no hay investigaciones guardadas.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left hover:bg-sunken/40" onClick={() => onOpen(e.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{e.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-muted">
                    {dateTime(e.savedAt, e.country as Market)} · {getMarketConfig(e.country as Market).name}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge tone="neutral">{VERDICT_LABELS[e.verdict]}</Badge>
                    {e.isDemo && <Badge tone="warn">Demo ficticia</Badge>}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={`Borrar ${e.name}`}
                className="mr-2 rounded-lg p-2 text-muted hover:bg-bad-soft hover:text-bad"
                onClick={() => void deleteReport(e.id).then(refresh)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
