import { gstinError } from '@nextgen/database';
import { z } from 'zod';

const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'admin', 'auth', 'mail', 'help', 'support', 'status', 'docs', 'static']);

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, 'Use 3–32 lowercase letters, numbers or hyphens')
  .refine((s) => !RESERVED_SLUGS.has(s), 'This workspace name is reserved');

export const signupSchema = z.object({
  workspaceName: z.string().trim().min(2).max(100),
  slug: slugSchema,
  industry: z.string().trim().max(50).optional(),
  companyName: z.string().trim().min(2).max(200),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN')
    .refine((v) => !gstinError(v), 'GSTIN check digit is wrong. Please re-check the number.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  fullName: z.string().trim().min(2).max(100),
  email,
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9][0-9]{9}$/, 'Enter a valid 10-digit Indian mobile number')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  password,
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  tenantSlug: slugSchema.optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const slugCheckSchema = z.object({ slug: slugSchema });

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(20).max(2000),
  /** 6-digit authenticator code or a recovery code like "7KQ4-M2XD". */
  code: z.string().trim().min(6).max(20),
});
