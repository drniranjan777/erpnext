import { describe, expect, it } from 'vitest';
import { applySchemes, slabFor, type Scheme } from '../../src/modules/dms/schemes';

const qty: Scheme = { id: 's1', code: 'QTY', name: 'Volume', kind: 'qty_slab', itemIds: ['paint'], slabs: [{ min: 10, perUnit: 5 }, { min: 50, perUnit: 8 }] };
const pct: Scheme = { id: 's2', code: 'PCT', name: 'Primer offer', kind: 'qty_slab', itemIds: ['primer'], slabs: [{ min: 20, discountPct: 10 }] };
const free: Scheme = { id: 's3', code: 'FREE', name: 'Buy 12 get 1', kind: 'free_goods', itemIds: ['paint'], slabs: [{ min: 12, freeQty: 1 }] };
const value: Scheme = { id: 's4', code: 'VAL', name: 'Big order', kind: 'value_slab', itemIds: [], slabs: [{ min: 10_000, discountPct: 2 }, { min: 50_000, discountPct: 3 }] };

describe('schemes', () => {
  it('picks the highest slab reached', () => {
    expect(slabFor(qty.slabs, 9)).toBeNull();
    expect(slabFor(qty.slabs, 10)?.perUnit).toBe(5);
    expect(slabFor(qty.slabs, 120)?.perUnit).toBe(8);
  });
  it('applies quantity, percentage, free goods and then the value slab', () => {
    const r = applySchemes(
      [
        { itemId: 'paint', qty: 30, rate: 400 },
        { itemId: 'paint', qty: 30, rate: 400 },
        { itemId: 'primer', qty: 20, rate: 150 },
      ],
      [qty, pct, free, value],
    );
    // Paint 60 units: ₹8 a unit = 480, and 5 free. Primer 20: 10 % of 3,000 = 300.
    expect(r.applied.find((a) => a.code === 'QTY')).toMatchObject({ itemId: 'paint', discount: 480 });
    expect(r.applied.find((a) => a.code === 'FREE')).toMatchObject({ itemId: 'paint', freeQty: 5, discount: 0 });
    expect(r.applied.find((a) => a.code === 'PCT')).toMatchObject({ itemId: 'primer', discount: 300 });
    // Value after item discounts: 24,000 − 480 + 3,000 − 300 = 26,220 → 2 %.
    expect(r.applied.find((a) => a.code === 'VAL')).toMatchObject({ discount: 524.4 });
    expect(r).toMatchObject({ gross: 27_000, discount: 1304.4, net: 25_695.6 });
  });
  it('leaves sales below every slab untouched', () => {
    expect(applySchemes([{ itemId: 'paint', qty: 2, rate: 400 }], [qty, free, value])).toEqual({ applied: [], discount: 0, gross: 800, net: 800 });
  });
});
