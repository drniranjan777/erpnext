import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { assetSpares, items, machines, maintAssets, meterReadings, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const LEVELS = ['plant', 'line', 'machine', 'assembly', 'component', 'utility'] as const;

export const assetSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(160),
  level: z.enum(LEVELS).default('machine'),
  parentId: z.uuid().nullable().optional(),
  machineId: z.uuid().nullable().optional(),
  location: optionalText(120),
  make: optionalText(80),
  model: optionalText(80),
  serialNo: optionalText(80),
  specs: optionalText(4000),
  installedOn: z.iso.date().nullable().optional(),
  warrantyUntil: z.iso.date().nullable().optional(),
  criticality: z.enum(['A', 'B', 'C']).default('B'),
  status: z.enum(['running', 'down', 'standby', 'retired']).default('running'),
  meterUnit: optionalText(20),
});
export type AssetInput = z.infer<typeof assetSchema>;
export const meterSchema = z.object({
  reading: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), 'Reading: a number'),
});
export const spareSchema = z.object({
  itemId: z.uuid(),
  isCritical: z.boolean().default(false),
  minQty: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())),
  alternateItemId: z.uuid().nullable().optional(),
});

/** The asset hierarchy, meter readings and the spares each asset uses. */
@Injectable()
export class AssetsService {
  constructor(private readonly database: DatabaseService) {}

  /** Every asset with its parent, open job count and warranty state, for the tree. */
  list(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.id, a.code, a.name, a.level, a.parent_id as "parentId", a.machine_id as "machineId", m.code as "machineCode", a.location, a.criticality, a.status,
                   a.meter_unit as "meterUnit", a.meter_reading::text as "meterReading", a.warranty_until::text as "warrantyUntil",
                   (a.warranty_until is not null and a.warranty_until >= (now() at time zone 'Asia/Kolkata')::date) as "inWarranty",
                   (select count(*)::int from maintenance_orders o join documents d on d.id = o.id where o.asset_id = a.id and d.status in ('draft', 'pending_approval')) as "openJobs"
            from maint_assets a left join machines m on m.id = a.machine_id
            order by a.code`,
      ),
    );
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(maintAssets).where(eq(maintAssets.id, id));
      if (!a) throw new NotFoundException('Asset not found');
      const children = await tx.select({ id: maintAssets.id, code: maintAssets.code, name: maintAssets.name, level: maintAssets.level, status: maintAssets.status }).from(maintAssets).where(eq(maintAssets.parentId, id));
      const parent = a.parentId ? (await tx.select({ id: maintAssets.id, code: maintAssets.code, name: maintAssets.name }).from(maintAssets).where(eq(maintAssets.id, a.parentId)))[0] : null;
      const spares = await many(
        tx,
        sql`select s.id, s.item_id as "itemId", i.code, i.name, s.is_critical as "isCritical", s.min_qty::text as "minQty", s.alternate_item_id as "alternateItemId", ai.code as "alternateCode",
                   coalesce((select sum(sv.qty) from stock_valuation sv join warehouses w on w.id = sv.warehouse_id where sv.item_id = s.item_id and w.is_nettable), 0)::text as stock
            from asset_spares s join items i on i.id = s.item_id left join items ai on ai.id = s.alternate_item_id where s.asset_id = ${id} order by i.code`,
      );
      const readings = await many(tx, sql`select reading::text, read_at as "readAt" from meter_readings where asset_id = ${id} order by read_at desc limit 20`);
      const { tenantId: _t, ...rest } = a;
      return { ...rest, parent: parent ?? null, children, spares, readings };
    });
  }

  save(auth: AuthContext, id: string | null, input: AssetInput) {
    return this.database.run(auth, async (tx) => {
      if (input.parentId) {
        if (input.parentId === id) throw new BadRequestException('An asset cannot be its own parent');
        const [p] = await tx.select({ id: maintAssets.id }).from(maintAssets).where(eq(maintAssets.id, input.parentId));
        if (!p) throw new BadRequestException('Parent asset not found');
        if (id) {
          // No loops: the new parent must not sit below this asset.
          const [loop] = await many<{ found: boolean }>(tx, sql`with recursive up as (select id, parent_id from maint_assets where id = ${input.parentId} union all select a.id, a.parent_id from maint_assets a join up on a.id = up.parent_id) select exists (select 1 from up where id = ${id}) as found`);
          if (loop.found) throw new BadRequestException('That parent sits below this asset');
        }
      }
      if (input.machineId) {
        const [m] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, input.machineId));
        if (!m) throw new BadRequestException('Machine not found');
      }
      const values = { ...input, parentId: input.parentId ?? null, machineId: input.machineId ?? null, installedOn: input.installedOn ?? null, warrantyUntil: input.warrantyUntil ?? null };
      try {
        if (id) {
          const [r] = await tx.update(maintAssets).set(values).where(eq(maintAssets.id, id)).returning();
          if (!r) throw new NotFoundException('Asset not found');
          return r;
        }
        return (await tx.insert(maintAssets).values({ tenantId: auth.tenantId, ...values }).returning())[0];
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException(`Asset code ${input.code} is already used`);
        throw e;
      }
    });
  }

  meter(auth: AuthContext, id: string, reading: string) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select({ unit: maintAssets.meterUnit, cur: maintAssets.meterReading }).from(maintAssets).where(eq(maintAssets.id, id));
      if (!a) throw new NotFoundException('Asset not found');
      if (!a.unit) throw new BadRequestException('The asset has no meter');
      if (a.cur !== null && Number(reading) < Number(a.cur)) throw new BadRequestException(`The meter cannot go back (last reading ${Number(a.cur)})`);
      await tx.insert(meterReadings).values({ tenantId: auth.tenantId, assetId: id, reading, readBy: auth.userId });
      await tx.update(maintAssets).set({ meterReading: reading }).where(eq(maintAssets.id, id));
      return { reading };
    });
  }

  addSpare(auth: AuthContext, assetId: string, input: z.infer<typeof spareSchema>) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id }).from(items).where(eq(items.id, input.itemId));
      if (!it) throw new BadRequestException('Item not found');
      const values = { isCritical: input.isCritical, minQty: input.minQty, alternateItemId: input.alternateItemId ?? null };
      const [r] = await tx.insert(assetSpares).values({ tenantId: auth.tenantId, assetId, itemId: input.itemId, ...values }).onConflictDoUpdate({ target: [assetSpares.assetId, assetSpares.itemId], set: values }).returning();
      return r;
    });
  }

  removeSpare(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(assetSpares).where(and(eq(assetSpares.id, id)));
    });
  }

  /** Critical spares below their minimum, across assets (stock in nettable stores). */
  criticalSpares(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.item_id as "itemId", i.code, i.name, string_agg(distinct a.code, ', ') as assets, max(s.min_qty)::text as "minQty",
                   coalesce((select sum(sv.qty) from stock_valuation sv join warehouses w on w.id = sv.warehouse_id where sv.item_id = s.item_id and w.is_nettable), 0)::text as stock
            from asset_spares s join items i on i.id = s.item_id join maint_assets a on a.id = s.asset_id
            where s.is_critical and s.min_qty is not null
            group by s.item_id, i.code, i.name
            having coalesce((select sum(sv.qty) from stock_valuation sv join warehouses w on w.id = sv.warehouse_id where sv.item_id = s.item_id and w.is_nettable), 0) < max(s.min_qty)
            order by i.code`,
      ),
    );
  }
}
