import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { itemBarcodes, itemGroups, items, itemUomConversions, type Transaction, uoms } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import type { RequestMeta } from '../../common/request-meta';
import { decimalSchema, gstRateSchema, hsnSchema, optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CustomFieldsService } from '../customization/custom-fields.service';

export const ITEM_TYPES = [
  'raw_material',
  'packing_material',
  'semi_finished',
  'finished_good',
  'trading',
  'consumable',
  'spare',
  'service',
  'asset',
  'scrap',
  'by_product',
] as const;

const itemBody = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Code: letters, digits, . _ / - only')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(2).max(200),
  description: optionalText(2000),
  type: z.enum(ITEM_TYPES),
  groupId: z.uuid().nullable().optional(),
  baseUomId: z.uuid(),
  purchaseUomId: z.uuid().nullable().optional(),
  salesUomId: z.uuid().nullable().optional(),
  hsnCode: hsnSchema,
  gstRate: gstRateSchema,
  cessRate: decimalSchema(2, 'Cess %'),
  isNilRatedOrExempt: z.boolean().default(false),
  isStockItem: z.boolean().default(true),
  trackBatch: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  hasExpiry: z.boolean().default(false),
  shelfLifeDays: z.number().int().min(1).max(36500).nullable().optional(),
  minRemainingShelfLifeDays: z.number().int().min(0).max(36500).nullable().optional(),
  valuationMethod: z.enum(['weighted_average', 'fifo']).default('weighted_average'),
  reorderLevel: decimalSchema(4, 'Reorder level'),
  reorderQty: decimalSchema(4, 'Reorder quantity'),
  safetyStock: decimalSchema(4, 'Safety stock'),
  minOrderQty: decimalSchema(4, 'Minimum order quantity'),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
  standardCost: decimalSchema(4, 'Standard cost'),
  sellingRate: decimalSchema(4, 'Selling rate'),
  mrp: decimalSchema(2, 'MRP'),
  brand: optionalText(80),
  netWeightKg: decimalSchema(4, 'Net weight'),
  grossWeightKg: decimalSchema(4, 'Gross weight'),
  attributes: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
  abcClass: z.enum(['A', 'B', 'C']).nullable().optional(),
  isActive: z.boolean().default(true),
  conversions: z
    .array(z.object({ uomId: z.uuid(), factor: z.union([z.string(), z.number()]).transform(String) }))
    .max(20)
    .default([]),
  barcodes: z
    .array(z.object({ barcode: z.string().trim().min(3).max(64), uomId: z.uuid().nullable().optional(), isPrimary: z.boolean().default(false) }))
    .max(20)
    .default([]),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createItemSchema = z.object(itemBody);
export const updateItemSchema = z.object({ ...itemBody, version: z.number().int() });
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const listItemsSchema = z.object({
  q: z.string().trim().max(80).optional(),
  type: z.enum(ITEM_TYPES).optional(),
  groupId: z.uuid().optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});

const AUDIT_FIELDS = ['code', 'name', 'type', 'groupId', 'baseUomId', 'hsnCode', 'gstRate', 'cessRate', 'trackBatch', 'trackSerial', 'hasExpiry', 'valuationMethod', 'reorderLevel', 'standardCost', 'sellingRate', 'mrp', 'isActive'] as const;

