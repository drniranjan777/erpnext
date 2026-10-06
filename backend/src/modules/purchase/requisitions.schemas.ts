import { z } from 'zod';

const isoDate = z.iso.date();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Accepts "12.5" or 12.5; returns a normalised string. */
const decimal = (maxDp: number, label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => new RegExp(`^\\d{1,14}(\\.\\d{1,${maxDp}})?$`).test(v), `${label}: up to ${maxDp} decimals`);

export const requisitionLineSchema = z.object({
  /** Item master link. Optional: free-text lines are allowed for one-off purchases. */
  itemId: z.uuid().nullable().optional(),
  /** Unit from the UoM master (with an item: its base unit or a converted unit). */
  uomId: z.uuid().nullable().optional(),
  itemCode: optionalText(50),
  description: z.string().trim().min(2, 'Describe the item').max(500),
  uom: z.string().trim().min(1, 'Unit is required').max(20),
  quantity: decimal(4, 'Quantity').refine((v) => Number(v) > 0, 'Quantity must be more than zero'),
  estimatedRate: decimal(4, 'Rate').optional().nullable(),
  requiredBy: isoDate.optional().nullable(),
  remarks: optionalText(300),
});
export type RequisitionLineInput = z.infer<typeof requisitionLineSchema>;

const header = {
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: isoDate.optional(),
  requiredBy: isoDate.optional().nullable(),
  department: optionalText(80),
  purpose: optionalText(300),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  notes: optionalText(2000),
  lines: z.array(requisitionLineSchema).min(1, 'Add at least one item').max(200),
  /** Values for tenant-defined custom fields; validated against their definitions. */
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createRequisitionSchema = z.object(header);
export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;

export const updateRequisitionSchema = z.object({ ...header, version: z.number().int() });
export type UpdateRequisitionInput = z.infer<typeof updateRequisitionSchema>;

export const listRequisitionsSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  q: z.string().trim().max(60).optional(),
  mine: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type ListRequisitionsQuery = z.infer<typeof listRequisitionsSchema>;

export const amendSchema = z.object({
  version: z.number().int(),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
});
