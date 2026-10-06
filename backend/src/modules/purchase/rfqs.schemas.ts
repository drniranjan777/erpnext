import { z } from 'zod';
import { decimalSchema, optionalText } from '../../common/validators';

const isoDate = z.iso.date();

const rfqHeader = {
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: isoDate.optional(),
  responseDueDate: isoDate.nullable().optional(),
  deliveryWarehouseId: z.uuid().nullable().optional(),
  terms: optionalText(4000),
  notes: optionalText(2000),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        uomId: z.uuid().nullable().optional(),
        description: optionalText(500),
        qty: z
          .union([z.string(), z.number()])
          .transform((v) => String(v).trim())
          .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero'),
        requiredBy: isoDate.nullable().optional(),
        requisitionLineId: z.uuid().nullable().optional(),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
  vendorIds: z.array(z.uuid()).min(1, 'Invite at least one vendor').max(30),
};
export const createRfqSchema = z.object(rfqHeader);
export type CreateRfqInput = z.infer<typeof createRfqSchema>;
export const updateRfqSchema = z.object({ ...rfqHeader, version: z.number().int() });

export const quoteSchema = z.object({
  quoteRef: optionalText(60),
  quoteDate: isoDate.nullable().optional(),
  validUntil: isoDate.nullable().optional(),
  paymentTerms: optionalText(200),
  creditDays: z.number().int().min(0).max(365).nullable().optional(),
  deliveryTerms: optionalText(200),
  otherCharges: decimalSchema(2, 'Other charges'),
  notes: optionalText(1000),
  lines: z
    .array(
      z.object({
        rfqLineId: z.uuid(),
        /** Blank = vendor did not quote this line. */
        rate: decimalSchema(4, 'Rate'),
        discountPct: decimalSchema(2, 'Discount %'),
        leadTimeDays: z.number().int().min(0).max(730).nullable().optional(),
        remarks: optionalText(300),
      }),
    )
    .max(200),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const awardSchema = z.object({
  /** Vendor chosen for each line; lines left out are not ordered. */
  lines: z.array(z.object({ rfqLineId: z.uuid(), vendorId: z.uuid() })).min(1).max(200),
});
export type AwardInput = z.infer<typeof awardSchema>;

export const listRfqSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export const itemVendorsSchema = z.object({
  vendors: z
    .array(
      z.object({
        vendorId: z.uuid(),
        isApproved: z.boolean().default(true),
        isPreferred: z.boolean().default(false),
        vendorItemCode: optionalText(60),
        leadTimeDays: z.number().int().min(0).max(730).nullable().optional(),
        minOrderQty: decimalSchema(4, 'Minimum order quantity'),
        notes: optionalText(300),
      }),
    )
    .max(50),
});
export type ItemVendorsInput = z.infer<typeof itemVendorsSchema>;
