import { z } from 'zod';
import { optionalText } from '../../common/validators';

const isoDate = z.iso.date();
const qty = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim() || '0')
    .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v), `${label}: a number with up to 4 decimals`);

export const grnLineSchema = z.object({
  poLineId: z.uuid(),
  /** Quantity that arrived, in the PO line's unit. */
  receivedQty: qty('Received'),
  /** Of which rejected at the gate / inspection (not taken into stock). */
  rejectedQty: qty('Rejected').default('0'),
  rejectionReason: optionalText(200),
  batchNo: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  mfgDate: isoDate.nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
  serialNos: z.array(z.string().trim().min(1).max(60)).max(1000).nullable().optional(),
  remarks: optionalText(300),
});
export type GrnLineInput = z.infer<typeof grnLineSchema>;

const header = {
  poId: z.uuid(),
  docDate: isoDate.optional(),
  /** Defaults to the PO's delivery warehouse. */
  warehouseId: z.uuid().nullable().optional(),
  supplierInvoiceNo: optionalText(40),
  supplierInvoiceDate: isoDate.nullable().optional(),
  challanNo: optionalText(40),
  gateEntryNo: optionalText(40),
  vehicleNo: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/[\s-]/g, '') : null)),
  transporter: optionalText(120),
  lrNo: optionalText(40),
  notes: optionalText(2000),
  lines: z.array(grnLineSchema).min(1, 'Receive at least one line').max(300),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createGrnSchema = z.object(header);
export type CreateGrnInput = z.infer<typeof createGrnSchema>;

export const updateGrnSchema = z.object({ ...header, version: z.number().int() });
export type UpdateGrnInput = z.infer<typeof updateGrnSchema>;

export const listGrnSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  poId: z.uuid().optional(),
  vendorId: z.uuid().optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type ListGrnQuery = z.infer<typeof listGrnSchema>;
