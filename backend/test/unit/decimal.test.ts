import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/common/decimal';

describe('Decimal', () => {
  it('avoids binary floating point errors', () => {
    expect(Decimal.from('0.1').add(Decimal.from('0.2')).toFixed(2)).toBe('0.30');
    expect(Decimal.sum(['0.1', '0.2', '0.3']).toFixed(1)).toBe('0.6');
  });

  it('multiplies quantity × rate and rounds half-up to paise', () => {
    expect(Decimal.from('3').mul(Decimal.from('33.335')).toFixed(2)).toBe('100.01'); // 100.005 → 100.01
    expect(Decimal.from('2.5').mul(Decimal.from('4.01')).toFixed(2)).toBe('10.03'); // 10.025 → 10.03
    expect(Decimal.from('1250.5').mul(Decimal.from('18.75')).toFixed(2)).toBe('23446.88');
  });

  it('handles large values beyond Number precision', () => {
    expect(Decimal.from('99999999999999.99').add(Decimal.from('0.01')).toFixed(2)).toBe('100000000000000.00');
  });

  it('handles negatives and rounding symmetrically', () => {
    expect(Decimal.from('-1.005').toFixed(2)).toBe('-1.01');
    expect(Decimal.from('5').sub(Decimal.from('7.5')).toFixed(2)).toBe('-2.50');
  });

  it('compares values', () => {
    expect(Decimal.from('100').cmp(Decimal.from('100.00'))).toBe(0);
    expect(Decimal.from('99.99').cmp(Decimal.from('100'))).toBe(-1);
  });

  it('rejects malformed input', () => {
    expect(() => Decimal.from('12a')).toThrow();
    expect(() => Decimal.from('1,000')).toThrow();
  });
});
