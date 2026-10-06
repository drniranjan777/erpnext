import { z } from 'zod';
import { decimalSchema, optionalText } from '../../common/validators';

const isoDate = z.iso.date();

/** Signed decimal (adjustments may be negative). */
const signedQty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,14}(\.\d{1,4})?$/.test(v), 'Quantity: a number with up to 4 decimals')
  .refine((v) => Number(v) !== 0, 'Quantity cannot be zero');

export const PURPOSES = ['opening_stock', 'material_receipt', 'material_issue', 'transfer', 'adjustment'] as const;
export type Purpose = (typeof PURPOSES)[number];

export const stockEntryLineSchema = z.object({
  itemId: z.uuid(),
  /** Defaults to the item's base unit. */
  uomId: z.uuid().optional().nullable(),
  qty: signedQty,
  /** Rate per line unit. Required for opening stock; defaults to the valuation rate otherwise. */
  rate: decimalSchema(4, 'Rate'),
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
export type StockEntryLineInput = z.infer<typeof stockEntryLineSchema>;

const header = {
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: isoDate.optional(),
  purpose: z.enum(PURPOSES),
  fromWarehouseId: z.uuid().nullable().optional(),
  toWarehouseId: z.uuid().nullable().optional(),
  reason: optionalText(200),
  reference: optionalText(100),
  notes: optionalText(2000),
  lines: z.array(stockEntryLineSchema).min(1, 'Add at least one item').max(500),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createStockEntrySchema = z.object(header);
export type CreateStockEntryInput = z.infer<typeof createStockEntrySchema>;

export const updateStockEntrySchema = z.object({ ...header, version: z.number().int() });
export type UpdateStockEntryInput = z.infer<typeof updateStockEntrySchema>;

export const listStockEntriesSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  purpose: z.enum(PURPOSES).optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type ListStockEntriesQuery = z.infer<typeof listStockEntriesSchema>;

// ---- reports ----

export const stockLevelsSchema = z.object({
  warehouseId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  /** Only items at or below their reorder level. */
  belowReorder: z.enum(['true', 'false']).optional(),
  /** Include items with no stock. */
  includeZero: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
export type StockLevelsQuery = z.infer<typeof stockLevelsSchema>;

export const ledgerSchema = z.object({
  itemId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  voucherId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.uuid().optional(),
});
export type LedgerQuery = z.infer<typeof ledgerSchema>;

export const batchesSchema = z.object({
  itemId: z.uuid(),
  warehouseId: z.uuid().optional(),
});

export const expiringSchema = z.object({
  days: z.coerce.number().int().min(0).max(3650).default(30),
  warehouseId: z.uuid().optional(),
});

// ---- physical stock count ----

const countQty = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
  .refine((v) => v === null || /^\d{1,14}(\.\d{1,4})?$/.test(v), 'Counted quantity: a number with up to 4 decimals');

export const createStockCountSchema = z.object({
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: isoDate.optional(),
  warehouseId: z.uuid(),
  /** Count one item group (and its sub-groups) instead of the whole warehouse. */
  itemGroupId: z.uuid().nullable().optional(),
  /** Also list items with no book stock here, to catch stock that was never recorded. */
  includeZeroStock: z.boolean().default(false),
  blind: z.boolean().default(false),
  notes: optionalText(2000),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type CreateStockCountInput = z.infer<typeof createStockCountSchema>;

export const updateStockCountSchema = z.object({
  version: z.number().int(),
  docDate: isoDate.optional(),
  blind: z.boolean().optional(),
  notes: optionalText(2000),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateStockCountInput = z.infer<typeof updateStockCountSchema>;

/** Counters record quantities line by line (no document version, so several people can count at once). */
export const recordCountsSchema = z.object({
  lines: z
    .array(z.object({ id: z.uuid(), countedQty: countQty, /** Omit to keep the existing remark. */ remarks: z.string().trim().max(300).optional() }))
    .min(1)
    .max(1000),
});
export type RecordCountsInput = z.infer<typeof recordCountsSchema>;

/** Stock found that isn't on the count sheet (new batch, unrecorded item). */
export const addCountLineSchema = z.object({
  itemId: z.uuid(),
  batchNo: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  mfgDate: isoDate.nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
  countedQty: countQty,
  remarks: optionalText(300),
});
export type AddCountLineInput = z.infer<typeof addCountLineSchema>;

export const listStockCountsSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
  warehouseId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type ListStockCountsQuery = z.infer<typeof listStockCountsSchema>;
