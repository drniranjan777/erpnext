import { describe, expect, it } from 'vitest';
import { configure, corrugatedBox, fabrication, furniture } from '../../src/modules/crm/estimate';

describe('corrugated box', () => {
  it('works out the blank, board weight and price', () => {
    const r = corrugatedBox({ length: 300, width: 200, height: 150, ply: 3, linerGsm: [150, 120], fluteGsm: [120], flutes: ['B'], paperRate: 40, conversionRate: 10, printColours: 1, printRatePerColour: 0.5, wastagePct: 5, marginPct: 20, qty: 1000 });
    // Blank 2 × (300 + 200) + 35 = 1035 by 200 + 150 + 6 = 356 → 0.36846 m²; board 150 + 120 + 120 × 1.35 = 432 GSM.
    expect(r.facts).toMatchObject({ blank: '1035 × 356 mm', areaM2: 0.3685, boardGsm: 432 });
    const kg = 0.36846 * 0.432 * 1.05;
    expect(r.lines[0].amount).toBeCloseTo(kg * 40, 2);
    expect(r.unitCost).toBeCloseTo(kg * 50 + 0.5, 2);
    expect(r.unitPrice).toBeCloseTo(r.unitCost / 0.8, 1);
    expect(r.total).toBeCloseTo(r.unitPrice * 1000, 1);
  });
  it('checks the layers match the ply', () => {
    expect(() => corrugatedBox({ length: 1, width: 1, height: 1, ply: 5, linerGsm: [150, 120], fluteGsm: [120], flutes: ['B'], paperRate: 1, conversionRate: 1, printColours: 0, printRatePerColour: 0, wastagePct: 0, marginPct: 0, qty: 1 })).toThrow('A 5-ply board needs 3 liners and 2 flutes');
  });
});

describe('fabrication', () => {
  it('weighs plates, adds processes, finishing and overheads', () => {
    // A 1000 × 500 × 5 mm MS plate = 19.625 kg, plus a 4 kg angle.
    const r = fabrication({ parts: [{ name: 'Base plate', material: 'ms', length: 1000, width: 500, thickness: 5, count: 1 }, { name: 'Angle', material: 'ms', weightKg: 2, count: 2 }], rates: { ms: 70 }, scrapPct: 10, processes: [{ name: 'Welding', minutes: 30, ratePerHour: 600 }], finishPerKg: 15, overheadPct: 10, marginPct: 25, qty: 4 });
    expect(r.facts.netWeightKg).toBe(23.625);
    const material = 23.625 * 1.1 * 70;
    const direct = material + 300 + 23.625 * 15;
    expect(r.unitCost).toBeCloseTo(direct * 1.1, 1);
    expect(r.unitPrice).toBeCloseTo(r.unitCost / 0.75, 1);
    expect(() => fabrication({ parts: [{ name: 'x', material: 'ss', weightKg: 1, count: 1 }], rates: { ms: 70 }, scrapPct: 0, processes: [], finishPerKg: 0, overheadPct: 0, marginPct: 0, qty: 1 })).toThrow('No rate for SS');
  });
});

describe('furniture', () => {
  it('costs a two-door cabinet', () => {
    const r = furniture({ width: 900, height: 1800, depth: 450, shelves: 3, doors: 2, boardRate: 1200, backRate: 400, finishRate: 600, edgeRate: 30, hardware: 1500, labourHours: 6, labourRate: 250, wastagePct: 10, marginPct: 30, qty: 2 });
    // Sides 1.62 + top/bottom 0.81 + shelves 1.215 + doors 1.62 = 5.265 m² + 10 %.
    expect(r.facts.boardM2).toBe(5.7915);
    expect(r.lines.find((l) => l.label === 'Labour')!.amount).toBe(1500);
    expect(r.unitPrice).toBeCloseTo(r.unitCost / 0.7, 1);
  });
});

describe('configurator', () => {
  const groups = [
    { code: 'MOT', name: 'motor', required: true, multi: false, options: [{ code: '1HP', label: '1 HP', priceDelta: 0 }, { code: '2HP', label: '2 HP', priceDelta: 4500, requires: ['PNL.STAR'] }] },
    { code: 'PNL', name: 'panel', required: false, multi: false, options: [{ code: 'DOL', label: 'DOL starter', priceDelta: 1200, excludes: ['PNL.STAR'] }, { code: 'STAR', label: 'Star-delta starter', priceDelta: 3800 }] },
    { code: 'ACC', name: 'accessory', required: false, multi: true, options: [{ code: 'WHL', label: 'Wheels', priceDelta: 800 }, { code: 'CVR', label: 'Cover', priceDelta: 600 }] },
  ];
  it('prices a valid choice', () => {
    expect(configure(25000, groups, ['MOT.2HP', 'PNL.STAR', 'ACC.WHL', 'ACC.CVR'])).toEqual({ ok: true, errors: [], price: 34700, description: 'motor: 2 HP; panel: Star-delta starter; accessory: Wheels; accessory: Cover' });
  });
  it('enforces required, single choice and requires rules', () => {
    expect(configure(25000, groups, ['ACC.WHL']).errors).toEqual(['Choose a motor']);
    expect(configure(25000, groups, ['MOT.1HP', 'MOT.2HP', 'PNL.DOL']).errors).toEqual(['Only one motor', '2 HP needs Star-delta starter']);
    expect(configure(25000, groups, ['MOT.1HP', 'X.Y']).ok).toBe(false);
  });
});
