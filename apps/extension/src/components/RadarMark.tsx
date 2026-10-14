import { cx } from '../lib/format';

/** Marca de la extensión: anillos de radar con un barrido. `scanning` anima el barrido. */
export function RadarMark({ size = 28, scanning = false, className }: { size?: number; scanning?: boolean; className?: string }) {
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 32 32" width={size} height={size} className="absolute inset-0">
        <rect width="32" height="32" rx="9" fill="#1c1917" />
        <circle cx="16" cy="16" r="10.5" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.2" />
        <circle cx="16" cy="16" r="6.5" fill="none" stroke="#ffffff" strokeOpacity="0.32" strokeWidth="1.2" />
        <circle cx="16" cy="16" r="2.2" fill="#ffffff" />
        <circle cx="22.6" cy="10.4" r="1.7" fill="#a99ff5" />
      </svg>
      <span
        className={cx('absolute inset-[3px] rounded-[7px] [mask-image:radial-gradient(circle,black_62%,transparent_63%)]', scanning ? 'animate-sweep' : '')}
        style={{ background: 'conic-gradient(from 0deg, rgb(169 159 245 / 0.75), transparent 70deg)' }}
      />
    </span>
  );
}

/** Radar grande para la pantalla de progreso. */
export function RadarScope({ size = 120 }: { size?: number }) {
  return (
    <div className="relative shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-0 rounded-full border border-line-strong bg-[radial-gradient(circle,var(--color-surface)_0%,var(--color-paper)_70%)]" />
      {[0.72, 0.46, 0.2].map((s) => (
        <div key={s} className="absolute rounded-full border border-line" style={{ inset: `${((1 - s) / 2) * 100}%` }} />
      ))}
      <div className="absolute top-1/2 left-0 h-px w-full bg-line" />
      <div className="absolute top-0 left-1/2 h-full w-px bg-line" />
      <div
        className="absolute inset-0 animate-sweep rounded-full"
        style={{ background: 'conic-gradient(from 0deg, rgb(85 70 208 / 0.28), rgb(85 70 208 / 0) 80deg)' }}
      />
      <span className="absolute size-2 animate-pulse-dot rounded-full bg-accent" style={{ top: '26%', left: '64%' }} />
      <span className="absolute size-1.5 animate-pulse-dot rounded-full bg-accent [animation-delay:0.5s]" style={{ top: '62%', left: '30%' }} />
      <span className="absolute size-1.5 animate-pulse-dot rounded-full bg-ink-2 [animation-delay:0.9s]" style={{ top: '70%', left: '70%' }} />
    </div>
  );
}
