import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/common/decimal';
import { issue, receive, reverse, type Pool } from '../../src/modules/inventory/valuation';

const empty: Pool = { qty: '0', value: '0', layers: [] };

describe('Decimal.div', () => {
  it('divides with half-up rounding at 6 dp', () => {
    expect(Decimal.from('10').div(Decimal.from('3')).toFixed(6)).toBe('3.333333');
    expect(Decimal.from('2').div(Decimal.from('3')).toFixed(6)).toBe('0.666667');
    expect(() => Decimal.from('1').div(Decimal.from('0'))).toThrow();
  });
});

describe('weighted average', () => {
  it('averages receipts and issues at the running average', () => {
    let m = receive(empty, 'weighted_average', '100', '10'); // 1000
    m = receive(m.pool, 'weighted_average', '50', '13'); // +650 → 150 @ 11
    expect(m.pool).toMatchObject({ qty: '150.0000', value: '1650.00' });
    expect(m.valuationRate).toBe('11.000000');
    const out = issue(m.pool, 'weighted_average', '60');
    expect(out.value).toBe('-660.00');
    expect(out.rate).toBe('11.000000');
    expect(out.pool).toMatchObject({ qty: '90.0000', value: '990.00' });
  });

  it('never leaves stray paise when the pool is emptied', () => {
    let m = receive(empty, 'weighted_average', '3', '10');
    m = receive(m.pool, 'weighted_average', '3', '10.01'); // 6 @ 10.005 = 60.03
    const a = issue(m.pool, 'weighted_average', '1');
    const b = issue(a.pool, 'weighted_average', '5');
    expect(b.pool).toMatchObject({ qty: '0.0000', value: '0.00' });
    expect(Decimal.sum([a.value, b.value]).toFixed(2)).toBe('-60.03');
  });
});

describe('FIFO', () => {
  it('consumes the oldest layers first', () => {
    let m = receive(empty, 'fifo', '100', '10');
    m = receive(m.pool, 'fifo', '100', '12');
    const out = issue(m.pool, 'fifo', '150'); // 100×10 + 50×12 = 1600
    expect(out.value).toBe('-1600.00');
    expect(out.rate).toBe('10.666667');
    expect(out.pool.layers).toEqual([{ qty: '50.0000', rate: '12.000000' }]);
    expect(out.pool).toMatchObject({ qty: '50.0000', value: '600.00' });
  });

  it('restores layers when an issue is reversed', () => {
    let m = receive(empty, 'fifo', '10', '5');
    m = receive(m.pool, 'fifo', '10', '7');
    const out = issue(m.pool, 'fifo', '15'); // 10×5 + 5×7 = 85
    const back = reverse(out.pool, 'fifo', '-15', out.value);
    expect(back.pool).toMatchObject({ qty: '20.0000', value: '120.00' });
    expect(back.value).toBe('85.00');
  });

  it('removes the newest layers when a receipt is reversed', () => {
    let m = receive(empty, 'fifo', '10', '5');
    m = receive(m.pool, 'fifo', '10', '7');
    const back = reverse(m.pool, 'fifo', '10', m.value);
    expect(back.pool).toMatchObject({ qty: '10.0000', value: '50.00', layers: [{ qty: '10.0000', rate: '5.000000' }] });
  });
});
