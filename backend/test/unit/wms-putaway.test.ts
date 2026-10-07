import { describe, expect, it } from 'vitest';
import { hazardCompatible, requiredCondition, room, suggestPutaway, type CandidateBin, type PutawayItem } from '../../src/modules/wms/putaway';

const NIL = '00000000-0000-0000-0000-000000000000';
const item = (p: Partial<PutawayItem> = {}): PutawayItem => ({ itemId: 'i1', batchKey: NIL, qty: 10, condition: 'ambient', hazardClass: null, unitWeightKg: null, unitVolumeM3: null, abcClass: null, held: false, ...p });
const bin = (code: string, p: Partial<CandidateBin> = {}): CandidateBin => ({ id: code, code, zoneKind: 'storage', condition: 'ambient', pickSequence: 100, fixedItemId: null, maxWeightKg: null, maxVolumeM3: null, maxQty: null, contents: [], ...p });

describe('hazard compatibility', () => {
  it('keeps oxidisers away from flammables and explosives away from everything', () => {
    expect(hazardCompatible('3', '5.1')).toBe(false);
    expect(hazardCompatible('5.1', '3')).toBe(false);
    expect(hazardCompatible('4.3', '8')).toBe(false);
    expect(hazardCompatible('1.4', '9')).toBe(false);
    expect(hazardCompatible('3', '3')).toBe(true);
    expect(hazardCompatible('3', '8')).toBe(true);
    expect(hazardCompatible('3', null)).toBe(true);
  });
  it('derives the storage condition', () => {
    expect(requiredCondition({ condition: 'ambient', hazardClass: '3' })).toBe('hazardous');
    expect(requiredCondition({ condition: 'cold', hazardClass: null })).toBe('cold');
    expect(requiredCondition({ condition: 'ambient', hazardClass: null })).toBe('ambient');
  });
});

describe('room', () => {
  it('is the tightest of weight, volume and quantity', () => {
    const b = bin('A', { maxWeightKg: 1000, maxVolumeM3: 2, contents: [{ itemId: 'x', batchKey: NIL, qty: 10, hazardClass: null, unitWeightKg: 50, unitVolumeM3: 0.1 }] });
    expect(room(b, item({ unitWeightKg: 25, unitVolumeM3: 0.05 }))).toBe(20); // 500 kg left / 25; 1 m3 left / 0.05 = 20
    expect(room(bin('B', { maxQty: 50 }), item())).toBe(50);
    expect(room(bin('C', { maxQty: 50, contents: [{ itemId: 'x', batchKey: NIL, qty: 1, hazardClass: null, unitWeightKg: null, unitVolumeM3: null }] }), item())).toBe(0);
  });
});

describe('put-away suggestion', () => {
  it('prefers the fixed bin, then the same batch, then the nearest empty bin', () => {
    const bins = [bin('A-01-1', { pickSequence: 10 }), bin('A-02-1', { pickSequence: 20, contents: [{ itemId: 'i1', batchKey: 'b1', qty: 5, hazardClass: null, unitWeightKg: null, unitVolumeM3: null }] }), bin('Z-09-1', { pickSequence: 999, fixedItemId: 'i1' })];
    expect(suggestPutaway(item({ batchKey: 'b1' }), bins).placements[0]).toMatchObject({ code: 'Z-09-1', reason: 'fixed bin of the item' });
    expect(suggestPutaway(item({ batchKey: 'b1' }), bins.slice(0, 2)).placements[0]).toMatchObject({ code: 'A-02-1', reason: 'already holds this batch' });
    expect(suggestPutaway(item({ itemId: 'i2' }), bins.slice(0, 2)).placements[0]).toMatchObject({ code: 'A-01-1', reason: 'nearest empty bin' });
  });

  it('sends slow movers away from the dock', () => {
    const bins = [bin('A', { pickSequence: 10 }), bin('B', { pickSequence: 500 })];
    expect(suggestPutaway(item({ abcClass: 'C' }), bins).placements[0].code).toBe('B');
    expect(suggestPutaway(item({ abcClass: 'A' }), bins).placements[0].code).toBe('A');
  });

  it('respects condition, other items fixed bins and hazard segregation', () => {
    const bins = [
      bin('AMB', { pickSequence: 1 }),
      bin('COLD', { condition: 'cold' }),
      bin('H1', { condition: 'hazardous', pickSequence: 1, contents: [{ itemId: 'sol', batchKey: NIL, qty: 5, hazardClass: '3', unitWeightKg: null, unitVolumeM3: null }] }),
      bin('H2', { condition: 'hazardous', pickSequence: 2 }),
      bin('FIX', { pickSequence: 0, fixedItemId: 'other' }),
    ];
    expect(suggestPutaway(item({ condition: 'cold' }), bins).placements.map((p) => p.code)).toEqual(['COLD']);
    expect(suggestPutaway(item({ hazardClass: '5.1' }), bins).placements.map((p) => p.code)).toEqual(['H2']);
    expect(suggestPutaway(item(), bins).placements[0].code).toBe('AMB');
  });

  it('splits over bins by capacity and reports what does not fit', () => {
    const bins = [bin('A', { pickSequence: 1, maxQty: 6 }), bin('B', { pickSequence: 2, maxQty: 3 })];
    const r = suggestPutaway(item({ qty: 12 }), bins);
    expect(r.placements.map((p) => [p.code, p.qty])).toEqual([['A', 6], ['B', 3]]);
    expect(r.unplaced).toBe(3);
  });

  it('puts held lots in quarantine when there is a quarantine zone', () => {
    const bins = [bin('A', { pickSequence: 1 }), bin('Q', { zoneKind: 'quarantine', condition: 'quarantine' })];
    expect(suggestPutaway(item({ held: true }), bins).placements[0]).toMatchObject({ code: 'Q', reason: 'quarantine bin' });
    expect(suggestPutaway(item({ held: true }), [bins[0]]).placements[0].code).toBe('A');
  });
});
