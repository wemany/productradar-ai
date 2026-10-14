import { useEffect, useState } from 'react';
import { cx } from '../lib/format';

function decimalSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? ',';
}

/**
 * Interpreta lo que escribe el usuario según el formato de su país:
 * es-CO/es-CL usan coma decimal ("4.000,50"); es-MX/es-PE, punto ("3.745").
 */
export function parseUserNumber(raw: string, locale: string): number | null {
  const dec = decimalSeparator(locale);
  const group = dec === ',' ? '.' : ',';
  const cleaned = raw.trim().split(group).join('').replace(dec, '.');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Campo numérico con formato local ("79.900"). Vacío = no informado (undefined),
 * que es distinto de cero: así no se inventan supuestos.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  prefix = '$',
  suffix,
  placeholder = 'Sin definir',
  decimals = 0,
  locale = 'es-CO',
  className,
  ariaDescribedBy,
}: {
  id: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  decimals?: number;
  locale?: string;
  className?: string;
  ariaDescribedBy?: string;
}) {
  const format = (v: number | undefined) =>
    v === undefined ? '' : new Intl.NumberFormat(locale, { maximumFractionDigits: decimals, useGrouping: 'always' } as Intl.NumberFormatOptions).format(v);
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, locale, decimals]);

  return (
    <div className={cx('relative flex items-center', className)}>
      {prefix && <span className="pointer-events-none absolute left-3 text-[12.5px] text-muted">{prefix}</span>}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-describedby={ariaDescribedBy}
        className={cx('field num', prefix && 'pl-7', suffix && 'pr-12')}
        placeholder={placeholder}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(format(value));
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,]/g, '');
          setText(raw);
          if (!raw.trim()) return onChange(undefined);
          const parsed = parseUserNumber(raw, locale);
          if (parsed !== null) onChange(decimals === 0 ? Math.round(parsed) : parsed);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-3 font-mono text-[11px] text-muted">{suffix}</span>}
    </div>
  );
}
