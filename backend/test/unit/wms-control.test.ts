import { describe, expect, it } from 'vitest';
import { abcClasses, floorLife, replenishQty, tankLitres } from '../../src/modules/wms/control';

describe('ABC classes', () => {
  it('splits by share of issue value, with unused items in C', () => {
    const c = abcClasses([
      { itemId: 'a', value: 600 },
      { itemId: 'b', value: 150 },
      { itemId: 'c', value: 100 },
      { itemId: 'd', value: 80 },
      { itemId: 'e', value: 70 },
      { itemId: 'z', value: 0 },
    ]);
    // Running totals before each item: 0, 600 (60 %), 750 (75 %), 850 (85 %), 930 (93 %).
    expect([...c.entries()]).toEqual([['a', 'A'], ['b', 'A'], ['c', 'A'], ['d', 'B'], ['e', 'B'], ['z', 'C']]);
    expect(abcClasses([{ itemId: 'only', value: 5 }]).get('only')).toBe('A');
  });
});

describe('tank volume', () => {
  const chart = [{ mm: 0, litres: 0 }, { mm: 1000, litres: 5000 }, { mm: 2000, litres: 12000 }];
  it('interpolates between calibration points', () => {
    expect(tankLitres(chart, 500)).toBe(2500);
    expect(tankLitres(chart, 1500)).toBe(8500);
    expect(tankLitres(chart, 2000)).toBe(12000);
    expect(() => tankLitres(chart, 2100)).toThrow(/between 0 and 2000/);
  });
});

describe('MSL floor life', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('counts exposure while open and expires at the level limit', () => {
    expect(floorLife('3', 0, null, now)).toEqual({ usedMinutes: 0, remainingMinutes: 168 * 60, expired: false });
    expect(floorLife('5a', 1200, '2026-10-07T08:00:00Z', now)).toEqual({ usedMinutes: 1440, remainingMinutes: 0, expired: true });
    expect(floorLife('1', 99_999, null, now)).toMatchObject({ remainingMinutes: null, expired: false });
    expect(floorLife('6', 0, null, now).expired).toBe(true);
  });
});

describe('replenishment', () => {
  it('tops up to max once below min, counting what is on the way', () => {
    expect(replenishQty(5, 0, 10, 50)).toBe(45);
    expect(replenishQty(5, 10, 10, 50)).toBe(0);
    expect(replenishQty(12, 0, 10, 50)).toBe(0);
  });
});
