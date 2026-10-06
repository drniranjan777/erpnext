import { z } from 'zod';
import { decimalSchema, optionalText } from '../../common/validators';

const positive = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v) && Number(v) > 0, `${label} must be more than zero (up to 4 decimals)`);
const qty = positive('Quantity');
/** Zero or more. */
const qty0 = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || String(v).trim() === '' ? '0' : String(v).trim()))
  .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v), 'Quantity: a number with up to 4 decimals');
const isoDate = z.iso.date();

export const createChallanSchema = z.object({
  jobWorkerId: z.uuid(),
  warehouseId: z.uuid(),
  docDate: isoDate.optional(),
  process: z.string().trim().min(2, 'Describe the process (machining, plating…)').max(200),
  expectedReturnDate: isoDate.nullable().optional(),
  transporter: optionalText(100),
  vehicleNo: optionalText(20),
  notes: optionalText(1000),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        qty,
        /** Value per base unit for the challan; blank = stock cost. */
        rate: decimalSchema(4, 'Rate').nullable().optional(),
        goodsType: z.enum(['inputs', 'capital_goods']).default('inputs'),
        batchNo: optionalText(40),
        description: optionalText(300),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
});
export type CreateChallanInput = z.infer<typeof createChallanSchema>;
export const updateChallanSchema = createChallanSchema.extend({ version: z.number().int() });

export const createReceiptSchema = z.object({
  challanId: z.uuid(),
  docDate: isoDate.optional(),
  warehouseId: z.uuid(),
  jwChallanNo: optionalText(40),
  jwChallanDate: isoDate.nullable().optional(),
  natureOfJob: optionalText(200),
  jobCharges: decimalSchema(2, 'Job charges').transform((v) => v ?? '0'),
  notes: optionalText(1000),
  outputs: z
    .array(z.object({ itemId: z.uuid(), qty, batchNo: optionalText(40) }))
    .max(100)
    .default([]),
  materials: z
    .array(
      z.object({
        challanLineId: z.uuid(),
        consumedQty: qty0,
        returnedQty: qty0,
        lossQty: qty0,
      }),
    )
    .max(200)
    .default([]),
});
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;
export const updateReceiptSchema = createReceiptSchema.extend({ version: z.number().int() });

export const jobworkListSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  jobWorkerId: z.uuid().optional(),
  challanId: z.uuid().optional(),
  pending: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type JobworkListQuery = z.infer<typeof jobworkListSchema>;

export const periodSchema = z.object({
  companyId: z.uuid().optional(),
  from: isoDate,
  to: isoDate,
  format: z.enum(['json', 'csv']).default('json'),
});
