import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateRecoveryCodes, generateSecret, otpauthUrl, totpAt, verifyTotp } from '../../src/common/totp';

// RFC 6238 Appendix B test secret "12345678901234567890" (SHA-1)
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC test vectors', () => {
    // T = 59 s → step 1 → 94287082 (8 digits) → last 6 = 287082
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpAt(RFC_SECRET, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('round-trips base32', () => {
    const buf = Buffer.from('hello NextGen ERP ₹');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts ±1 step of drift and rejects replays', () => {
    const secret = generateSecret();
    const at = 1_800_000_000_000;
    const step = Math.floor(at / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step), { at })).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), { at })).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), { at })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), { at, notAfterStep: step })).toBeNull();
    expect(verifyTotp(secret, 'abc123', { at })).toBeNull();
  });

  it('builds authenticator URLs and recovery codes', () => {
    expect(otpauthUrl('ABC', 'ravi@demo.local')).toBe(
      'otpauth://totp/NextGen%20ERP%3Aravi%40demo.local?secret=ABC&issuer=NextGen%20ERP&algorithm=SHA1&digits=6&period=30',
    );
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  });
});
