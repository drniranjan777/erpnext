import { z } from 'zod';
import { gstinSchema, optionalText } from '../../common/validators';

const isoDate = z.iso.date();

export const gstSettingsSchema = z.object({
  einvoice: z.boolean(),
  autoIrn: z.boolean(),
  ewayThreshold: z.number().int().min(0).max(10_000_000).default(50000),
});

export const irnCancelSchema = z.object({
  reasonCode: z.enum(['1', '2', '3', '4']),
  remark: z.string().trim().min(3, 'Give a remark (3–100 characters)').max(100),
});

export const bulkIrnSchema = z.object({ ids: z.array(z.uuid()).min(1).max(200) });

export const einvoiceListSchema = z.object({
  status: z.enum(['pending', 'generated', 'failed', 'cancelled', 'missing']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const ewbCreateSchema = z.object({
  documentId: z.uuid(),
  distanceKm: z.coerce.number().int().min(1, 'Distance must be at least 1 km').max(4000, 'Distance can be at most 4000 km'),
  transportMode: z.enum(['road', 'rail', 'air', 'ship']).default('road'),
  vehicleType: z.enum(['R', 'O']).default('R'),
  vehicleNo: optionalText(20),
  transporterId: gstinSchema,
  transporterName: optionalText(100),
  transDocNo: optionalText(15),
  transDocDate: isoDate.nullable().optional(),
});

export const ewbPartBSchema = z.object({
  vehicleNo: z.string().trim().min(4).max(20),
  fromPlace: z.string().trim().min(2).max(50),
  reasonCode: z.enum(['1', '2', '3', '4']).default('4'),
  remark: optionalText(50),
});

export const ewbExtendSchema = z.object({
  remainingKm: z.coerce.number().int().min(1).max(4000),
  fromPlace: z.string().trim().min(2).max(50),
  reasonCode: z.enum(['1', '2', '4', '5', '99']),
  remark: z.string().trim().min(3).max(50),
});

export const ewbCancelSchema = z.object({
  reasonCode: z.enum(['1', '2', '3', '4']),
  remark: z.string().trim().min(3).max(50),
});

export const ewbConsolidateSchema = z.object({
  ids: z.array(z.uuid()).min(2, 'Pick at least two e-way bills').max(100),
  vehicleNo: z.string().trim().min(4).max(20),
  fromPlace: z.string().trim().min(2).max(50),
});

export const ewbListSchema = z.object({
  status: z.enum(['active', 'cancelled', 'expiring']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const gstPeriodSchema = z.object({
  companyId: z.uuid().optional(),
  from: isoDate,
  to: isoDate,
  format: z.enum(['json', 'csv']).default('json'),
});
