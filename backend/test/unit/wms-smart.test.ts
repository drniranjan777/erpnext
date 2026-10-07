import { describe, expect, it } from 'vitest';
import { gs1CheckDigit } from '../../src/modules/wms/outbound';
import { decodeSgtin96, faceLevels, gtinForms, pallets } from '../../src/modules/wms/smart';

describe('pallets', () => {
  it('rounds up to whole pallets', () => {
    expect(pallets(0, 40)).toBe(0);
    expect(pallets(40, 40)).toBe(1);
    expect(pallets(41, 40)).toBe(2);
    expect(pallets(-5, 40)).toBe(0);
  });
});

describe('pick-face levels', () => {
  it('sets min for the replenishment lead time with a safety margin, and max for the cover wanted', () => {
    const daily = [10, 10, 10, 30, 10, 10, 10, 10, 10, 10];
    expect(faceLevels(daily)).toEqual({ avg: 12, peak: 30, min: 21, max: 57 });
    expect(faceLevels(daily, { capacity: 40 })).toMatchObject({ min: 21, max: 40 });
    expect(faceLevels([0, 0, 0])).toEqual({ avg: 0, peak: 0, min: null, max: null });
  });
});

describe('SGTIN-96', () => {
  it('decodes the GS1 tag data standard example', () => {
    // urn:epc:id:sgtin:0614141.812345.6789, filter 3.
    const d = decodeSgtin96('3074257BF7194E4000001A85');
    const body = '8061414112345';
    expect(d).toEqual({ gtin: `${body}${gs1CheckDigit(body)}`, serial: '6789', filter: 3 });
    expect(decodeSgtin96('E2003412DC03011817112345')).toBeNull();
    expect(decodeSgtin96('30')).toBeNull();
  });
  it('lists the shorter GTIN forms', () => {
    expect(gtinForms('00890123456789')).toEqual(['00890123456789', '0890123456789', '890123456789']);
  });
});
