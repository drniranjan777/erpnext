import { describe, expect, it } from 'vitest';
import { energyGj, eprStatus, footprint, ltifr, perCrore, rollUpCompliance, type PartDecl } from '../../src/modules/esg/esg-rules';
import { checklistFor, classify, conflicts, gasTestOk, permitProblems, petroleumClass, sdsProblems, storageCheck } from '../../src/modules/hse/hse-rules';
import { auditState, breakdownTotals, measurementCheck, missingCertificates, tna } from '../../src/modules/textile/textile-rules';

describe('GHS and SDS', () => {
  it('derives pictograms and the signal word with the precedence rules', () => {
    expect(classify(['H225', 'H319', 'H336'])).toEqual({ pictograms: ['GHS02', 'GHS07'], signalWord: 'Danger', unknown: [] });
    // Skull and crossbones replaces the exclamation mark.
    expect(classify(['H301', 'H302']).pictograms).toEqual(['GHS06']);
    // Corrosion replaces it for skin and eye irritation only.
    expect(classify(['H314', 'H315', 'H319']).pictograms).toEqual(['GHS05']);
    expect(classify(['H314', 'H335']).pictograms).toEqual(['GHS05', 'GHS07']);
    expect(classify(['H411']).signalWord).toBeNull();
    expect(classify(['H999']).unknown).toEqual(['H999']);
  });

  it('checks SDS completeness and petroleum class', () => {
    const sections = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [String(i + 1), 'x']));
    const ghs = { hazardStatements: ['H225'], pictograms: ['GHS02'], signalWord: 'Danger' };
    expect(sdsProblems({ sections, ghs, hazardClass: '3', unNumber: 'UN1993' })).toEqual([]);
    expect(sdsProblems({ sections: { ...sections, 14: ' ' }, ghs, hazardClass: '3', unNumber: null })).toEqual(['sections 14 are empty', 'dangerous goods need a UN number (UN followed by 4 digits)']);
    expect([petroleumClass(-20), petroleumClass(40), petroleumClass(80), petroleumClass(150), petroleumClass(null)]).toEqual(['A', 'B', 'C', null, null]);
  });

  it('checks storage limits and incompatible classes', () => {
    const r = storageCheck(
      [
        { warehouseId: 'w1', warehouse: 'Solvent store', itemId: 'a', item: 'Toluene', hazardClass: '3', petroleumClass: 'A', kg: 8000 },
        { warehouseId: 'w1', warehouse: 'Solvent store', itemId: 'b', item: 'Hydrogen peroxide', hazardClass: '5.1', petroleumClass: null, kg: 500 },
        { warehouseId: 'w2', warehouse: 'Acid store', itemId: 'c', item: 'Sulphuric acid', hazardClass: '8', petroleumClass: null, kg: 2000 },
      ],
      [
        { warehouseId: 'w1', hazardClass: 'petroleum_a', maxKg: 5000 },
        { warehouseId: 'w1', hazardClass: '5', maxKg: 1000 },
        { warehouseId: 'w2', hazardClass: '8', maxKg: 5000 },
      ],
    );
    expect(r.usage.map((u) => [u.hazardClass, u.kg, u.pct, u.breach])).toEqual([
      ['petroleum_a', 8000, 160, true],
      ['5', 500, 50, false],
      ['8', 2000, 40, false],
    ]);
    expect(r.clashes).toEqual([{ warehouseId: 'w1', warehouse: 'Solvent store', a: 'Toluene (class 3)', b: 'Hydrogen peroxide (class 5.1)' }]);
  });
});

describe('permits to work', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 8, h));
  it('builds checklists and checks gas tests', () => {
    expect(checklistFor('hot_work').length).toBe(8);
    expect(gasTestOk({ o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 }, 'hot_work')).toEqual([]);
    expect(gasTestOk({ o2Pct: 20.9, lelPct: 2, h2sPpm: 0, coPpm: 0 }, 'hot_work')).toHaveLength(1);
    expect(gasTestOk({ o2Pct: 20.9, lelPct: 2, h2sPpm: 0, coPpm: 0 }, 'confined_space')).toEqual([]);
    expect(gasTestOk({ o2Pct: 18, lelPct: 0, h2sPpm: 12, coPpm: 30 }, 'confined_space')).toHaveLength(3);
  });

  it('refuses unready permits and finds conflicting work', () => {
    const p = { type: 'hot_work' as const, validFrom: at(2), validTo: at(12), checklist: [{ label: 'x', done: false }], gasTests: [] };
    expect(permitProblems(p, 'approve')).toEqual(['a hot work permit may run at most 8 hours', '1 checklist item(s) not confirmed']);
    const ready = { ...p, validTo: at(9), checklist: [{ label: 'x', done: true }], gasTests: [{ at: at(3).toISOString(), o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 }] };
    expect(permitProblems(ready, 'activate', at(4))).toEqual([]);
    expect(permitProblems(ready, 'activate', at(6))).toEqual(['the last gas test is more than 2 hours old']);
    const others = [
      { number: 'PTW-LB-1', type: 'line_break', location: 'Reactor R-2 ', validFrom: at(5), validTo: at(7) },
      { number: 'PTW-HT-2', type: 'height', location: 'Reactor R-2', validFrom: at(5), validTo: at(7) },
      { number: 'PTW-LB-3', type: 'line_break', location: 'Reactor R-2', validFrom: at(10), validTo: at(11) },
    ];
    expect(conflicts({ type: 'hot_work', location: 'reactor r-2', validFrom: at(2), validTo: at(9) }, others)).toEqual(['PTW-LB-1 (line break) at the same place and time']);
  });
});

