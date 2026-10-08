import { ALL_DOC_TYPES } from '@nextgen/database';
import { z } from 'zod';

const docTypeSchema = z.enum(ALL_DOC_TYPES as [string, ...string[]]);
const isoDate = z.iso.date();
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,16}(\.\d{1,2})?$/.test(v), 'Enter an amount with up to 2 decimals');

// ---- Number series ----
export const createSeriesSchema = z.object({
  docType: docTypeSchema,
  companyId: z.uuid(),
  branchId: z.uuid().nullable().optional(),
  name: z.string().trim().min(1).max(60),
  pattern: z.string().trim().min(5).max(60),
  padding: z.number().int().min(1).max(10).default(4),
  reset: z.enum(['yearly', 'monthly', 'never']).default('yearly'),
  startAt: z.number().int().min(1).max(1_000_000_000).default(1),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;

export const updateSeriesSchema = z.object({
  version: z.number().int(),
  name: z.string().trim().min(1).max(60).optional(),
  pattern: z.string().trim().min(5).max(60).optional(),
  padding: z.number().int().min(1).max(10).optional(),
  reset: z.enum(['yearly', 'monthly', 'never']).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateSeriesInput = z.infer<typeof updateSeriesSchema>;

export const previewSeriesSchema = z.object({
  docType: z.string(),
  pattern: z.string().max(60),
  padding: z.number().int().min(1).max(10).optional(),
  startAt: z.number().int().min(1).optional(),
  branchCode: z.string().max(10).optional(),
  docDate: isoDate.optional(),
});
export type PreviewSeriesInput = z.infer<typeof previewSeriesSchema>;

export const listSeriesSchema = z.object({ docType: z.string().optional() });

// ---- Approval rules ----
const stepSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    approverRoleId: z.uuid().nullable().optional(),
    approverUserId: z.uuid().nullable().optional(),
  })
  .refine((s) => !!s.approverRoleId !== !!s.approverUserId, 'Each level needs exactly one approver: a role or a user');

export const approvalRuleSchema = z
  .object({
    docType: docTypeSchema,
    name: z.string().trim().min(2).max(80),
    companyId: z.uuid().nullable().optional(),
    branchId: z.uuid().nullable().optional(),
    minAmount: money.nullable().optional(),
    maxAmount: money.nullable().optional(),
    /** Optional extra condition: discount_above, margin_below or credit_exceeded. */
    condition: z.enum(['discount_above', 'margin_below', 'credit_exceeded']).nullable().optional(),
    conditionValue: money.nullable().optional(),
    priority: z.number().int().min(0).max(10_000).default(100),
    isActive: z.boolean().default(true),
    steps: z.array(stepSchema).min(1, 'Add at least one approval level').max(6),
  })
  .refine((r) => !r.minAmount || !r.maxAmount || Number(r.minAmount) <= Number(r.maxAmount), {
    message: 'Minimum amount must not exceed maximum amount',
    path: ['maxAmount'],
  })
  .refine((r) => !r.condition || r.condition === 'credit_exceeded' || (r.conditionValue !== null && r.conditionValue !== undefined), {
    message: 'Enter the percentage for this condition',
    path: ['conditionValue'],
  });
export type ApprovalRuleInput = z.infer<typeof approvalRuleSchema>;

// ---- Document actions ----
export const versionSchema = z.object({ version: z.number().int() });

export const decisionSchema = z.object({
  version: z.number().int(),
  comment: z.string().trim().max(1000).optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

export const rejectSchema = z.object({
  version: z.number().int(),
  comment: z.string().trim().min(3, 'Tell the requester why it was rejected').max(1000),
});

export const cancelSchema = z.object({
  version: z.number().int(),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
});
export type CancelInput = z.infer<typeof cancelSchema>;

export const commentSchema = z.object({ message: z.string().trim().min(1).max(2000) });

export const searchSchema = z.object({
  q: z.string().trim().max(60).optional(),
  docType: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
