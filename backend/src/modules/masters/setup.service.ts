import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  branches,
  companies,
  GST_UQC,
  itemGroups,
  items,
  priceListItems,
  priceLists,
  type Transaction,
  uoms,
  warehouses,
} from '@nextgen/database';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { pincodeSchema, stateCodeSchema } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';

const code = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(max)
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, 'Code: letters, digits, . _ / - only');

export const uomSchema = z.object({
  code: code(10),
  name: z.string().trim().min(1).max(60),
  decimals: z.number().int().min(0).max(6).default(3),
  uqc: z
    .string()
    .toUpperCase()
    .refine((v) => v in GST_UQC, 'Choose a GST unit (UQC)')
    .default('OTH'),
  isActive: z.boolean().default(true),
});

export const itemGroupSchema = z.object({
  code: code(20),
  name: z.string().trim().min(2).max(80),
  parentId: z.uuid().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const warehouseSchema = z.object({
  code: code(20),
  name: z.string().trim().min(2).max(80),
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  type: z.enum(['store', 'production', 'finished_goods', 'quarantine', 'rejected', 'scrap', 'transit', 'job_work']).default('store'),
  address: z
    .object({
      line1: z.string().trim().max(200).optional(),
      city: z.string().trim().max(80).optional(),
      stateCode: stateCodeSchema.optional(),
      pincode: pincodeSchema.optional(),
    })
    .default({}),
  isNettable: z.boolean().optional(),
  allowNegativeStock: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const priceListSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    type: z.enum(['selling', 'buying']),
    currency: z.string().length(3).toUpperCase().default('INR'),
    taxInclusive: z.boolean().default(false),
    validFrom: z.iso.date().nullable().optional(),
    validTo: z.iso.date().nullable().optional(),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
    items: z
      .array(
        z.object({
          itemId: z.uuid(),
          uomId: z.uuid(),
          minQty: z.union([z.string(), z.number()]).transform(String).default('0'),
          rate: z.union([z.string(), z.number()]).transform(String),
        }),
      )
      .max(5000)
      .default([]),
  })
  .refine((p) => !p.validFrom || !p.validTo || p.validFrom <= p.validTo, { message: 'Valid-to must be after valid-from', path: ['validTo'] });

const NON_NETTABLE = new Set(['quarantine', 'rejected', 'scrap', 'transit']);

/** Units, item groups, warehouses and price lists: small masters with simple rules. */
@Injectable()
export class SetupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ---- Units ----
  listUoms(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(uoms).orderBy(asc(uoms.code)));
  }

  saveUom(auth: AuthContext, id: string | null, input: z.infer<typeof uomSchema>, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.saveUomTx(tx, auth, id, input, meta));
  }

  async saveUomTx(tx: Transaction, auth: AuthContext, id: string | null, input: z.infer<typeof uomSchema>, meta: RequestMeta) {
    const [clash] = await tx.select({ id: uoms.id }).from(uoms).where(and(sql`${uoms.code} = ${input.code}`, id ? ne(uoms.id, id) : undefined));
    if (clash) throw new ConflictException(`Unit ${input.code} already exists`);
    if (id) {
      const [before] = await tx.select().from(uoms).where(eq(uoms.id, id));
      if (!before) throw new NotFoundException('Unit not found');
      if (input.decimals < before.decimals && (await this.uomInUse(tx, id))) {
        throw new ConflictException('This unit is used by items; you can increase decimals but not reduce them');
      }
      await tx.update(uoms).set({ ...input, updatedBy: auth.userId, version: before.version + 1 }).where(eq(uoms.id, id));
    } else {
      const [row] = await tx.insert(uoms).values({ ...input, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId }).returning({ id: uoms.id });
      id = row.id;
    }
    await this.log(tx, auth, 'masters.uom.saved', 'uom', id, { ...input }, meta);
    const [row] = await tx.select().from(uoms).where(eq(uoms.id, id));
    return row;
  }

  private async uomInUse(tx: Transaction, uomId: string) {
    const [r] = await tx.select({ n: count() }).from(items).where(eq(items.baseUomId, uomId));
    return Number(r.n) > 0;
  }

  // ---- Item groups ----
  listGroups(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: itemGroups.id,
          code: itemGroups.code,
          name: itemGroups.name,
          parentId: itemGroups.parentId,
          isActive: itemGroups.isActive,
          version: itemGroups.version,
          itemCount: sql<number>`(select count(*)::int from ${items} i where i.group_id = ${itemGroups.id} and i.deleted_at is null)`,
        })
        .from(itemGroups)
        .orderBy(asc(itemGroups.name));
      return rows;
    });
  }

  saveGroup(auth: AuthContext, id: string | null, input: z.infer<typeof itemGroupSchema>, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.saveGroupTx(tx, auth, id, input, meta));
  }

  async saveGroupTx(tx: Transaction, auth: AuthContext, id: string | null, input: z.infer<typeof itemGroupSchema>, meta: RequestMeta) {
    const [clash] = await tx.select({ id: itemGroups.id }).from(itemGroups).where(and(sql`${itemGroups.code} = ${input.code}`, id ? ne(itemGroups.id, id) : undefined));
    if (clash) throw new ConflictException(`Group code ${input.code} already exists`);
    if (input.parentId) {
      // Walk up from the new parent: it must exist, must not be this group, and depth ≤ 3.
      let cursor: string | null = input.parentId;
      let depth = 1;
      while (cursor) {
        if (cursor === id) throw new BadRequestException('A group cannot be inside itself');
        const [p] = await tx.select({ parentId: itemGroups.parentId }).from(itemGroups).where(eq(itemGroups.id, cursor));
        if (!p) throw new BadRequestException('Parent group not found');
        cursor = p.parentId;
        if (++depth > 3) throw new BadRequestException('Item groups can be nested at most 3 levels deep');
      }
    }
    if (id) {
      const [before] = await tx.select({ version: itemGroups.version }).from(itemGroups).where(eq(itemGroups.id, id));
      if (!before) throw new NotFoundException('Item group not found');
      await tx.update(itemGroups).set({ ...input, parentId: input.parentId ?? null, updatedBy: auth.userId, version: before.version + 1 }).where(eq(itemGroups.id, id));
    } else {
      const [row] = await tx
        .insert(itemGroups)
        .values({ ...input, parentId: input.parentId ?? null, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId })
        .returning({ id: itemGroups.id });
      id = row.id;
    }
    await this.log(tx, auth, 'masters.item_group.saved', 'item_group', id, { ...input }, meta);
    return { id };
  }

  // ---- Warehouses ----
  listWarehouses(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          id: warehouses.id,
          code: warehouses.code,
          name: warehouses.name,
          type: warehouses.type,
          companyId: warehouses.companyId,
          company: companies.name,
          branchId: warehouses.branchId,
          branch: branches.name,
          address: warehouses.address,
          isNettable: warehouses.isNettable,
          allowNegativeStock: warehouses.allowNegativeStock,
          isActive: warehouses.isActive,
          version: warehouses.version,
        })
        .from(warehouses)
        .innerJoin(companies, eq(companies.id, warehouses.companyId))
        .leftJoin(branches, eq(branches.id, warehouses.branchId))
        .orderBy(asc(warehouses.code)),
    );
  }

  saveWarehouse(auth: AuthContext, id: string | null, input: z.infer<typeof warehouseSchema>, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.saveWarehouseTx(tx, auth, id, input, meta));
  }

  async saveWarehouseTx(tx: Transaction, auth: AuthContext, id: string | null, input: z.infer<typeof warehouseSchema>, meta: RequestMeta) {
    const [clash] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(sql`${warehouses.code} = ${input.code}`, id ? ne(warehouses.id, id) : undefined));
    if (clash) throw new ConflictException(`Warehouse code ${input.code} already exists`);
    let companyId = input.companyId;
    if (!companyId) {
      const [c] = await tx.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
      companyId = c?.id;
    }
    if (!companyId) throw new BadRequestException('Create a company first');
    if (input.branchId) {
      const [b] = await tx.select({ companyId: branches.companyId }).from(branches).where(eq(branches.id, input.branchId));
      if (!b || b.companyId !== companyId) throw new BadRequestException('Branch does not belong to the company');
    }
    const values = {
      ...input,
      companyId,
      branchId: input.branchId ?? null,
      // Quarantine / rejected / scrap / transit stock isn't available for issue by default.
      isNettable: input.isNettable ?? !NON_NETTABLE.has(input.type),
    };
    if (id) {
      const [before] = await tx.select({ version: warehouses.version }).from(warehouses).where(eq(warehouses.id, id));
      if (!before) throw new NotFoundException('Warehouse not found');
      await tx.update(warehouses).set({ ...values, updatedBy: auth.userId, version: before.version + 1 }).where(eq(warehouses.id, id));
    } else {
      const [row] = await tx.insert(warehouses).values({ ...values, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId }).returning({ id: warehouses.id });
      id = row.id;
    }
    await this.log(tx, auth, 'inventory.warehouse.saved', 'warehouse', id, { code: input.code, name: input.name, type: input.type }, meta);
    return { id };
  }

  // ---- Price lists ----
  listPriceLists(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          id: priceLists.id,
          name: priceLists.name,
          type: priceLists.type,
          currency: priceLists.currency,
          taxInclusive: priceLists.taxInclusive,
          validFrom: priceLists.validFrom,
          validTo: priceLists.validTo,
          isDefault: priceLists.isDefault,
          isActive: priceLists.isActive,
          version: priceLists.version,
          itemCount: sql<number>`(select count(*)::int from ${priceListItems} p where p.price_list_id = ${priceLists.id})`,
        })
        .from(priceLists)
        .orderBy(asc(priceLists.type), asc(priceLists.name)),
    );
  }

  getPriceList(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [pl] = await tx.select().from(priceLists).where(eq(priceLists.id, id));
      if (!pl) throw new NotFoundException('Price list not found');
      const rows = await tx
        .select({ itemId: priceListItems.itemId, code: items.code, name: items.name, uomId: priceListItems.uomId, uom: uoms.code, minQty: priceListItems.minQty, rate: priceListItems.rate })
        .from(priceListItems)
        .innerJoin(items, eq(items.id, priceListItems.itemId))
        .innerJoin(uoms, eq(uoms.id, priceListItems.uomId))
        .where(eq(priceListItems.priceListId, id))
        .orderBy(asc(items.code), asc(priceListItems.minQty));
      const { tenantId: _t, ...rest } = pl;
      return { ...rest, items: rows };
    });
  }

  savePriceList(auth: AuthContext, id: string | null, input: z.infer<typeof priceListSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [clash] = await tx.select({ id: priceLists.id }).from(priceLists).where(and(sql`lower(${priceLists.name}) = lower(${input.name})`, id ? ne(priceLists.id, id) : undefined));
      if (clash) throw new ConflictException(`A price list named "${input.name}" already exists`);
      const errors: { path: string; message: string }[] = [];
      const seen = new Set<string>();
      input.items.forEach((r, i) => {
        if (!/^\d{1,14}(\.\d{1,4})?$/.test(r.rate)) errors.push({ path: `items.${i}.rate`, message: 'Rate: up to 4 decimals' });
        if (!/^\d{1,14}(\.\d{1,4})?$/.test(r.minQty)) errors.push({ path: `items.${i}.minQty`, message: 'Quantity: up to 4 decimals' });
        const key = `${r.itemId}:${r.uomId}:${Number(r.minQty)}`;
        if (seen.has(key)) errors.push({ path: `items.${i}`, message: 'Duplicate item / unit / quantity break' });
        seen.add(key);
      });
      if (input.items.length) {
        const ids = [...new Set(input.items.map((r) => r.itemId))];
        const found = await tx.select({ id: items.id }).from(items).where(inArray(items.id, ids));
        if (found.length !== ids.length) errors.push({ path: 'items', message: 'One or more items do not exist' });
      }
      if (errors.length) throw new BadRequestException({ message: 'Validation failed', errors });

      const { items: lines, ...header } = input;
      if (header.isDefault) await tx.update(priceLists).set({ isDefault: false }).where(and(eq(priceLists.type, header.type), id ? ne(priceLists.id, id) : undefined));
      const values = { ...header, validFrom: header.validFrom ?? null, validTo: header.validTo ?? null };
      if (id) {
        const [before] = await tx.select({ version: priceLists.version }).from(priceLists).where(eq(priceLists.id, id));
        if (!before) throw new NotFoundException('Price list not found');
        await tx.update(priceLists).set({ ...values, updatedBy: auth.userId, version: before.version + 1 }).where(eq(priceLists.id, id));
        await tx.delete(priceListItems).where(eq(priceListItems.priceListId, id));
      } else {
        const [row] = await tx.insert(priceLists).values({ ...values, tenantId: auth.tenantId, createdBy: auth.userId, updatedBy: auth.userId }).returning({ id: priceLists.id });
        id = row.id;
      }
      if (lines.length) {
        await tx.insert(priceListItems).values(lines.map((l) => ({ tenantId: auth.tenantId, priceListId: id!, itemId: l.itemId, uomId: l.uomId, minQty: l.minQty, rate: l.rate })));
      }
      await this.log(tx, auth, 'masters.price_list.saved', 'price_list', id, { name: input.name, type: input.type, lines: lines.length }, meta);
      return { id };
    });
  }

  private async log(tx: Transaction, auth: AuthContext, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>, meta: RequestMeta) {
    await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action, entityType, entityId, metadata, ...meta });
  }
}
