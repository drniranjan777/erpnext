import { gstinError, panFromGstin } from '@nextgen/database';
import { describe, expect, it } from 'vitest';

describe('GSTIN validation', () => {
  it('accepts real GSTINs with a correct check digit', () => {
    expect(gstinError('27AAPFU0939F1ZV')).toBeNull();
    expect(gstinError('29AAGCB7383J1Z4')).toBeNull();
    expect(gstinError('36AABCD1234E1Z9')).toBeNull();
  });

  it('rejects a wrong check digit, bad format and unknown state', () => {
    expect(gstinError('27AAPFU0939F1ZW')).toMatch(/check digit/);
    expect(gstinError('27AAPFU0939F1Z')).toMatch(/15-character/);
    expect(gstinError('99AAPFU0939F1ZV')).toMatch(/state code/);
  });

  it('extracts the PAN', () => {
    expect(panFromGstin('27AAPFU0939F1ZV')).toBe('AAPFU0939F');
  });
});