describe('textile', () => {
  it('totals the breakdown and plans time and action back from ex-factory', () => {
    expect(breakdownTotals({ Navy: { S: 100, M: 200 }, White: { M: 50 } })).toEqual({ bySize: { S: 100, M: 250 }, byColour: { Navy: 300, White: 50 }, total: 350 });
    const plan = tna('2026-07-01', '2026-09-29', { fabric_booked: '2026-07-25' }, { lab_dip: '2026-07-20' }, '2026-08-01');
    expect(plan[0]).toMatchObject({ key: 'lab_dip', due: '2026-07-16', doneOn: '2026-07-20', state: 'done_late', daysLate: 4 });
    expect(plan.find((m) => m.key === 'fit')).toMatchObject({ due: '2026-07-26', state: 'late', daysLate: 6 });
    expect(plan.find((m) => m.key === 'fabric_booked')).toMatchObject({ due: '2026-07-31', state: 'done' });
    // A 45-day lead time halves every offset.
    expect(tna('2026-08-15', '2026-09-29', {}, {}, '2026-08-15')[0].due).toBe('2026-08-22');
  });

  it('checks measurements, required certificates and audits', () => {
    const points = [
      { code: 'A', description: 'Chest width', tolerance: 1, sizes: { M: 52 } },
      { code: 'B', description: 'Body length', tolerance: 1, sizes: { M: 72 } },
    ];
    const c = measurementCheck(points, 'M', { A: 52.8, B: 70.5 });
    expect(c.outOfTolerance).toBe(1);
    expect(c.rows[1]).toMatchObject({ deviation: -1.5, ok: false });
    expect(missingCertificates(['gots', 'oekotex'], [{ type: 'gots', validUntil: '2026-12-31' }, { type: 'oekotex', validUntil: '2026-09-01' }], '2026-09-29')).toEqual(['oekotex']);
    expect(auditState({ validUntil: '2026-11-01', capDueOn: '2026-09-01', capStatus: 'open', criticalFindings: 0 }, '2026-10-08')).toEqual({ state: 'expiring', capOverdue: true, critical: false });
  });
});

describe('sustainability and materials compliance', () => {
  it('computes the footprint, energy and intensities', () => {
    const rows = [
      { period: '2026-04', key: 'diesel_l', name: 'Diesel', scope: 1, category: 'stationary_combustion', quantity: 1000, kgCo2ePerUnit: 2.68 },
      { period: '2026-04', key: 'grid_kwh', name: 'Grid', scope: 2, category: 'purchased_electricity', quantity: 100000, kgCo2ePerUnit: 0.716 },
      { period: '2026-05', key: 'road_freight_tkm', name: 'Freight', scope: 3, category: 'cat4_upstream_transport', quantity: 20000, kgCo2ePerUnit: 0.105 },
    ];
    const f = footprint(rows);
    expect([f.scope1, f.scope2, f.scope3, f.total]).toEqual([2.68, 71.6, 2.1, 76.38]);
    expect(f.months).toEqual([
      { period: '2026-04', scope1: 2.68, scope2: 71.6, scope3: 0 },
      { period: '2026-05', scope1: 0, scope2: 0, scope3: 2.1 },
    ]);
    expect(energyGj(rows)).toEqual({ totalGj: 398.6, electricityGj: 360, fuelGj: 38.6 });
    expect(perCrore(74.28, 50_000_000)).toBe(14.856);
    expect(ltifr(2, 400_000)).toBe(5);
  });

  it('tracks EPR certificates against the target', () => {
    const s = eprStatus([{ category: 'plastic_packaging', fiscalYear: '2026-27', targetKg: 10000 }], [
      { category: 'plastic_packaging', fiscalYear: '2026-27', qtyKg: 6000, kind: 'recycling' },
      { category: 'plastic_packaging', fiscalYear: '2026-27', qtyKg: 1500, kind: 'end_of_life' },
    ]);
    expect(s).toEqual([{ category: 'plastic_packaging', fiscalYear: '2026-27', targetKg: 10000, certifiedKg: 7500, byKind: { recycling: 6000, end_of_life: 1500 }, shortfallKg: 2500, pct: 75 }]);
  });

  it('rolls RoHS, REACH and conflict minerals up through the BOM', () => {
    const decl = new Map<string, PartDecl>([
      ['cap', { rohs: 'compliant', svhc: [], uses3tg: true, smelters: [{ metal: 'tantalum', name: 'Good smelter', conformant: true }] }],
      ['solder', { rohs: 'exempt', svhc: [{ substance: 'Lead', cas: '7439-92-1', pct: 0.5 }], uses3tg: true, smelters: [{ metal: 'tin', name: 'Unknown smelter', conformant: false }] }],
    ]);
    const children = new Map([
      ['board', ['cap', 'solder', 'pcb']],
      ['product', ['board']],
    ]);
    const names = new Map([
      ['pcb', 'PCB'],
      ['solder', 'Solder'],
    ]);
    const r = rollUpCompliance('product', decl, children, names);
    expect(r).toMatchObject({ rohs: 'unknown', reachArticle33: true, uses3tg: true, unknownParts: ['PCB'] });
    expect(r.svhc).toEqual([{ part: 'Solder', substance: 'Lead', cas: '7439-92-1', pct: 0.5 }]);
    expect(r.nonConformantSmelters).toEqual([{ part: 'Solder', metal: 'tin', name: 'Unknown smelter' }]);
    decl.set('pcb', { rohs: 'compliant', svhc: [], uses3tg: false, smelters: [] });
    expect(rollUpCompliance('product', decl, children, names).rohs).toBe('exempt');
  });
});
