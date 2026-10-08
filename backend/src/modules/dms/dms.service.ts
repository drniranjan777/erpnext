import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import {
  attachments,
  dmsBeats,
  dmsClaims,
  dmsDistributors,
  dmsLoyalty,
  dmsRetailers,
  dmsSchemes,
  dmsSecondaryLines,
  dmsSecondarySales,
  dmsSettings,
  dmsStockAdjustments,
  dmsVisits,
  items,
  parties,
  type Transaction,
} from '@nextgen/database';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import type { SystemKey } from '../accounting/chart-template';
import { JournalsService } from '../accounting/journals.service';
import { LedgerService } from '../accounting/ledger.service';
import { DocumentsService } from '../documents/documents.service';
import { StorageService } from '../documents/storage.service';
import { parseSheet } from '../imports/file-parser';
import { applySchemes, metresBetween, type Scheme } from './schemes';
import { many } from '../../common/sql';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
const code = z.string().trim().min(1).max(20);

export const distributorSchema = z.object({ partyId: z.uuid(), territoryId: z.uuid().nullable().optional(), salespersonId: z.uuid().nullable().optional(), isActive: z.boolean().default(true) });
export const beatSchema = z.object({ code, name: z.string().trim().min(2).max(80), distributorId: z.uuid().nullable().optional(), salespersonId: z.uuid().nullable().optional(), weekday: z.number().int().min(0).max(6).nullable().optional(), isActive: z.boolean().default(true) });
export const retailerSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  ownerName: text(80),
  phone: z.string().trim().regex(/^\+?[0-9 -]{8,16}$/).nullable().optional(),
  distributorId: z.uuid(),
  beatId: z.uuid().nullable().optional(),
  address: text(300),
  city: text(80),
  stateCode: z.string().regex(/^\d{2}$/).nullable().optional(),
  gstin: text(15),
  outletClass: z.enum(['A', 'B', 'C']).default('C'),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().default(true),
});
export const schemeSchema = z
  .object({
    code,
    name: z.string().trim().min(2).max(80),
    kind: z.enum(['qty_slab', 'value_slab', 'free_goods']),
    level: z.enum(['primary', 'secondary']).default('secondary'),
    itemIds: z.array(z.uuid()).max(200).default([]),
    slabs: z.array(z.object({ min: z.number().positive().max(1e10), discountPct: z.number().min(0).max(100).optional(), perUnit: z.number().min(0).max(1e8).optional(), freeQty: z.number().int().min(1).max(10_000).optional() })).min(1).max(20),
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    isActive: z.boolean().default(true),
  })
  .refine((s) => s.toDate >= s.fromDate, { message: 'The scheme must end after it starts', path: ['toDate'] })
  .refine((s) => s.slabs.every((x) => (s.kind === 'free_goods' ? !!x.freeQty : s.kind === 'value_slab' ? !!x.discountPct : !!(x.discountPct || x.perUnit))), { message: 'Each slab needs its benefit (free quantity, % off or ₹ a unit)', path: ['slabs'] });
const saleLines = z.array(z.object({ itemId: z.uuid(), qty: z.number().positive().max(1e8), rate: z.number().min(0).max(1e9).optional() })).min(1).max(200);
export const secondarySchema = z.object({ retailerId: z.uuid(), date: z.iso.date().optional(), lines: saleLines });
export const previewSchema = z.object({ date: z.iso.date().optional(), lines: saleLines });
export const stockAdjustSchema = z.object({ distributorId: z.uuid(), itemId: z.uuid(), date: z.iso.date().optional(), kind: z.enum(['opening', 'count', 'damage']), qty: z.number().min(-1e8).max(1e8), remarks: text(200) });
export const claimSchema = z.object({ distributorId: z.uuid(), kind: z.enum(['scheme', 'damage', 'price_difference', 'other']), schemeId: z.uuid().nullable().optional(), fromDate: z.iso.date(), toDate: z.iso.date(), claimedAmount: z.number().positive().max(1e10), notes: text(1000) });
export const decideClaimSchema = z.object({ approve: z.boolean(), approvedAmount: z.number().positive().max(1e10).optional(), note: text(500) });
export const checkInSchema = z.object({ retailerId: z.uuid(), latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) });
export const checkOutSchema = z.object({ outcome: z.enum(['order', 'no_order', 'closed', 'not_met']), notes: text(500) });
export const redeemSchema = z.object({ points: z.number().int().positive().max(10_000_000), remarks: z.string().trim().min(3).max(200) });

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Distribution: the network (distributors, beats, retailers), secondary sales priced with the
 * active schemes, distributor stock, field visits, scheme and other claims settled in the books,
 * and retailer loyalty.
 */
