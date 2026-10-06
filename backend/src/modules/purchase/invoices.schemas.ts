import { z } from 'zod';
import { decimalSchema, optionalText } from '../../common/validators';
import { applyCurrency, currencyFields, foreignRateField } from './currency';

const isoDate = z.iso.date();
const amount = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v), `${label}: a number with up to 4 decimals`);
const positive = (label: string) => amount(label).refine((v) => Number(v) > 0, `${label} must be more than zero`);

// ---- Purchase invoice ----

export const piLineSchema = z.object({
  /** Three-way match: the GRN line being billed. */
  grnLineId: z.uuid().nullable().optional(),
  /** Two-way match (services): the PO line being billed. */
  poLineId: z.uuid().nullable().optional(),
  itemId: z.uuid(),
  uomId: z.uuid().nullable().optional(),
  description: optionalText(500),
  qty: positive('Quantity'),
  rate: amount('Rate'),
  discountPct: decimalSchema(2, 'Discount %'),
  /** False for blocked credits (s.17(5): vehicles, food, personal use...). */
  itcEligible: z.boolean().default(true),
  remarks: optionalText(300),
  ...foreignRateField,
});
export type PiLineInput = z.infer<typeof piLineSchema>;

const piHeader = {
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: isoDate.optional(),
  vendorId: z.uuid(),
  supplierInvoiceNo: z.string().trim().min(1, 'Enter the supplier invoice number').max(16, 'GST invoice numbers have at most 16 characters'),
  supplierInvoiceDate: isoDate,
  reverseCharge: z.boolean().default(false),
  ...currencyFields,
  tdsSection: optionalText(20),
  /** Overrides the section's default rate (lower-deduction certificate etc.). */
  tdsRate: decimalSchema(3, 'TDS rate'),
  creditDays: z.number().int().min(0).max(365).nullable().optional(),
  rateTolerancePct: decimalSchema(2, 'Rate tolerance'),
  varianceNote: optionalText(500),
  notes: optionalText(2000),
  /** Set when the bill was captured from a file (OCR / AI). */
  capture: z.object({ fileName: z.string().max(200), extractor: z.enum(['ai', 'text']), confidence: z.number().min(0).max(1), warnings: z.array(z.string().max(300)).max(50) }).nullable().optional(),
  lines: z.array(piLineSchema).min(1, 'Add at least one line').max(300),
  customFields: z.record(z.string(), z.unknown()).optional(),
};
export const createPiSchema = z.object(piHeader).transform(applyCurrency);
export type CreatePiInput = z.infer<typeof createPiSchema>;
export const updatePiSchema = z.object({ ...piHeader, version: z.number().int() }).transform(applyCurrency);
export type UpdatePiInput = z.infer<typeof updatePiSchema>;

export const listPiSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  vendorId: z.uuid().optional(),
  /** Approved bills not fully paid. */
  outstanding: z.enum(['true', 'false']).optional(),
  msme: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type ListPiQuery = z.infer<typeof listPiSchema>;

export const billableSchema = z.object({ vendorId: z.uuid(), poId: z.uuid().optional() });

// ---- Debit note ----

export const dnLineSchema = z.object({
  piLineId: z.uuid(),
  /** Returned quantity (return) or quantity the price reduction applies to (price adjustment). */
  qty: positive('Quantity'),
  /** Rate per line unit: the bill rate for a return, the reduction per unit for a price adjustment. */
  rate: amount('Rate').optional(),
  batchNo: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  serialNos: z.array(z.string().trim().min(1).max(60)).max(1000).nullable().optional(),
  remarks: optionalText(300),
});
export type DnLineInput = z.infer<typeof dnLineSchema>;

const dnHeader = {
  piId: z.uuid(),
  docDate: isoDate.optional(),
  kind: z.enum(['return', 'price_adjustment']),
  reason: z.string().trim().min(3, 'Enter the reason').max(300),
  warehouseId: z.uuid().nullable().optional(),
  vehicleNo: optionalText(15),
  notes: optionalText(2000),
  lines: z.array(dnLineSchema).min(1, 'Add at least one line').max(300),
};
export const createDnSchema = z.object(dnHeader);
export type CreateDnInput = z.infer<typeof createDnSchema>;
export const updateDnSchema = z.object({ ...dnHeader, version: z.number().int() });

export const listDnSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  piId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

// ---- Landed cost ----

export const CHARGE_TYPES = ['freight', 'customs_duty', 'insurance', 'clearing', 'loading', 'octroi', 'other'] as const;

const lcHeader = {
  docDate: isoDate.optional(),
  method: z.enum(['value', 'qty', 'weight']).default('value'),
  grnIds: z.array(z.uuid()).min(1, 'Choose the goods receipts').max(50),
  charges: z
    .array(
      z.object({
        chargeType: z.enum(CHARGE_TYPES),
        description: optionalText(200),
        vendorId: z.uuid().nullable().optional(),
        billRef: optionalText(40),
        amount: positive('Amount'),
      }),
    )
    .min(1, 'Add at least one charge')
    .max(50),
  notes: optionalText(2000),
};
export const createLcSchema = z.object(lcHeader);
export type CreateLcInput = z.infer<typeof createLcSchema>;
export const updateLcSchema = z.object({ ...lcHeader, version: z.number().int() });

export const listLcSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
