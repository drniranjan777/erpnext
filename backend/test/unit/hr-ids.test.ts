import { describe, expect, it } from 'vitest';
import { aadhaarValid, esicValid, ifscValid, maskPan, panValid, uanValid, verhoeffValid } from '../../src/modules/hr/ids';

describe('identity numbers', () => {
  it('checks Aadhaar with Verhoeff', () => {
    // Made-up numbers with a valid check digit (computed by the algorithm).
    expect(verhoeffValid('2363')).toBe(true);
    expect(aadhaarValid('234123412346')).toBe(true);
    expect(aadhaarValid('234123412345')).toBe(false);
    expect(aadhaarValid('123456789012')).toBe(false); // cannot start with 1
  });

  it('checks PAN, IFSC, UAN and ESIC formats', () => {
    expect(panValid('ABCPE1234F')).toBe(true);
    expect(panValid('ABCZE1234F')).toBe(false);
    expect(panValid('abcpe1234f')).toBe(false);
    expect(ifscValid('SBIN0001234')).toBe(true);
    expect(ifscValid('SBIN1001234')).toBe(false);
    expect(uanValid('100200300400')).toBe(true);
    expect(esicValid('3100123456')).toBe(true);
    expect(esicValid('31001234567890123')).toBe(true);
    expect(esicValid('310012345')).toBe(false);
  });

  it('masks PAN keeping the type and the last letters', () => {
    expect(maskPan('ABCPE1234F')).toBe('ABXXX1234F');
  });
});
