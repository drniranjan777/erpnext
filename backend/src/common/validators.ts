import { gstinError, GST_RATES, HSN_REGEX, IFSC_REGEX, PAN_REGEX, PINCODE_REGEX } from '@nextgen/database';
import { z } from 'zod';

/** "" / null / undefined → null; otherwise trimmed text. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/** GSTIN with format + check-digit validation (empty → null). */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .superRefine((v, ctx) => {
    if (!v) return;
    const err = gstinError(v);
    if (err) ctx.addIssue({ code: 'custom', message: err });
  });

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => !v || PAN_REGEX.test(v), 'Enter a valid 10-character PAN');

export const ifscSchema = z.string().trim().toUpperCase().regex(IFSC_REGEX, 'Enter a valid 11-character IFSC');
export const pincodeSchema = z.string().trim().regex(PINCODE_REGEX, 'Enter a valid 6-digit PIN code');
export const stateCodeSchema = z.string().regex(/^\d{2}$/, 'Choose a state');

export const hsnSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => !v || HSN_REGEX.test(v), 'HSN/SAC must be 4, 6 or 8 digits');

export const gstRateSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(Number(v)))
  .refine((v) => (GST_RATES as readonly string[]).includes(v), `GST rate must be one of ${GST_RATES.join(', ')}%`)
  .nullable()
  .optional();

/** Non-negative decimal as a string with up to `dp` decimals ("" / null → null). */
export const decimalSchema = (dp: number, label = 'Value') =>
  z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
    .refine((v) => v === null || new RegExp(`^\\d{1,14}(\\.\\d{1,${dp}})?$`).test(v), `${label}: a number with up to ${dp} decimals`);