@Injectable()
export class DmsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly ledger: LedgerService,
    private readonly journals: JournalsService,
    private readonly documents: DocumentsService,
  ) {}

  private async settings(tx: Transaction, tenantId: string) {
    const [s] = await tx.select().from(dmsSettings);
    return s ?? (await tx.insert(dmsSettings).values({ tenantId }).onConflictDoNothing().returning())[0] ?? (await tx.select().from(dmsSettings))[0];
  }

  // ---- network ----------------------------------------------------------------------------

  distributors(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select d.id, d.party_id as "partyId", p.code, p.name, p.gstin, d.territory_id as "territoryId", t.name as territory, d.salesperson_id as "salespersonId", u.full_name as salesperson, d.is_active as "isActive",
                   (select count(*)::int from dms_retailers r where r.distributor_id = d.id and r.is_active) as retailers,
                   (select coalesce(sum(s.net), 0)::float8 from dms_secondary_sales s where s.distributor_id = d.id and s.status = 'recorded' and s.date >= date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)) as "secondaryMtd"
            from dms_distributors d join parties p on p.id = d.party_id left join crm_territories t on t.id = d.territory_id left join users u on u.id = d.salesperson_id
            order by p.name`,
      ),
    );
  }

  saveDistributor(auth: AuthContext, id: string | null, input: z.infer<typeof distributorSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select({ isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, input.partyId));
      if (!p?.isCustomer) throw new BadRequestException('A distributor must be a customer');
      const values = { ...input, territoryId: input.territoryId ?? null, salespersonId: input.salespersonId ?? null };
      if (id) {
        const [r] = await tx.update(dmsDistributors).set(values).where(eq(dmsDistributors.id, id)).returning();
        if (!r) throw new NotFoundException('Distributor not found');
        return r;
      }
      const [dup] = await tx.select({ id: dmsDistributors.id }).from(dmsDistributors).where(eq(dmsDistributors.partyId, input.partyId));
      if (dup) throw new ConflictException('This customer is already a distributor');
      return (await tx.insert(dmsDistributors).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  beats(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select b.id, b.code, b.name, b.distributor_id as "distributorId", p.name as distributor, b.salesperson_id as "salespersonId", u.full_name as salesperson, b.weekday, b.is_active as "isActive",
                   (select count(*)::int from dms_retailers r where r.beat_id = b.id and r.is_active) as retailers
            from dms_beats b left join dms_distributors d on d.id = b.distributor_id left join parties p on p.id = d.party_id left join users u on u.id = b.salesperson_id
            order by b.code`,
      ),
    );
  }

  saveBeat(auth: AuthContext, id: string | null, input: z.infer<typeof beatSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, code: input.code.toUpperCase(), distributorId: input.distributorId ?? null, salespersonId: input.salespersonId ?? null, weekday: input.weekday ?? null };
      const [dup] = await tx.select({ id: dmsBeats.id }).from(dmsBeats).where(and(eq(dmsBeats.code, values.code), id ? ne(dmsBeats.id, id) : undefined));
      if (dup) throw new ConflictException(`Beat ${values.code} already exists`);
      if (id) {
        const [r] = await tx.update(dmsBeats).set(values).where(eq(dmsBeats.id, id)).returning();
        if (!r) throw new NotFoundException('Beat not found');
        return r;
      }
      return (await tx.insert(dmsBeats).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  retailers(auth: AuthContext, q: { distributorId?: string; beatId?: string; q?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.code, r.name, r.owner_name as "ownerName", r.phone, r.city, r.outlet_class as "outletClass", r.distributor_id as "distributorId", p.name as distributor, r.beat_id as "beatId", b.name as beat,
                   r.latitude, r.longitude, r.is_active as "isActive",
                   (select coalesce(sum(points), 0)::int from dms_loyalty l where l.retailer_id = r.id) as points,
                   (select max(v.check_in_at) from dms_visits v where v.retailer_id = r.id) as "lastVisit"
            from dms_retailers r join dms_distributors d on d.id = r.distributor_id join parties p on p.id = d.party_id left join dms_beats b on b.id = r.beat_id
            where true ${q.distributorId ? sql`and r.distributor_id = ${q.distributorId}` : sql``} ${q.beatId ? sql`and r.beat_id = ${q.beatId}` : sql``}
              ${q.q ? sql`and (r.name ilike ${`%${q.q}%`} or r.code ilike ${`%${q.q}%`} or r.phone ilike ${`%${q.q}%`})` : sql``}
            order by r.name limit 2000`,
      ),
    );
  }

  saveRetailer(auth: AuthContext, id: string | null, input: z.infer<typeof retailerSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, code: input.code.toUpperCase(), latitude: input.latitude === null || input.latitude === undefined ? null : input.latitude.toFixed(6), longitude: input.longitude === null || input.longitude === undefined ? null : input.longitude.toFixed(6) };
      const [dup] = await tx.select({ id: dmsRetailers.id }).from(dmsRetailers).where(and(eq(dmsRetailers.code, values.code), id ? ne(dmsRetailers.id, id) : undefined));
      if (dup) throw new ConflictException(`Retailer ${values.code} already exists`);
      if (values.beatId) {
        const [b] = await tx.select({ distributorId: dmsBeats.distributorId }).from(dmsBeats).where(eq(dmsBeats.id, values.beatId));
        if (!b) throw new NotFoundException('Beat not found');
        if (b.distributorId && b.distributorId !== values.distributorId) throw new BadRequestException('The beat belongs to another distributor');
      }
      if (id) {
        const [r] = await tx.update(dmsRetailers).set(values).where(eq(dmsRetailers.id, id)).returning();
        if (!r) throw new NotFoundException('Retailer not found');
        return r;
      }
      return (await tx.insert(dmsRetailers).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  // ---- schemes ----------------------------------------------------------------------------

  schemes(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(dmsSchemes).orderBy(asc(dmsSchemes.fromDate)));
  }

  saveScheme(auth: AuthContext, id: string | null, input: z.infer<typeof schemeSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, code: input.code.toUpperCase() };
      const [dup] = await tx.select({ id: dmsSchemes.id }).from(dmsSchemes).where(and(eq(dmsSchemes.code, values.code), id ? ne(dmsSchemes.id, id) : undefined));
      if (dup) throw new ConflictException(`Scheme ${values.code} already exists`);
      if (id) {
        const [r] = await tx.update(dmsSchemes).set(values).where(eq(dmsSchemes.id, id)).returning();
        if (!r) throw new NotFoundException('Scheme not found');
        return r;
      }
      return (await tx.insert(dmsSchemes).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  private async activeSchemes(tx: Transaction, level: 'primary' | 'secondary', date: string): Promise<Scheme[]> {
    const rows = await tx.select().from(dmsSchemes).where(and(eq(dmsSchemes.level, level), eq(dmsSchemes.isActive, true), sql`${date} between ${dmsSchemes.fromDate} and ${dmsSchemes.toDate}`));
    return rows.map((r) => ({ id: r.id, code: String(r.code), name: r.name, kind: r.kind as Scheme['kind'], itemIds: r.itemIds, slabs: r.slabs }));
  }

  /** Lines priced at the given rate (or the item's selling rate) with the secondary schemes of the day. */
  private async price(tx: Transaction, lines: z.infer<typeof saleLines>, date: string) {
    const its = await tx.select({ id: items.id, sellingRate: items.sellingRate }).from(items).where(inArray(items.id, [...new Set(lines.map((l) => l.itemId))]));
    const rate = new Map(its.map((i) => [i.id, Number(i.sellingRate ?? 0)]));
    if (its.length !== new Set(lines.map((l) => l.itemId)).size) throw new BadRequestException('Unknown item');
    const priced = lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.rate ?? rate.get(l.itemId) ?? 0 }));
    return { priced, ...applySchemes(priced, await this.activeSchemes(tx, 'secondary', date)) };
  }

  preview(auth: AuthContext, input: z.infer<typeof previewSchema>) {
    return this.database.run(auth, (tx) => this.price(tx, input.lines, input.date ?? todayIST()));
  }

  // ---- secondary sales --------------------------------------------------------------------

  secondarySales(auth: AuthContext, q: { distributorId?: string; retailerId?: string; from?: string; to?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.number, s.date::text as date, s.gross, s.discount, s.net, s.source, s.status, s.schemes, r.name as retailer, p.name as distributor, u.full_name as "bookedBy"
            from dms_secondary_sales s join dms_retailers r on r.id = s.retailer_id join dms_distributors d on d.id = s.distributor_id join parties p on p.id = d.party_id left join users u on u.id = s.created_by
            where true ${q.distributorId ? sql`and s.distributor_id = ${q.distributorId}` : sql``} ${q.retailerId ? sql`and s.retailer_id = ${q.retailerId}` : sql``}
              ${q.from ? sql`and s.date >= ${q.from}` : sql``} ${q.to ? sql`and s.date <= ${q.to}` : sql``}
            order by s.date desc, s.number desc limit 500`,
      ),
    );
  }

  recordSale(auth: AuthContext, input: z.infer<typeof secondarySchema>, source: 'manual' | 'field' = 'manual', visitId: string | null = null) {
    return this.database.run(auth, (tx) => this.recordSaleTx(tx, auth, input, source, visitId));
  }

  private async recordSaleTx(tx: Transaction, auth: AuthContext, input: z.infer<typeof secondarySchema>, source: 'manual' | 'field' | 'import', visitId: string | null) {
    const date = input.date ?? todayIST();
    if (date > todayIST()) throw new BadRequestException('The sale date is in the future');
    const [r] = await tx.select().from(dmsRetailers).where(eq(dmsRetailers.id, input.retailerId));
    if (!r || !r.isActive) throw new BadRequestException('Choose an active retailer');
    const p = await this.price(tx, input.lines, date);
    const number = await nextCode(tx, auth.tenantId, 'dms_secondary', 'SS', 6);
    const [sale] = await tx
      .insert(dmsSecondarySales)
      .values({ tenantId: auth.tenantId, number, distributorId: r.distributorId, retailerId: r.id, date, visitId, source, gross: p.gross.toFixed(2), discount: p.discount.toFixed(2), net: p.net.toFixed(2), schemes: p.applied, createdBy: auth.userId })
      .returning();
    const free = new Map<string, number>();
    for (const a of p.applied) if (a.itemId && a.freeQty) free.set(a.itemId, (free.get(a.itemId) ?? 0) + a.freeQty);
    await tx.insert(dmsSecondaryLines).values(
      p.priced.map((l, i) => ({
        tenantId: auth.tenantId,
        saleId: sale.id,
        itemId: l.itemId,
        qty: String(l.qty),
        // Free goods go on the first line of the item.
        freeQty: String(p.priced.findIndex((x) => x.itemId === l.itemId) === i ? (free.get(l.itemId) ?? 0) : 0),
        rate: String(l.rate),
        amount: (l.qty * l.rate).toFixed(2),
      })),
    );
    // Loyalty points on the net value.
    const s = await this.settings(tx, auth.tenantId);
    const points = Math.floor((p.net / 100) * Number(s.pointsPerHundred));
    if (points > 0) await tx.insert(dmsLoyalty).values({ tenantId: auth.tenantId, retailerId: r.id, date, points, kind: 'earn', refKey: `sale:${sale.id}`, remarks: `Purchase ${number}`, createdBy: auth.userId });
    return sale;
  }

  cancelSale(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(dmsSecondarySales).where(eq(dmsSecondarySales.id, id)).for('update');
      if (!s) throw new NotFoundException('Sale not found');
      if (s.status === 'cancelled') throw new ConflictException('Already cancelled');
      const [claimed] = await many(tx, sql`select 1 from dms_claims where distributor_id = ${s.distributorId} and status in ('approved', 'settled') and kind = 'scheme' and ${s.date} between from_date and to_date limit 1`);
      if (claimed) throw new ConflictException('A scheme claim covering this sale is already approved');
      await tx.update(dmsSecondarySales).set({ status: 'cancelled' }).where(eq(dmsSecondarySales.id, id));
      const [earn] = await tx.select().from(dmsLoyalty).where(eq(dmsLoyalty.refKey, `sale:${id}`));
      if (earn) await tx.insert(dmsLoyalty).values({ tenantId: auth.tenantId, retailerId: earn.retailerId, date: todayIST(), points: -earn.points, kind: 'adjust', refKey: `sale:${id}:cancel`, remarks: `Cancelled ${s.number}`, createdBy: auth.userId });
      return { status: 'cancelled' };
    });
  }

  /** A distributor's sales file: retailer code, item code, qty, rate (optional), date (optional). */
  async importSales(auth: AuthContext, buffer: Buffer, fileName: string) {
    const sheet = await parseSheet(buffer, fileName);
    return this.database.run(auth, async (tx) => {
      const orders = new Map<string, { retailerId: string; date: string; lines: { itemId: string; qty: number; rate?: number }[] }>();
      const errors: { row: number; error: string }[] = [];
      for (const r of sheet.rows) {
        const v = r.values;
        const retailer = v.retailer_code || v.retailer || v.outlet_code;
        const item = v.item_code || v.sku || v.item;
        const q = Number(v.qty || v.quantity);
        const date = (v.date || v.invoice_date || todayIST()).trim();
        const ref = v.invoice_no || v.bill_no || '';
        if (!retailer || !item || !(q > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errors.push({ row: r.rowNo, error: 'Needs retailer_code, item_code, qty and a YYYY-MM-DD date' });
          continue;
        }
        const [rt] = await tx.select({ id: dmsRetailers.id }).from(dmsRetailers).where(eq(dmsRetailers.code, retailer));
        const [it] = await tx.select({ id: items.id }).from(items).where(eq(items.code, item));
        if (!rt || !it) {
          errors.push({ row: r.rowNo, error: !rt ? `Retailer ${retailer} not found` : `Item ${item} not found` });
          continue;
        }
        const key = `${rt.id}|${date}|${ref}`;
        const o = orders.get(key) ?? { retailerId: rt.id, date, lines: [] };
        o.lines.push({ itemId: it.id, qty: q, rate: v.rate ? Number(v.rate) : undefined });
        orders.set(key, o);
      }
      for (const o of orders.values()) await this.recordSaleTx(tx, auth, o, 'import', null);
      return { sales: orders.size, errors: errors.slice(0, 50) };
    });
  }

  // ---- distributor stock ------------------------------------------------------------------

  /** Opening and counts, plus primary invoices to the distributor, less secondary sales (with free goods). */
  stock(auth: AuthContext, distributorId: string, asOf?: string) {
    return this.database.run(auth, async (tx) => {
      const [d] = await tx.select().from(dmsDistributors).where(eq(dmsDistributors.id, distributorId));
      if (!d) throw new NotFoundException('Distributor not found');
      const to = asOf ?? todayIST();
      return many(
        tx,
        sql`with moves as (
              select item_id, sum(qty) as adj, 0::numeric as primary_in, 0::numeric as secondary_out from dms_stock_adjustments where distributor_id = ${distributorId} and date <= ${to} group by item_id
              union all
              select l.item_id, 0, sum(l.base_qty), 0 from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id join documents doc on doc.id = i.id
              where i.customer_id = ${d.partyId} and doc.status = 'approved' and doc.doc_date <= ${to} group by l.item_id
              union all
              select l.item_id, 0, 0, sum(l.qty + l.free_qty) from dms_secondary_lines l join dms_secondary_sales s on s.id = l.sale_id
              where s.distributor_id = ${distributorId} and s.status = 'recorded' and s.date <= ${to} group by l.item_id
            )
            select m.item_id as "itemId", i.code, i.name, sum(m.adj)::float8 as adjustments, sum(m.primary_in)::float8 as "primaryIn", sum(m.secondary_out)::float8 as "secondaryOut",
                   (sum(m.adj) + sum(m.primary_in) - sum(m.secondary_out))::float8 as "onHand",
                   (select coalesce(sum(l.qty + l.free_qty), 0)::float8 from dms_secondary_lines l join dms_secondary_sales s on s.id = l.sale_id
                     where s.distributor_id = ${distributorId} and s.status = 'recorded' and l.item_id = m.item_id and s.date > ${to}::date - 30 and s.date <= ${to}) as "sold30"
            from moves m join items i on i.id = m.item_id group by m.item_id, i.code, i.name order by i.code`,
      ).then((rows) => rows.map((r) => ({ ...r, daysCover: Number(r.sold30) > 0 ? Math.round((Number(r.onHand) / (Number(r.sold30) / 30)) * 10) / 10 : null })));
    });
  }

  adjustStock(auth: AuthContext, input: z.infer<typeof stockAdjustSchema>) {
    return this.database.run(auth, async (tx) => {
      const [d] = await tx.select({ id: dmsDistributors.id }).from(dmsDistributors).where(eq(dmsDistributors.id, input.distributorId));
      if (!d) throw new NotFoundException('Distributor not found');
      return (await tx.insert(dmsStockAdjustments).values({ tenantId: auth.tenantId, ...input, date: input.date ?? todayIST(), qty: String(input.qty), remarks: input.remarks ?? null, createdBy: auth.userId }).returning())[0];
    });
  }

  // ---- field force ------------------------------------------------------------------------

  /** The signed-in salesperson's beats for today and their outlets, with today's visits. */
  myDay(auth: AuthContext, date?: string) {
    return this.database.run(auth, async (tx) => {
      const day = date ?? todayIST();
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const beats = await tx.select().from(dmsBeats).where(and(eq(dmsBeats.salespersonId, auth.userId), eq(dmsBeats.isActive, true), sql`(${dmsBeats.weekday} is null or ${dmsBeats.weekday} = ${weekday})`));
      const outlets = beats.length
        ? await many(
            tx,
            sql`select r.id, r.code, r.name, r.owner_name as "ownerName", r.phone, r.address, r.beat_id as "beatId", r.latitude, r.longitude,
                       (select json_build_object('id', v.id, 'checkInAt', v.check_in_at, 'checkOutAt', v.check_out_at, 'outcome', v.outcome) from dms_visits v
                         where v.retailer_id = r.id and v.salesperson_id = ${auth.userId} and (v.check_in_at at time zone 'Asia/Kolkata')::date = ${day} order by v.check_in_at desc limit 1) as visit
                from dms_retailers r where r.is_active and r.beat_id in (${sql.join(beats.map((b) => sql`${b.id}`), sql`, `)}) order by r.name`,
          )
        : [];
      return { date: day, beats: beats.map((b) => ({ id: b.id, code: b.code, name: b.name })), outlets };
    });
  }

  async checkIn(auth: AuthContext, input: z.infer<typeof checkInSchema>, photo: { mimetype: string; file: Readable } | null) {
    if (photo && !PHOTO_TYPES.has(photo.mimetype)) {
      photo.file.resume();
      throw new UnsupportedMediaTypeException('The photo must be a JPEG, PNG or WebP image');
    }
    const stored = photo ? await this.storage.put(auth.tenantId, photo.file, 3 * 1024 * 1024) : null;
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(dmsRetailers).where(eq(dmsRetailers.id, input.retailerId));
      if (!r) throw new NotFoundException('Retailer not found');
      const [open] = await many(tx, sql`select id from dms_visits where salesperson_id = ${auth.userId} and check_out_at is null and check_in_at > now() - interval '12 hours' limit 1`);
      if (open) throw new ConflictException('Check out of your current visit first');
      const distance = r.latitude && r.longitude ? metresBetween(input.latitude, input.longitude, Number(r.latitude), Number(r.longitude)) : null;
      let photoId: string | null = null;
      if (stored && photo) {
        const [a] = await tx
          .insert(attachments)
          .values({ tenantId: auth.tenantId, entityType: 'dms_visit', entityId: r.id, fileName: `visit-${Date.now()}.jpg`, contentType: photo.mimetype, sizeBytes: stored.sizeBytes, sha256: stored.sha256, storageKey: stored.key, uploadedBy: auth.userId })
          .returning({ id: attachments.id });
        photoId = a.id;
      }
      // The first visit with a location fixes the outlet's position.
      if (!r.latitude) await tx.update(dmsRetailers).set({ latitude: input.latitude.toFixed(6), longitude: input.longitude.toFixed(6) }).where(eq(dmsRetailers.id, r.id));
      const s = await this.settings(tx, auth.tenantId);
      const [v] = await tx
        .insert(dmsVisits)
        .values({ tenantId: auth.tenantId, salespersonId: auth.userId, retailerId: r.id, beatId: r.beatId, checkInAt: new Date(), latitude: input.latitude.toFixed(6), longitude: input.longitude.toFixed(6), distanceMetres: distance, photoId })
        .returning();
      return { ...v, farFromOutlet: distance !== null && distance > s.visitRadiusMetres };
    });
  }

  /** An order booked during the visit (a secondary sale). */
  visitOrder(auth: AuthContext, visitId: string, lines: z.infer<typeof saleLines>) {
    return this.database.run(auth, async (tx) => {
      const [v] = await tx.select().from(dmsVisits).where(eq(dmsVisits.id, visitId));
      if (!v) throw new NotFoundException('Visit not found');
      if (v.salespersonId !== auth.userId) throw new ForbiddenException('Not your visit');
      if (v.checkOutAt) throw new ConflictException('The visit is closed');
      const sale = await this.recordSaleTx(tx, auth, { retailerId: v.retailerId, lines }, 'field', v.id);
      return sale;
    });
  }

  checkOut(auth: AuthContext, visitId: string, input: z.infer<typeof checkOutSchema>) {
    return this.database.run(auth, async (tx) => {
      const [v] = await tx.select().from(dmsVisits).where(eq(dmsVisits.id, visitId)).for('update');
      if (!v) throw new NotFoundException('Visit not found');
      if (v.salespersonId !== auth.userId) throw new ForbiddenException('Not your visit');
      if (v.checkOutAt) throw new ConflictException('Already checked out');
      const [order] = await many(tx, sql`select 1 from dms_secondary_sales where visit_id = ${visitId} and status = 'recorded' limit 1`);
      if (input.outcome === 'order' && !order) throw new BadRequestException('Book the order before checking out with outcome "order"');
      await tx.update(dmsVisits).set({ checkOutAt: new Date(), outcome: order ? 'order' : input.outcome, notes: input.notes ?? null }).where(eq(dmsVisits.id, visitId));
      return { ok: true };
    });
  }

  /** Visits by salesperson and day: calls made, productive calls, order value. */
  visitReport(auth: AuthContext, from: string, to: string) {
    return this.database.run(auth, async (tx) => {
      const st = await this.settings(tx, auth.tenantId);
      return many(
        tx,
        sql`select u.full_name as salesperson, (v.check_in_at at time zone 'Asia/Kolkata')::date::text as day, count(*)::int as calls,
                   count(*) filter (where v.outcome = 'order')::int as productive, count(*) filter (where v.distance_metres > ${st.visitRadiusMetres})::int as "farCheckIns",
                   coalesce(sum(o.net), 0)::float8 as "orderValue"
            from dms_visits v join users u on u.id = v.salesperson_id
            left join (select visit_id, sum(net) as net from dms_secondary_sales where status = 'recorded' and visit_id is not null group by visit_id) o on o.visit_id = v.id
            where (v.check_in_at at time zone 'Asia/Kolkata')::date between ${from} and ${to}
            group by u.full_name, 2 order by 2 desc, 1`,
      );
    });
  }

  // ---- claims -----------------------------------------------------------------------------

  /**
   * What a scheme claim should be: for a secondary scheme, the discounts given on recorded
   * secondary sales in the period; for a primary scheme, the slab benefit on the invoiced quantity
   * and value over the period.
   */
  private async computeClaim(tx: Transaction, distributorId: string, schemeId: string, from: string, to: string) {
    const [s] = await tx.select().from(dmsSchemes).where(eq(dmsSchemes.id, schemeId));
    if (!s) throw new NotFoundException('Scheme not found');
    if (s.level === 'secondary') {
      const [r] = await many<{ amount: number }>(
        tx,
        sql`select coalesce(sum((x->>'discount')::numeric), 0)::float8 as amount from dms_secondary_sales ss, jsonb_array_elements(ss.schemes) x
            where ss.distributor_id = ${distributorId} and ss.status = 'recorded' and ss.date between ${from} and ${to} and x->>'schemeId' = ${schemeId}`,
      );
      return Math.round(r.amount * 100) / 100;
    }
    const [d] = await tx.select({ partyId: dmsDistributors.partyId }).from(dmsDistributors).where(eq(dmsDistributors.id, distributorId));
    const lines = await many<{ itemId: string; qty: number; value: number }>(
      tx,
      sql`select l.item_id as "itemId", sum(l.base_qty)::float8 as qty, sum(l.taxable_value)::float8 as value
          from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id join documents doc on doc.id = i.id
          where i.customer_id = ${d.partyId} and doc.status = 'approved' and doc.doc_date between ${from} and ${to}
            and greatest(${from}::date, ${s.fromDate}::date) <= least(${to}::date, ${s.toDate}::date)
          group by l.item_id`,
    );
    const scheme: Scheme = { id: s.id, code: String(s.code), name: s.name, kind: s.kind as Scheme['kind'], itemIds: s.itemIds, slabs: s.slabs };
    return applySchemes(lines.map((l) => ({ itemId: l.itemId, qty: l.qty, rate: l.qty ? l.value / l.qty : 0 })), [scheme]).discount;
  }

  claims(auth: AuthContext, q: { status?: string; distributorId?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.number, c.kind, c.from_date::text as "fromDate", c.to_date::text as "toDate", c.claimed_amount as "claimedAmount", c.computed_amount as "computedAmount", c.approved_amount as "approvedAmount",
                   c.status, c.notes, c.decision_note as "decisionNote", c.journal_id as "journalId", p.name as distributor, s.code as "schemeCode", s.name as "schemeName"
            from dms_claims c join dms_distributors d on d.id = c.distributor_id join parties p on p.id = d.party_id left join dms_schemes s on s.id = c.scheme_id
            where true ${q.status ? sql`and c.status = ${q.status}` : sql``} ${q.distributorId ? sql`and c.distributor_id = ${q.distributorId}` : sql``}
            order by c.created_at desc limit 500`,
      ),
    );
  }

  raiseClaim(auth: AuthContext, input: z.infer<typeof claimSchema>) {
    return this.database.run(auth, async (tx) => {
      if (input.toDate < input.fromDate) throw new BadRequestException('The period ends before it starts');
      if (input.kind === 'scheme' && !input.schemeId) throw new BadRequestException('Choose the scheme claimed');
      const [d] = await tx.select({ id: dmsDistributors.id }).from(dmsDistributors).where(eq(dmsDistributors.id, input.distributorId));
      if (!d) throw new NotFoundException('Distributor not found');
      if (input.schemeId) {
        const [dup] = await many(tx, sql`select number from dms_claims where distributor_id = ${input.distributorId} and scheme_id = ${input.schemeId} and status <> 'rejected' and from_date <= ${input.toDate} and to_date >= ${input.fromDate} limit 1`);
        if (dup) throw new ConflictException(`Claim ${(dup as { number: string }).number} already covers part of this period`);
      }
      const computed = input.kind === 'scheme' ? await this.computeClaim(tx, input.distributorId, input.schemeId!, input.fromDate, input.toDate) : null;
      const number = await nextCode(tx, auth.tenantId, 'dms_claim', 'CLM', 5);
      return (
        await tx
          .insert(dmsClaims)
          .values({ tenantId: auth.tenantId, number, ...input, schemeId: input.schemeId ?? null, claimedAmount: input.claimedAmount.toFixed(2), computedAmount: computed === null ? null : computed.toFixed(2), notes: input.notes ?? null, createdBy: auth.userId })
          .returning()
      )[0];
    });
  }

  decideClaim(auth: AuthContext, id: string, input: z.infer<typeof decideClaimSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(dmsClaims).where(eq(dmsClaims.id, id)).for('update');
      if (!c) throw new NotFoundException('Claim not found');
      if (c.status !== 'submitted') throw new ConflictException(`This claim is already ${c.status}`);
      if (c.createdBy === auth.userId) throw new ForbiddenException('Someone else must decide a claim you raised');
      // By default approve what the system computed, never more than claimed.
      const amount = input.approvedAmount ?? Math.min(Number(c.claimedAmount), c.computedAmount === null ? Number(c.claimedAmount) : Number(c.computedAmount));
      if (input.approve && amount > Number(c.claimedAmount)) throw new BadRequestException('Approve at most the amount claimed');
      await tx.update(dmsClaims).set({ status: input.approve ? 'approved' : 'rejected', approvedAmount: input.approve ? amount.toFixed(2) : null, decisionNote: input.note ?? null }).where(eq(dmsClaims.id, id));
      return { status: input.approve ? 'approved' : 'rejected', approvedAmount: input.approve ? amount.toFixed(2) : null };
    });
  }

  /** Credits the distributor (their receivable) and books the cost of the scheme. */
  settleClaim(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(dmsClaims).where(eq(dmsClaims.id, id)).for('update');
      if (!c) throw new NotFoundException('Claim not found');
      if (c.status !== 'approved') throw new ConflictException('Only an approved claim can be settled');
      const [d] = await many<{ partyId: string; name: string }>(tx, sql`select d.party_id as "partyId", p.name from dms_distributors d join parties p on p.id = d.party_id where d.id = ${c.distributorId}`);
      const [company] = await many<{ id: string }>(tx, sql`select id from companies where deleted_at is null order by created_at limit 1`);
      if (!company) throw new BadRequestException('Add a company to post the settlement to');
      await this.ledger.ensureBooks(tx, auth.tenantId, company.id, auth.userId);
      const lines: { account: SystemKey; debit?: string; credit?: string; partyId?: string; narration: string }[] = [
        { account: 'trade_schemes', debit: c.approvedAmount!, narration: `${c.kind.replace('_', ' ')} claim ${c.number}` },
        { account: 'receivable', credit: c.approvedAmount!, partyId: d.partyId, narration: `Claim ${c.number} credited` },
      ];
      const accs = await this.ledger.resolveAccounts(tx, company.id, lines.map((l) => ({ account: l.account })));
      const jv = await this.journals.createTx(
        tx,
        auth,
        { companyId: company.id, docDate: todayIST(), kind: 'journal', narration: `Distributor claim ${c.number}: ${d.name}`, lines: lines.map((l, i) => ({ accountId: accs[i].id, debit: l.debit ?? null, credit: l.credit ?? null, partyId: l.partyId ?? null, narration: l.narration, costCenterId: null, againstVoucherId: null })) },
        meta,
      );
      await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
      await tx.update(dmsClaims).set({ status: 'settled', journalId: jv.id }).where(eq(dmsClaims.id, id));
      return { status: 'settled', journalId: jv.id };
    });
  }

  // ---- loyalty ----------------------------------------------------------------------------

  loyalty(auth: AuthContext, retailerId: string) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select().from(dmsLoyalty).where(eq(dmsLoyalty.retailerId, retailerId)).orderBy(asc(dmsLoyalty.createdAt));
      return { balance: rows.reduce((s, r) => s + r.points, 0), entries: rows };
    });
  }

  redeem(auth: AuthContext, retailerId: string, input: z.infer<typeof redeemSchema>) {
    return this.database.run(auth, async (tx) => {
      await many(tx, sql`select id from dms_retailers where id = ${retailerId} for update`);
      const [{ balance }] = await many<{ balance: number }>(tx, sql`select coalesce(sum(points), 0)::int as balance from dms_loyalty where retailer_id = ${retailerId}`);
      if (input.points > balance) throw new BadRequestException(`Only ${balance} points available`);
      return (await tx.insert(dmsLoyalty).values({ tenantId: auth.tenantId, retailerId, date: todayIST(), points: -input.points, kind: 'redeem', remarks: input.remarks, createdBy: auth.userId }).returning())[0];
    });
  }

  saveSettings(auth: AuthContext, input: { pointsPerHundred: number; visitRadiusMetres: number }) {
    return this.database.run(auth, async (tx) => {
      const s = await this.settings(tx, auth.tenantId);
      return (await tx.update(dmsSettings).set({ pointsPerHundred: String(input.pointsPerHundred), visitRadiusMetres: input.visitRadiusMetres }).where(eq(dmsSettings.id, s.id)).returning())[0];
    });
  }

  getSettings(auth: AuthContext) {
    return this.database.run(auth, (tx) => this.settings(tx, auth.tenantId));
  }
}
