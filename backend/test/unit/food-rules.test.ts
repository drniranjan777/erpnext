import { describe, expect, it } from 'vitest';
import { allergenStatement, changeover, codexDecision, flattenTrace, nutritionPanel, recallMetrics, rollUp, significant, withinLimits } from '../../src/modules/food/food-rules';

describe('HACCP', () => {
  it('rates hazards and walks the Codex decision tree', () => {
    expect([significant({ severity: 3, likelihood: 2 }), significant({ severity: 2, likelihood: 2 }), significant({ severity: 1, likelihood: 3 })]).toEqual([true, true, false]);
    expect(codexDecision({ q1: true, q2: true })).toMatchObject({ ccp: true });
    expect(codexDecision({ q1: true, q2: false, q3: true, q4: false })).toMatchObject({ ccp: true });
    expect(codexDecision({ q1: true, q2: false, q3: true, q4: true })).toMatchObject({ ccp: false, reason: 'A later step controls the hazard (Q4 yes)' });
    expect(codexDecision({ q1: true, q2: false, q3: false })).toMatchObject({ ccp: false });
    expect(codexDecision({ q1: false })).toMatchObject({ ccp: false });
    expect(codexDecision({ q1: true, q2: false })).toMatchObject({ ccp: null });
    expect([withinLimits(72, 70, null), withinLimits(68, 70, null), withinLimits(5, null, 5)]).toEqual([true, false, true]);
  });
});

describe('allergens', () => {
  const own = new Map([
    ['biscuit', { contains: [], mayContain: [] }],
    ['flour', { contains: ['gluten'], mayContain: ['soy'] }],
    ['cream', { contains: ['milk'], mayContain: ['nuts'] }],
    ['lecithin', { contains: ['soy'], mayContain: [] }],
  ]);
  const children = new Map([
    ['biscuit', ['flour', 'filling']],
    ['filling', ['cream', 'lecithin', 'biscuit']],
  ]);

  it('rolls up through the bill of materials, even with a loop', () => {
    expect(rollUp('biscuit', own, children)).toEqual({ contains: ['gluten', 'soy', 'milk'], mayContain: ['nuts'] });
    expect(allergenStatement(['gluten', 'soy', 'milk'], ['nuts'])).toBe('Contains: Gluten, Soybeans, Milk. May contain: Tree nuts.');
  });

  it('asks for an allergen clean when the next product lacks an allergen of the last', () => {
    expect(changeover(['milk', 'gluten'], ['gluten'])).toEqual({ cleanRequired: true, allergensToRemove: ['milk'] });
    expect(changeover(['gluten'], ['gluten', 'milk'])).toEqual({ cleanRequired: false, allergensToRemove: [] });
  });
});

describe('labels', () => {
  it('gives per-serve values and %RDA for the regulated nutrients', () => {
    const p = nutritionPanel({ energyKcal: 480, protein: 7, carbohydrate: 68, totalSugars: 22, addedSugars: 20, totalFat: 20, saturatedFat: 9, transFat: 0.2, sodiumMg: 300 }, 25);
    expect(p.find((r) => r.nutrient === 'energyKcal')).toEqual({ nutrient: 'energyKcal', per100: 480, perServe: 120, rdaPct: 6 });
    expect(p.find((r) => r.nutrient === 'saturatedFat')).toEqual({ nutrient: 'saturatedFat', per100: 9, perServe: 2.3, rdaPct: 10.2 });
    expect(p.find((r) => r.nutrient === 'protein')?.rdaPct).toBeNull();
  });
});

describe('recalls', () => {
  it('flattens the trace into customers, products made from the lot and stock on hand', () => {
    const forward = {
      item: { code: 'FLR', name: 'Flour' },
      batchNo: 'F1',
      onHand: [{ warehouse: 'MAIN', qty: '40' }],
      links: [
        { docType: 'delivery_note', number: 'DN/1', qty: '100', party: 'Bakery A' },
        { docType: 'sales_invoice', number: 'INV/2', qty: '60', party: 'Bakery A' },
        {
          docType: 'production_entry',
          number: 'PE/1',
          qty: '200',
          party: null,
          lots: [{ item: { code: 'BIS', name: 'Biscuit' }, batchNo: 'B9', onHand: [{ warehouse: 'FG', qty: '30' }], links: [{ docType: 'delivery_note', number: 'DN/7', qty: '500', party: 'Retailer Z' }] }],
        },
      ],
    };
    const t = flattenTrace(forward, { item: { code: 'FLR', name: 'Flour' }, batchNo: 'F1', links: [{ docType: 'goods_receipt', number: 'GRN/1', qty: '400', party: 'Mill', lots: [] }] });
    expect(t.customers).toEqual([{ party: 'Bakery A', documents: ['DN/1', 'INV/2'], qty: 160 }, { party: 'Retailer Z', documents: ['DN/7'], qty: 500 }]);
    expect(t.usedIn).toEqual([{ item: 'BIS · Biscuit', batchNo: 'B9' }]);
    expect(t.onHand).toEqual([{ warehouse: 'MAIN', qty: 40 }, { warehouse: 'FG (BIS B9)', qty: 30 }]);
    expect(t.dispatchedQty).toBe(160);
    expect(recallMetrics({ startedAt: new Date(0), traceCompletedAt: new Date(95 * 60_000), trace: t, recovered: [{ qty: 100 }, { qty: 40 }] })).toEqual({ traceMinutes: 95, recoveredQty: 140, recoveredPct: 87.5 });
  });
});