@Injectable()
export class ItemsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly customFields: CustomFieldsService,
  ) {}

  list(auth: AuthContext, q: z.infer<typeof listItemsSchema>) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const base = tx.select({ id: uoms.id, code: uoms.code }).from(uoms).as('base');
      const rows = await tx
        .select({
          id: items.id,
          code: items.code,
          name: items.name,
          type: items.type,
          hsnCode: items.hsnCode,
          gstRate: items.gstRate,
          isStockItem: items.isStockItem,
          trackBatch: items.trackBatch,
          trackSerial: items.trackSerial,
          reorderLevel: items.reorderLevel,
          sellingRate: items.sellingRate,
          standardCost: items.standardCost,
          isActive: items.isActive,
          group: itemGroups.name,
          baseUom: base.code,
        })
        .from(items)
        .leftJoin(itemGroups, eq(itemGroups.id, items.groupId))
        .innerJoin(base, eq(base.id, items.baseUomId))
        .where(
          and(
            isNull(items.deletedAt),
            q.active === 'all' ? undefined : eq(items.isActive, q.active === 'true'),
            q.type ? eq(items.type, q.type) : undefined,
            q.groupId ? eq(items.groupId, q.groupId) : undefined,
            term
              ? or(
                  ilike(items.name, `%${term}%`),
                  ilike(items.code, `%${term}%`),
                  eq(items.hsnCode, term),
                  sql`exists (select 1 from ${itemBarcodes} b where b.item_id = ${items.id} and b.barcode = ${term})`,
                )
              : undefined,
            q.cursor ? lt(items.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(items.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  /** Compact search for pickers in document lines. */
  lookup(auth: AuthContext, term: string, opts: { stockOnly?: boolean } = {}) {
    return this.database.run(auth, async (tx) => {
      const t = term.replace(/[%_\\]/g, '');
      return tx
        .select({
          id: items.id,
          code: items.code,
          name: items.name,
          type: items.type,
          hsnCode: items.hsnCode,
          gstRate: items.gstRate,
          baseUomId: items.baseUomId,
          baseUom: uoms.code,
          purchaseUomId: items.purchaseUomId,
          lastPurchaseRate: items.lastPurchaseRate,
          standardCost: items.standardCost,
          sellingRate: items.sellingRate,
        })
        .from(items)
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .where(
          and(
            isNull(items.deletedAt),
            eq(items.isActive, true),
            opts.stockOnly ? eq(items.isStockItem, true) : undefined,
            t
              ? or(
                  ilike(items.code, `${t}%`),
                  ilike(items.name, `%${t}%`),
                  sql`exists (select 1 from ${itemBarcodes} b where b.item_id = ${items.id} and b.barcode = ${t})`,
                )
              : undefined,
          ),
        )
        .orderBy(sql`case when ${items.code} ilike ${t} then 0 when ${items.code} ilike ${`${t}%`} then 1 else 2 end`, asc(items.name))
        .limit(20);
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.load(tx, id));
  }

  create(auth: AuthContext, input: CreateItemInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  /** Same as create(), inside the caller's transaction (used by imports). */
  async createTx(tx: Transaction, auth: AuthContext, input: CreateItemInput, meta: RequestMeta) {
    const values = await this.validate(tx, input);
    const code = input.code ?? (await nextCode(tx, auth.tenantId, 'item', 'ITM'));
    await this.assertCodeFree(tx, code);
    const customFields = await this.customFields.validate(tx, 'item', input.customFields);
    const [row] = await tx
      .insert(items)
      .values({ ...values, code, customFields, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId })
      .returning({ id: items.id });
    await this.writeChildren(tx, auth.tenantId, row.id, input);
    await this.audit.log(tx, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: 'masters.item.created',
      entityType: 'item',
      entityId: row.id,
      metadata: { code, name: input.name, type: input.type },
      ...meta,
    });
    return this.load(tx, row.id);
  }

  async update(auth: AuthContext, id: string, input: UpdateItemInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select().from(items).where(and(eq(items.id, id), isNull(items.deletedAt))).for('update');
      if (!before) throw new NotFoundException('Item not found');
      if (before.version !== input.version) throw new ConflictException('This item was changed by someone else. Reload to see the latest version.');
      const values = await this.validate(tx, input);
      const code = input.code ?? before.code;
      if (code.toUpperCase() !== before.code.toUpperCase()) await this.assertCodeFree(tx, code, id);
      const customFields = await this.customFields.validate(tx, 'item', input.customFields, before.customFields);
      await tx
        .update(items)
        .set({ ...values, code, customFields, updatedBy: auth.userId, version: before.version + 1 })
        .where(eq(items.id, id));
      await tx.delete(itemUomConversions).where(eq(itemUomConversions.itemId, id));
      await tx.delete(itemBarcodes).where(eq(itemBarcodes.itemId, id));
      await this.writeChildren(tx, auth.tenantId, id, input);
      const after = { ...values, code } as Record<string, unknown>;
      const changes = this.audit.diff(
        Object.fromEntries(AUDIT_FIELDS.map((f) => [f, (before as Record<string, unknown>)[f]])),
        Object.fromEntries(AUDIT_FIELDS.map((f) => [f, after[f] ?? null])),
      );
      if (Object.keys(changes).length) {
        await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'masters.item.updated', entityType: 'item', entityId: id, changes, ...meta });
      }
      return this.load(tx, id);
    });
  }

  // ---- helpers ------------------------------------------------------------------

  /** Business rules beyond field validation. Returns the column values to store. */
  private async validate(tx: Transaction, input: CreateItemInput) {
    const errors: { path: string; message: string }[] = [];
    const service = input.type === 'service';
    const isStockItem = service ? false : input.isStockItem;
    if (service && (input.trackBatch || input.trackSerial || input.hasExpiry)) errors.push({ path: 'type', message: 'Services cannot track batches, serials or expiry' });
    if (input.hasExpiry && !input.trackBatch) errors.push({ path: 'hasExpiry', message: 'Expiry needs batch tracking (expiry is recorded per batch)' });
    if (input.trackBatch && input.trackSerial) errors.push({ path: 'trackSerial', message: 'Choose batch or serial tracking, not both' });
    if (input.gstRate === null || input.gstRate === undefined) {
      if (!input.isNilRatedOrExempt) errors.push({ path: 'gstRate', message: 'Choose a GST rate (or mark the item nil-rated/exempt)' });
    }
    if (input.isNilRatedOrExempt && input.gstRate && input.gstRate !== '0') errors.push({ path: 'gstRate', message: 'Nil-rated/exempt items must have 0% GST' });
    if (input.minRemainingShelfLifeDays && input.shelfLifeDays && input.minRemainingShelfLifeDays > input.shelfLifeDays) {
      errors.push({ path: 'minRemainingShelfLifeDays', message: 'Cannot exceed the shelf life' });
    }

    const uomIds = [...new Set([input.baseUomId, input.purchaseUomId, input.salesUomId, ...input.conversions.map((c) => c.uomId), ...input.barcodes.map((b) => b.uomId)].filter(Boolean) as string[])];
    const found = await tx.select({ id: uoms.id, code: uoms.code, decimals: uoms.decimals, isActive: uoms.isActive }).from(uoms).where(inArray(uoms.id, uomIds));
    const uomMap = new Map(found.map((u) => [u.id, u]));
    const base = uomMap.get(input.baseUomId);
    if (!base) errors.push({ path: 'baseUomId', message: 'Unknown unit' });
    if (base && input.trackSerial && base.decimals > 0) errors.push({ path: 'trackSerial', message: `Serial-tracked items need a whole-number base unit (not ${base.code})` });

    const convIds = new Set<string>();
    input.conversions.forEach((c, i) => {
      if (!uomMap.has(c.uomId)) errors.push({ path: `conversions.${i}.uomId`, message: 'Unknown unit' });
      if (c.uomId === input.baseUomId) errors.push({ path: `conversions.${i}.uomId`, message: 'The base unit needs no conversion' });
      if (convIds.has(c.uomId)) errors.push({ path: `conversions.${i}.uomId`, message: 'Duplicate unit' });
      convIds.add(c.uomId);
      if (!/^\d{1,12}(\.\d{1,6})?$/.test(c.factor) || Number(c.factor) <= 0) errors.push({ path: `conversions.${i}.factor`, message: 'Enter a positive number (up to 6 decimals)' });
    });
    for (const [field, id] of [['purchaseUomId', input.purchaseUomId], ['salesUomId', input.salesUomId]] as const) {
      if (id && id !== input.baseUomId && !convIds.has(id)) errors.push({ path: field, message: 'Add a conversion for this unit first' });
    }
    const codes = new Set<string>();
    input.barcodes.forEach((b, i) => {
      if (codes.has(b.barcode)) errors.push({ path: `barcodes.${i}.barcode`, message: 'Duplicate barcode' });
      codes.add(b.barcode);
      if (b.uomId && b.uomId !== input.baseUomId && !convIds.has(b.uomId)) errors.push({ path: `barcodes.${i}.uomId`, message: 'Add a conversion for this unit first' });
    });
    if (input.groupId) {
      const [g] = await tx.select({ id: itemGroups.id }).from(itemGroups).where(eq(itemGroups.id, input.groupId));
      if (!g) errors.push({ path: 'groupId', message: 'Unknown item group' });
    }
    if (errors.length) throw new BadRequestException({ message: 'Validation failed', errors });

    const { code: _c, conversions: _cv, barcodes: _b, customFields: _cf, ...rest } = input as UpdateItemInput;
    const { version: _v, ...fields } = rest as typeof rest & { version?: number };
    return {
      ...fields,
      isStockItem,
      gstRate: input.isNilRatedOrExempt ? '0' : (input.gstRate ?? null),
      cessRate: input.cessRate ?? '0',
      shelfLifeDays: input.hasExpiry ? (input.shelfLifeDays ?? null) : null,
      minRemainingShelfLifeDays: input.hasExpiry ? (input.minRemainingShelfLifeDays ?? null) : null,
      groupId: input.groupId ?? null,
      purchaseUomId: input.purchaseUomId ?? null,
      salesUomId: input.salesUomId ?? null,
      abcClass: input.abcClass ?? null,
    };
  }

  private async writeChildren(tx: Transaction, tenantId: string, itemId: string, input: CreateItemInput) {
    if (input.conversions.length) {
      await tx.insert(itemUomConversions).values(input.conversions.map((c) => ({ tenantId, itemId, uomId: c.uomId, factor: c.factor })));
    }
    if (input.barcodes.length) {
      const taken = await tx
        .select({ barcode: itemBarcodes.barcode, code: items.code })
        .from(itemBarcodes)
        .innerJoin(items, eq(items.id, itemBarcodes.itemId))
        .where(and(inArray(itemBarcodes.barcode, input.barcodes.map((b) => b.barcode)), ne(itemBarcodes.itemId, itemId)));
      if (taken.length) throw new ConflictException(`Barcode ${taken[0].barcode} is already used by item ${taken[0].code}`);
      const anyPrimary = input.barcodes.some((b) => b.isPrimary);
      await tx.insert(itemBarcodes).values(
        input.barcodes.map((b, i) => ({ tenantId, itemId, barcode: b.barcode, uomId: b.uomId ?? null, isPrimary: anyPrimary ? b.isPrimary : i === 0 })),
      );
    }
  }

  private async assertCodeFree(tx: Transaction, code: string, exceptId?: string) {
    const [clash] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(sql`${items.code} = ${code}`, exceptId ? ne(items.id, exceptId) : undefined));
    if (clash) throw new ConflictException(`Item code ${code} is already in use`);
  }

  private async load(tx: Transaction, id: string) {
    const [item] = await tx.select().from(items).where(and(eq(items.id, id), isNull(items.deletedAt)));
    if (!item) throw new NotFoundException('Item not found');
    const conversions = await tx
      .select({ uomId: itemUomConversions.uomId, uom: uoms.code, factor: itemUomConversions.factor })
      .from(itemUomConversions)
      .innerJoin(uoms, eq(uoms.id, itemUomConversions.uomId))
      .where(eq(itemUomConversions.itemId, id))
      .orderBy(asc(uoms.code));
    const barcodes = await tx
      .select({ id: itemBarcodes.id, barcode: itemBarcodes.barcode, uomId: itemBarcodes.uomId, isPrimary: itemBarcodes.isPrimary })
      .from(itemBarcodes)
      .where(eq(itemBarcodes.itemId, id))
      .orderBy(desc(itemBarcodes.isPrimary), asc(itemBarcodes.barcode));
    const { tenantId: _t, ...rest } = item;
    return { ...rest, conversions, barcodes };
  }
}
