import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/common/decimal';
import { adjustForAssay, formulaCost, lineQty, scale, withinTolerance, yieldOf, type FormulaData } from '../../src/modules/process/formula-math';

const base: FormulaData = {
  itemId: 'paint',
  batchSize: '100',
  yieldPct: '95',
  lines: [
    { kind: 'ingredient', itemId: 'resin', basis: 'percent', qty: '60' },
    { kind: 'ingredient', itemId: 'solvent', basis: 'percent', qty: '40' },
  ],
  stages: [{ seq: 10, workCenterId: 'mix', minutes: '60' }],
};

describe('formula maths', () => {
  it('scales percent, fixed and potency lines', () => {
    expect(lineQty({ kind: 'ingredient', itemId: 'a', basis: 'percent', qty: '12.5' }, '100', '1000').toFixed(4)).toBe('125.0000');
    expect(lineQty({ kind: 'ingredient', itemId: 'a', basis: 'fixed', qty: '3' }, '100', '250').toFixed(4)).toBe('7.5000');
    // 10 kg of pure active per 100 kg batch, written for a 98 % standard lot.
    expect(lineQty({ kind: 'ingredient', itemId: 'a', basis: 'potency', qty: '10', stdPotency: '98' }, '100', '200').toFixed(4)).toBe('20.4082');
    expect(scale(base, '500').map((l) => l.required)).toEqual(['300.0000', '200.0000']);
  });

  it('weighs up for the assay of the lot actually used', () => {
    expect(adjustForAssay('25', '100', '98').toFixed(4)).toBe('25.5102');
    expect(adjustForAssay('20.4082', '98', '95').toFixed(4)).toBe('21.0527');
    expect(adjustForAssay('25', '100', null).toFixed(4)).toBe('25.0000');
    expect(() => adjustForAssay('25', '100', '0')).toThrow(/Assay/);
  });

  it('checks dispensing tolerance', () => {
    expect(withinTolerance('100.9', Decimal.from('100'), '1')).toBe(true);
    expect(withinTolerance('98.9', Decimal.from('100'), '1')).toBe(false);
    expect(withinTolerance('100', Decimal.from('100'), null)).toBe(true);
    expect(withinTolerance('100.0001', Decimal.from('100'), null)).toBe(false);
  });

  it('measures yield against theory', () => {
    expect(yieldOf('1000', '95', '931')).toEqual({ theoretical: '950.0000', actualPct: '98.00', loss: '19.0000' });
  });

  it('costs a batch and apportions co-products', () => {
    const cost = (f: FormulaData) => formulaCost(f, (id) => ({ resin: '50', solvent: '25', thinner: '10' })[id] ?? null, () => '600');
    // 60 × 50 + 40 × 25 = 4,000 material; 60 min at ₹600 / h = 600; 4,600 over 95 kg out.
    expect(cost(base)).toMatchObject({ material: '4000.00', conversion: '600.00', batchCost: '4600.00', unitCost: '48.4211', missing: [] });
    const withCo = cost({ ...base, lines: [...base.lines, { kind: 'coproduct', itemId: 'thinner', basis: 'fixed', qty: '5', costSharePct: '10' }] });
    expect(withCo.unitCost).toBe('43.5789');
    expect(withCo.coproducts).toEqual([{ itemId: 'thinner', qty: '5.0000', share: '460.00', unitCost: '92.0000' }]);
    const missing = formulaCost(base, () => null, () => '0');
    expect(missing.missing).toEqual(['resin', 'solvent']);
  });
});
