import { describe, expect, it } from 'vitest';
import { activeLines, explode, rollUp, type BomData, type BomLineData } from '../../src/modules/manufacturing/bom-math';

const line = (itemId: string, qty: string, patch: Partial<BomLineData> = {}): BomLineData => ({ kind: 'component', itemId, qty, scrapPct: '0', isPhantom: false, alternateGroup: null, priority: 1, recoveryRate: null, ...patch });

// Crate (per 10): 12 kg resin (+2% scrap), 10 handles (phantom kit: 2 screws + 1 grip each), masterbatch A or B.
const crate: BomData = {
  id: 'b-crate',
  itemId: 'crate',
  quantity: '10',
  lines: [
    line('resin', '12', { scrapPct: '2' }),
    line('handle-kit', '10', { isPhantom: true }),
    line('mb-a', '0.2', { alternateGroup: 'MB', priority: 1 }),
    line('mb-b', '0.2', { alternateGroup: 'MB', priority: 2 }),
    line('regrind', '0.5', { kind: 'byproduct', recoveryRate: '40' }),
  ],
  operations: [
    { seq: 10, workCenterId: 'imm', setupMinutes: '60', runMinutes: '1.5', isSubcontract: false, subcontractRate: null },
    { seq: 20, workCenterId: 'print', setupMinutes: '0', runMinutes: '0', isSubcontract: true, subcontractRate: '3' },
  ],
};
const kit: BomData = { id: 'b-kit', itemId: 'handle-kit', quantity: '1', lines: [line('screw', '2'), line('grip', '1')], operations: [] };
const boms: Record<string, BomData> = { crate, 'handle-kit': kit };
const bomOf = (id: string) => boms[id] ?? null;

describe('BOM explosion', () => {
  it('uses only the first alternate', () => {
    expect(activeLines(crate.lines).map((l) => l.itemId)).toEqual(['resin', 'handle-kit', 'mb-a', 'regrind']);
  });

  it('explodes phantoms and applies scrap, per quantity ordered', () => {
    const r = explode(crate, '100', bomOf);
    expect(Object.fromEntries(r.requirements.map((x) => [x.itemId, x.qty]))).toEqual({ resin: '122.400000', screw: '200.000000', grip: '100.000000', 'mb-a': '2.000000' });
    expect(r.rows.find((x) => x.itemId === 'screw')).toMatchObject({ level: 2, parentItemId: 'handle-kit', viaPhantom: true });
  });

  it('refuses circular BOMs', () => {
    const loop: BomData = { id: 'x', itemId: 'a', quantity: '1', lines: [line('b', '1', { isPhantom: true })], operations: [] };
    const loopB: BomData = { id: 'y', itemId: 'b', quantity: '1', lines: [line('a', '1', { isPhantom: true })], operations: [] };
    expect(() => explode(loop, '1', (id) => (id === 'a' ? loop : id === 'b' ? loopB : null))).toThrow(/circular/);
  });
});

describe('cost roll-up', () => {
  it('materials (with sub-assemblies), operations at work-centre rates, sub-contract, less by-products', () => {
    const costs: Record<string, string> = { resin: '100', screw: '1.5', grip: '4', 'mb-a': '300' };
    const r = rollUp(crate, { hourly: () => ({ labour: '120', machine: '300', overhead: '60' }), itemCost: (id) => costs[id] ?? null }, bomOf);
    // Per crate: resin 1.2 × 1.02 × 100 = 122.4; kit 1 × (2 × 1.5 + 4) = 7; MB 0.02 × 300 = 6.
    expect(r.material).toBe('135.4000');
    // (60 / 10 + 1.5) min = 7.5 min × ₹480 / 60 = 60.
    expect(r).toMatchObject({ labour: '15.0000', machine: '37.5000', overhead: '7.5000', operation: '60.0000', subcontract: '3.0000' });
    // Regrind 0.05 kg × ₹40 = 2.
    expect(r.byproductCredit).toBe('2.0000');
    expect(r.unitCost).toBe('196.4000');
    expect(r.lines.find((l) => l.itemId === 'handle-kit')).toMatchObject({ source: 'bom', unitCost: '7.0000' });
  });

  it('reports components without a cost', () => {
    const r = rollUp(crate, { hourly: () => ({ labour: '0', machine: '0', overhead: '0' }), itemCost: () => null }, bomOf);
    expect(r.missing.sort()).toEqual(['grip', 'mb-a', 'resin', 'screw']);
  });
});
