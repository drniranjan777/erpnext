import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/common/decimal';
import { backflushQty, outputValue, outstanding, plannedMinutes, shortages, shotsFor, timeCost, variances, wipBalance } from '../../src/modules/manufacturing/production-math';

describe('production maths', () => {
  it('costs time at work-centre rates', () => {
    expect(timeCost('50', { labour: '120', machine: '240', overhead: '60' })).toEqual({ labour: '100.00', machine: '200.00', overhead: '50.00' });
    expect(plannedMinutes('30', '1.5', '20')).toBe('60.00');
  });

  it('counts tool shots by cavities', () => {
    expect(shotsFor('20', 2)).toBe(10);
    expect(shotsFor('21', 2)).toBe(11);
    expect(shotsFor('0', 4)).toBe(0);
    expect(shotsFor('5', 0)).toBe(5);
  });

  it('backflushes up to the standard for what was made', () => {
    expect(backflushQty({ requiredQty: '40', issuedQty: '0' }, '20', '10')).toBe('20.0000');
    expect(backflushQty({ requiredQty: '40', issuedQty: '30' }, '20', '10')).toBe('0.0000');
    expect(outstanding({ requiredQty: '10', issuedQty: '12' })).toBe('0.0000');
  });

  it('values output at standard, else spreads actual WIP over what is left', () => {
    const wip = Decimal.from('1000');
    expect(outputValue({ stdUnitCost: '61.5', pieces: '19', wip, woQty: '20', doneBefore: '0', finishes: false }).toFixed(2)).toBe('1168.50');
    expect(outputValue({ stdUnitCost: '0', pieces: '5', wip, woQty: '20', doneBefore: '0', finishes: false }).toFixed(2)).toBe('250.00');
    expect(outputValue({ stdUnitCost: '0', pieces: '5', wip, woQty: '20', doneBefore: '15', finishes: true }).toFixed(2)).toBe('1000.00');
    expect(outputValue({ stdUnitCost: '0', pieces: '5', wip: Decimal.from('-10'), woQty: '20', doneBefore: '0', finishes: true }).toFixed(2)).toBe('0.00');
  });

  it('keeps the WIP balance from the running totals', () => {
    expect(wipBalance({ materialCost: '576', conversionCost: '362', subcontractCost: '95', outputValue: '1168.5', byproductValue: '20', varianceValue: '0' }).toFixed(2)).toBe('-155.50');
  });

  it('splits variances into usage, price, conversion, job work and by-products', () => {
    const v = variances({
      qty: '20',
      producedQty: '19',
      std: { material: '29', operation: '28.5', subcontract: '5', byproduct: '1', unitCost: '61.5' },
      actual: { material: '576', conversion: '362', subcontract: '95', byproduct: '20', output: '1168.5' },
      materials: [
        { kind: 'component', requiredQty: '10', issuedQty: '10', stdRate: '50' },
        { kind: 'component', requiredQty: '40', issuedQty: '38', stdRate: '2' },
        { kind: 'scrap', requiredQty: '1', issuedQty: '0', stdRate: '20' },
      ],
    });
    expect(v).toMatchObject({ materialUsage: '25.00', materialPrice: '0.00', conversion: '-179.50', subcontract: '0.00', byproduct: '-1.00', other: '0.00', total: '-155.50', actualUnitCost: '53.3158' });
  });

  it('finds shortages net of other orders’ reservations', () => {
    const r = shortages([{ itemId: 'a', outstanding: '250' }, { itemId: 'b', outstanding: '5' }], new Map([['a', '100'], ['b', '10']]), new Map([['a', '10']]));
    expect(r).toEqual([
      { itemId: 'a', required: '250', available: '90.0000', short: '160.0000' },
      { itemId: 'b', required: '5', available: '10.0000', short: '0.0000' },
    ]);
  });
});
