import { FlaskConical } from 'lucide-react';
import { es } from '../i18n/es';

/** Marca persistente e inequívoca del modo demostración. */
export function DemoBanner() {
  return (
    <div role="status" aria-live="polite" className="sticky top-0 z-30">
      <div className="demo-stripes h-1.5" aria-hidden />
      <div className="flex items-center justify-center gap-2 bg-demo px-3 py-1.5 text-center text-demo-ink">
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        <span className="font-mono text-[11px] font-medium tracking-[0.1em]">{es.demo.banner}</span>
        <span className="text-[11px] font-semibold opacity-80">· {es.demo.detail}</span>
      </div>
    </div>
  );
}

/** Sello para tarjetas y secciones en modo demo. */
export function DemoStamp() {
  return (
    <span className="inline-flex -rotate-2 items-center rounded border-2 border-demo-ink/70 px-1.5 py-[1px] font-mono text-[9.5px] font-medium tracking-[0.12em] text-demo-ink/80 uppercase">
      Ficticio
    </span>
  );
}
