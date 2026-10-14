import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib/format';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-white hover:bg-ink-2 active:translate-y-px shadow-[0_1px_0_rgb(255_255_255/0.08)_inset,0_6px_16px_-10px_rgb(28_25_23/0.7)] disabled:bg-faint',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-ink/40 hover:bg-sunken/40 disabled:text-faint',
  ghost: 'text-ink-2 hover:bg-sunken disabled:text-faint',
  danger: 'bg-surface text-bad border border-bad/30 hover:bg-bad-soft',
  link: 'text-accent hover:text-accent-ink underline-offset-2 hover:underline px-0 py-0',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  const sizes = { sm: 'h-8 px-3 text-[12.5px] gap-1.5', md: 'h-10 px-4 text-[13.5px] gap-2', lg: 'h-12 px-5 text-[14.5px] gap-2' };
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-[10px] font-semibold tracking-[-0.005em] transition-[background,border,color,transform] duration-150 select-none',
        variant !== 'link' && sizes[size],
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('inline-flex size-9 items-center justify-center rounded-[10px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'outline';
const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  outline: 'border border-line-strong text-ink-2',
};

export function Badge({ tone = 'neutral', children, className, mono }: { tone?: Tone; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] leading-[1.45] font-semibold whitespace-nowrap',
        mono && 'font-mono text-[10px] font-medium tracking-[0.04em] uppercase',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <Tag className={cx('card', className)}>{children}</Tag>;
}

export function SectionTitle({ eyebrow, title, action, id }: { eyebrow?: string; title: string; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="eyebrow mb-0.5">{eyebrow}</div>}
        <h2 id={id} className="text-[16px] leading-tight font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

const CALLOUT = {
  info: { icon: Info, cls: 'border-accent-line bg-accent-soft/60 text-ink-2', iconCls: 'text-accent' },
  warn: { icon: AlertTriangle, cls: 'border-warn/25 bg-warn-soft text-ink-2', iconCls: 'text-warn' },
  error: { icon: XCircle, cls: 'border-bad/25 bg-bad-soft text-ink-2', iconCls: 'text-bad' },
  ok: { icon: CheckCircle2, cls: 'border-ok/25 bg-ok-soft text-ink-2', iconCls: 'text-ok' },
};

export function Callout({ tone = 'info', title, children, className, role }: { tone?: keyof typeof CALLOUT; title?: string; children?: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  const { icon: Icon, cls, iconCls } = CALLOUT[tone];
  return (
    <div role={role} className={cx('flex gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px] leading-[1.5]', cls, className)}>
      <Icon className={cx('mt-[1px] size-4 shrink-0', iconCls)} aria-hidden />
      <div className="min-w-0">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor, optional }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor: string; optional?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-[12px] font-semibold text-ink-2">
        <span>{label}</span>
        {optional && <span className="font-normal text-muted">opcional</span>}
      </label>
      {children}
      {hint && <div className="text-[11.5px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="grid gap-1 rounded-[12px] bg-sunken p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              const idx = options.findIndex((o) => o.value === value);
              if (e.key === 'ArrowRight') onChange(options[(idx + 1) % options.length]!.value);
              if (e.key === 'ArrowLeft') onChange(options[(idx - 1 + options.length) % options.length]!.value);
            }}
            tabIndex={active ? 0 : -1}
            className={cx(
              'flex h-9 items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-semibold transition-all',
              active ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(28_25_23/0.12)]' : 'text-muted hover:text-ink',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Disclosure({ summary, children, defaultOpen, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <details open={defaultOpen} className={cx('group', className)}>
      <summary className="flex list-none items-center justify-between gap-2 rounded-lg py-1.5 text-[12.5px] font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span aria-hidden className="text-muted transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="pt-1.5">{children}</div>
    </details>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} aria-hidden />;
}

export function Stat({ label, value, sub, emphasis }: { label: string; value: ReactNode; sub?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={cx('rounded-xl border border-line px-3 py-2.5', emphasis ? 'bg-surface' : 'bg-paper')}>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      <div className="num mt-1 text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
