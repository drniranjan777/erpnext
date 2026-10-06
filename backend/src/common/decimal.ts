/**
 * Exact decimal arithmetic for money and quantities (no binary floating point).
 * Values travel as strings ("1234.50") matching PostgreSQL numeric.
 * Internally scaled BigInts; rounding is half-up (away from zero).
 */

const SCALE = 6; // internal precision
const FACTOR = 10n ** BigInt(SCALE);

export class Decimal {
  private constructor(private readonly units: bigint) {}

  static from(v: string | number | Decimal | null | undefined): Decimal {
    if (v instanceof Decimal) return v;
    if (v === null || v === undefined || v === '') return new Decimal(0n);
    const s = typeof v === 'number' ? v.toFixed(SCALE) : v.trim();
    const m = s.match(/^([+-])?(\d+)(?:\.(\d+))?$/);
    if (!m) throw new Error(`Invalid decimal: ${v}`);
    const [, sign, int, frac = ''] = m;
    const fracScaled = BigInt((frac + '0'.repeat(SCALE)).slice(0, SCALE));
    // Round half-up on the digit beyond SCALE
    const roundUp = frac.length > SCALE && Number(frac[SCALE]) >= 5 ? 1n : 0n;
    const units = BigInt(int) * FACTOR + fracScaled + roundUp;
    return new Decimal(sign === '-' ? -units : units);
  }

  static sum(values: (string | number | Decimal | null | undefined)[]): Decimal {
    return values.reduce<Decimal>((acc, v) => acc.add(Decimal.from(v)), new Decimal(0n));
  }

  add(o: Decimal): Decimal {
    return new Decimal(this.units + o.units);
  }

  sub(o: Decimal): Decimal {
    return new Decimal(this.units - o.units);
  }

  mul(o: Decimal): Decimal {
    return new Decimal(Decimal.roundDiv(this.units * o.units, FACTOR));
  }

  /** Division rounded half-up at the internal precision (6 dp). */
  div(o: Decimal): Decimal {
    if (o.units === 0n) throw new Error('Division by zero');
    return new Decimal(Decimal.roundDiv(this.units * FACTOR, o.units));
  }

  static fromRatio(numerator: Decimal, denominator: Decimal): Decimal {
    return numerator.div(denominator);
  }

  isZero() {
    return this.units === 0n;
  }

  isNegative() {
    return this.units < 0n;
  }

  cmp(o: Decimal): -1 | 0 | 1 {
    return this.units === o.units ? 0 : this.units < o.units ? -1 : 1;
  }

  /** Fixed-point string with `dp` decimals (half-up), e.g. toFixed(2) → "1234.50". */
  toFixed(dp: number): string {
    const divisor = 10n ** BigInt(SCALE - dp);
    const rounded = Decimal.roundDiv(this.units, divisor);
    const neg = rounded < 0n;
    const abs = neg ? -rounded : rounded;
    const s = abs.toString().padStart(dp + 1, '0');
    const int = dp ? s.slice(0, -dp) : s;
    const frac = dp ? s.slice(-dp) : '';
    return `${neg ? '-' : ''}${int}${dp ? `.${frac}` : ''}`;
  }

  private static roundDiv(n: bigint, d: bigint): bigint {
    const q = n / d;
    const r = n % d;
    if (r === 0n) return q;
    const twice = (r < 0n ? -r : r) * 2n;
    if (twice >= d) return n < 0n ? q - 1n : q + 1n;
    return q;
  }
}
