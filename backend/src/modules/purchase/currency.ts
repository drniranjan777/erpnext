import { z } from 'zod';
import { Decimal } from '../../common/decimal';
import { decimalSchema } from '../../common/validators';

/** Header fields for import orders / bills priced in a foreign currency. */
export const currencyFields = {
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code (USD, EUR…)')
    .default('INR'),
  /** INR per unit of the currency. */
  exchangeRate: decimalSchema(6, 'Exchange rate'),
};

/** Line rate in the foreign currency; the INR rate is derived from it. */
export const foreignRateField = { foreignRate: decimalSchema(4, 'Foreign rate') };

type WithCurrency = { currency: string; exchangeRate: string | null; lines: { rate: string; foreignRate?: string | null }[] };

/**
 * Normalises currency input: INR documents carry no foreign rates; foreign ones need an
 * exchange rate and get each line's INR rate from its foreign rate (4 decimals).
 */
export function applyCurrency<T extends WithCurrency>(v: T, ctx: z.RefinementCtx): T {
  if (v.currency === 'INR') return { ...v, exchangeRate: '1', lines: v.lines.map((l) => ({ ...l, foreignRate: null })) };
  if (!v.exchangeRate || Number(v.exchangeRate) <= 0) {
    ctx.addIssue({ code: 'custom', path: ['exchangeRate'], message: `Enter the exchange rate (₹ per ${v.currency})` });
    return v;
  }
  const fx = Decimal.from(v.exchangeRate);
  return {
    ...v,
    lines: v.lines.map((l) =>
      l.foreignRate ? { ...l, rate: Decimal.from(l.foreignRate).mul(fx).toFixed(4) } : { ...l, foreignRate: Decimal.from(l.rate).div(fx).toFixed(4) },
    ),
  };
}
