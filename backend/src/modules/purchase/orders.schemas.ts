import { z } from 'zod';
import { decimalSchema, optionalText } from '../../common/validators';
import { applyCurrency, currencyFields, foreignRateField } from './currency';

const isoDate = z.iso.date();

const positiveQty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero (up to 4 decimals)');

export const poLineSchema = z.object({
  /** Existing line (kept on amendment so receipts stay linked). */
  id: z.uuid().optional(),
  itemId: z.uuid(),
  uomId: z.uuid().nullable().optional(),
  description: optionalText(500),
  qty: positiveQty,
  rate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v), 'Rate: a number with up to 4 decimals'),
  discountPct: decimalSchema(2, 'Discount %').refine((v) => v === null || Number(v) <= 100, 'Discount cannot exceed 100%'),
  deliveryDate: isoDate.nullable().optional(),
  requisitionLineId: z.uuid().nullable().optional(),
  remarks: optionalText(300),
  ...foreignRateField,
});
export type PoLineInput = z.infer<typeof poLineSchema>;

const header = {
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: isoDate.optional(),
  poType: z.enum(['standard', 'service']).default('standard'),
  vendorId: z.uuid(),
  deliveryWarehouseId: z.uuid().nullable().optional(),
  expectedDate: isoDate.nullable().optional(),
  vendorQuoteRef: optionalText(100),
  paymentTerms: optionalText(200),
  creditDays: z.number().int().min(0).max(365).nullable().optional(),
  tolerancePct: decimalSchema(2, 'Tolerance %').refine((v) => v === null || Number(v) <= 100, 'At most 100%'),
  reverseCharge: z.boolean().default(false),
  ...currencyFields,
  terms: optionalText(4000),
  notes: optionalText(2000),
  lines: z.array(poLineSchema).min(1, 'Add at least one item').max(300),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createPoSchema = z.object(header).transform(applyCurrency);
export type CreatePoInput = z.infer<typeof createPoSchema>;

export const updatePoSchema = z.object({ ...header, version: z.number().int() }).transform(applyCurrency);
export type UpdatePoInput = z.infer<typeof updatePoSchema>;

export const listPoSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  vendorId: z.uuid().optional(),
  /** Approved orders with quantity still to receive. */
  pendingReceipt: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type ListPoQuery = z.infer<typeof listPoSchema>;

export const fromRequisitionSchema = z.object({
  requisitionId: z.uuid(),
  vendorId: z.uuid(),
  /** Requisition lines to order (default: every line with quantity still to order). */
  lineIds: z.array(z.uuid()).max(300).optional(),
  deliveryWarehouseId: z.uuid().nullable().optional(),
});
export type FromRequisitionInput = z.infer<typeof fromRequisitionSchema>;

export const shortCloseSchema = z.object({
  version: z.number().int(),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
});

export const previewTaxSchema = z.object({
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  vendorId: z.uuid(),
  reverseCharge: z.boolean().default(false),
  lines: z.array(poLineSchema.pick({ itemId: true, uomId: true, qty: true, rate: true, discountPct: true })).max(300),
});
export type PreviewTaxInput = z.infer<typeof previewTaxSchema>;
