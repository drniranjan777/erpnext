import { gstinError } from '@nextgen/database';
import { z } from 'zod';
import { GSTIN_REGEX } from '../auth/auth.schemas';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined));

export const addressSchema = z.object({
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(100),
  district: optionalText(100),
  stateCode: z.string().regex(/^[0-9]{2}$/).optional(),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code').optional(),
  country: z.string().length(2).default('IN'),
});

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(200),
  legalName: optionalText(200),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN')
    .refine((v) => !gstinError(v), 'GSTIN check digit is wrong. Please re-check the number.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  address: addressSchema.optional(),
  fyStartMonth: z.number().int().min(1).max(12).default(4),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** GSTIN can be added later (registrations often arrive after signup); fyStartMonth is fixed once set. */
export const updateCompanySchema = createCompanySchema.omit({ fyStartMonth: true });
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const listBranchesSchema = z.object({
  companyId: z.uuid().optional(),
});
