import { z } from 'zod';
import { decimalSchema, optionalText } from '../../common/validators';

const isoDate = z.iso.date();
const positive = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v) && Number(v) > 0, `${label} must be more than zero (up to 4 decimals)`);

export const sellingLineSchema = z.object({
  /** Existing line (kept on amendment). */
  id: z.uuid().optional(),
  itemId: z.uuid(),
  uomId: z.uuid().nullable().optional(),
  description: optionalText(500),
  qty: positive('Quantity'),
  /** Blank = price list rate. */
  rate: decimalSchema(4, 'Rate'),
  discountPct: decimalSchema(2, 'Discount %').refine((v) => v === null || Number(v) <= 100, 'At most 100%'),
  deliveryDate: isoDate.nullable().optional(),
  quotationLineId: z.uuid().nullable().optional(),
  remarks: optionalText(300),
});
export type SellingLineInput = z.infer<typeof sellingLineSchema>;

const customerHeader = {
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: isoDate.optional(),
  customerId: z.uuid(),
  shippingAddressId: z.uuid().nullable().optional(),
  withLut: z.boolean().default(false),
  paymentTerms: optionalText(200),
  creditDays: z.number().int().min(0).max(365).nullable().optional(),
  terms: optionalText(4000),
  notes: optionalText(2000),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

// ---- Quotation ----
const quotation = {
  ...customerHeader,
  validUntil: isoDate.nullable().optional(),
  customerEnquiryRef: optionalText(80),
  lines: z.array(sellingLineSchema).min(1, 'Add at least one item').max(300),
};
export const createQuotationSchema = z.object(quotation);
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export const updateQuotationSchema = z.object({ ...quotation, version: z.number().int() });

// ---- Sales order ----
const order = {
  ...customerHeader,
  quotationId: z.uuid().nullable().optional(),
  customerPoNo: optionalText(60),
  customerPoDate: isoDate.nullable().optional(),
  warehouseId: z.uuid().nullable().optional(),
  expectedDate: isoDate.nullable().optional(),
  lines: z.array(sellingLineSchema).min(1, 'Add at least one item').max(300),
};
export const createOrderSchema = z.object(order);
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export const updateOrderSchema = z.object({ ...order, version: z.number().int() });

export const submitOrderSchema = z.object({
  version: z.number().int(),
  /** Holders of sales.orders.credit_override may submit past the credit limit with a reason. */
  creditOverrideReason: optionalText(500),
});

// ---- Delivery note ----
const deliveryLineSchema = z.object({
  soLineId: z.uuid(),
  qty: positive('Quantity'),
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
const delivery = {
  orderId: z.uuid(),
  docDate: isoDate.optional(),
  warehouseId: z.uuid().nullable().optional(),
  transporter: optionalText(120),
  transporterGstin: optionalText(15),
  vehicleNo: z
    .string()
    .trim()
    .toUpperCase()
    .max(15)
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/[\s-]/g, '') : null)),
  lrNo: optionalText(40),
  lrDate: isoDate.nullable().optional(),
  distanceKm: z.number().int().min(0).max(4000).nullable().optional(),
  packages: z.number().int().min(0).max(100000).nullable().optional(),
  grossWeightKg: decimalSchema(3, 'Gross weight'),
  netWeightKg: decimalSchema(3, 'Net weight'),
  notes: optionalText(2000),
  lines: z.array(deliveryLineSchema).min(1, 'Deliver at least one line').max(300),
};
export const createDeliverySchema = z.object(delivery);
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export const updateDeliverySchema = z.object({ ...delivery, version: z.number().int() });
export const podSchema = z.object({ deliveredAt: z.iso.datetime({ offset: true }).optional(), podNote: optionalText(500) });

// ---- Sales invoice ----
export const invoiceLineSchema = sellingLineSchema.extend({
  soLineId: z.uuid().nullable().optional(),
  dlvLineId: z.uuid().nullable().optional(),
  batchNo: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  serialNos: z.array(z.string().trim().min(1).max(60)).max(1000).nullable().optional(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
const invoice = {
  ...customerHeader,
  orderId: z.uuid().nullable().optional(),
  customerPoNo: optionalText(60),
  customerPoDate: isoDate.nullable().optional(),
  /** For stock lines without a delivery note. */
  warehouseId: z.uuid().nullable().optional(),
  transporter: optionalText(120),
  vehicleNo: optionalText(15),
  lrNo: optionalText(40),
  lines: z.array(invoiceLineSchema).min(1, 'Add at least one line').max(300),
};
export const createInvoiceSchema = z.object(invoice);
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export const updateInvoiceSchema = z.object({ ...invoice, version: z.number().int() });

// ---- Credit note ----
const creditLineSchema = z.object({
  invoiceLineId: z.uuid(),
  qty: positive('Quantity'),
  /** Return: blank = invoiced net rate. Price adjustment: reduction per unit. */
  rate: decimalSchema(4, 'Rate'),
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
const credit = {
  invoiceId: z.uuid(),
  docDate: isoDate.optional(),
  kind: z.enum(['return', 'price_adjustment']),
  reason: z.string().trim().min(3, 'Enter the reason').max(300),
  warehouseId: z.uuid().nullable().optional(),
  notes: optionalText(2000),
  lines: z.array(creditLineSchema).min(1, 'Add at least one line').max(300),
};
export const createCreditSchema = z.object(credit);
export type CreateCreditInput = z.infer<typeof createCreditSchema>;
export const updateCreditSchema = z.object({ ...credit, version: z.number().int() });

// ---- Lists & lookups ----
export const listSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  customerId: z.uuid().optional(),
  /** Orders: approved with quantity still to deliver. Invoices: approved and not fully received. */
  pending: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type ListQuery = z.infer<typeof listSchema>;

export const priceQuerySchema = z.object({
  customerId: z.uuid().optional(),
  itemId: z.uuid(),
  uomId: z.uuid().optional(),
  qty: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/).default('1'),
});

export const atpQuerySchema = z.object({ itemIds: z.string().transform((v) => v.split(',').filter(Boolean)), warehouseId: z.uuid().optional() });

export const previewSchema = z.object({
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  customerId: z.uuid(),
  shippingAddressId: z.uuid().nullable().optional(),
  withLut: z.boolean().default(false),
  lines: z.array(sellingLineSchema.pick({ itemId: true, uomId: true, qty: true, rate: true, discountPct: true })).max(300),
});
export type PreviewInput = z.infer<typeof previewSchema>;
