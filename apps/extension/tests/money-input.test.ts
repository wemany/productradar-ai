import { describe, expect, it } from 'vitest';
import { parseUserNumber } from '../src/components/MoneyInput';

describe('parseUserNumber (formato del país)', () => {
  it('Colombia/Chile: punto de miles, coma decimal', () => {
    expect(parseUserNumber('79.900', 'es-CO')).toBe(79900);
    expect(parseUserNumber('4.000,50', 'es-CO')).toBe(4000.5);
    expect(parseUserNumber('3,49', 'es-CO')).toBe(3.49);
  });

  it('México/Perú: coma de miles, punto decimal', () => {
    expect(parseUserNumber('3.745', 'es-PE')).toBe(3.745);
    expect(parseUserNumber('1,299.50', 'es-MX')).toBe(1299.5);
  });

  it('rechaza texto no numérico', () => {
    expect(parseUserNumber('abc', 'es-CO')).toBeNull();
    expect(parseUserNumber('', 'es-CO')).toBeNull();
  });
});
