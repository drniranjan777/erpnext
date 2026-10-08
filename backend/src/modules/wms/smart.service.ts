import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { itemBarcodes, items, parties, wms3plBills, wms3plClients, wmsBins, wmsRfidReads, wmsRfidTags, type Transaction } from '@nextgen/database';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { SalesInvoicesService } from '../sales/invoices.service';
import { createInvoiceSchema } from '../sales/sales.schemas';
import { decodeSgtin96, faceLevels, gtinForms } from './smart';
import { many } from '../../common/sql';

const money = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export const clientSchema = z.object({
  partyId: z.uuid(),
  warehouseId: z.uuid(),
  storagePerPalletDay: z.number().min(0).max(100_000),
  inboundPerUnit: z.number().min(0).max(100_000).default(0),
  outboundPerUnit: z.number().min(0).max(100_000).default(0),
  minimumMonthly: z.number().min(0).max(1e8).nullable().optional(),
  defaultUnitsPerPallet: z.number().positive().max(1e7).default(1),
  serviceItemId: z.uuid(),
  isActive: z.boolean().default(true),
});
export const billPeriodSchema = z.object({ from: z.iso.date(), to: z.iso.date() });
export const applyLevelsSchema = z.object({ levels: z.array(z.object({ binId: z.uuid(), min: z.number().min(0), max: z.number().positive() })).min(1).max(500) });
export const tagSchema = z.object({ epc: z.string().trim().regex(/^[0-9A-Fa-f]{8,64}$/, 'Hex EPC'), itemId: z.uuid(), serialNo: z.string().trim().max(60).nullable().optional() });
export const readsSchema = z.object({ gate: z.string().trim().min(1).max(40), deliveryId: z.uuid().nullable().optional(), epcs: z.array(z.string().trim().regex(/^[0-9A-Fa-f]{8,64}$/)).min(1).max(5000) });

/**
 * 3PL billing for warehousing clients, demand-driven pick-face levels, floor productivity and
 * inventory accuracy, and RFID gate reads (pilot).
 */
@Injectable()
export class WmsSmartService {
  constructor(
    private readonly database: DatabaseService,
    private readonly invoices: SalesInvoicesService,
  ) {}

  // ---- 3PL ----------------------------------------------------------------------------------------

  clients(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.party_id as "partyId", p.name as client, c.warehouse_id as "warehouseId", w.code as warehouse, c.storage_per_pallet_day as "storagePerPalletDay", c.inbound_per_unit as "inboundPerUnit", c.outbound_per_unit as "outboundPerUnit",
                   c.minimum_monthly as "minimumMonthly", c.default_units_per_pallet as "defaultUnitsPerPallet", c.service_item_id as "serviceItemId", i.code as "serviceItem", c.is_active as "isActive",
                   (select count(*)::int from wms_item_profiles x where x.owner_party_id = c.party_id) as items,
                   (select max(to_date) from wms_3pl_bills b where b.client_id = c.id) as "billedTo"
            from wms_3pl_clients c join parties p on p.id = c.party_id join warehouses w on w.id = c.warehouse_id join items i on i.id = c.service_item_id order by p.name`,
      ),
    );
  }

  saveClient(auth: AuthContext, id: string | null, input: z.infer<typeof clientSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select({ isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, input.partyId));
      if (!p?.isCustomer) throw new BadRequestException('A warehousing client must be a customer (it is invoiced)');
      const [svc] = await tx.select({ isStockItem: items.isStockItem }).from(items).where(eq(items.id, input.serviceItemId));
      if (!svc) throw new NotFoundException('Service item not found');
      if (svc.isStockItem) throw new BadRequestException('Bill warehousing with a service item (not a stock item)');
      const values = {
        partyId: input.partyId,
        warehouseId: input.warehouseId,
        storagePerPalletDay: money(input.storagePerPalletDay),
        inboundPerUnit: input.inboundPerUnit.toFixed(4),
        outboundPerUnit: input.outboundPerUnit.toFixed(4),
        minimumMonthly: input.minimumMonthly ? money(input.minimumMonthly) : null,
        defaultUnitsPerPallet: input.defaultUnitsPerPallet.toFixed(3),
        serviceItemId: input.serviceItemId,
        isActive: input.isActive,
      };
      if (id) return (await tx.update(wms3plClients).set(values).where(eq(wms3plClients.id, id)).returning())[0];
      const [dup] = await tx.select({ id: wms3plClients.id }).from(wms3plClients).where(and(eq(wms3plClients.partyId, input.partyId), eq(wms3plClients.warehouseId, input.warehouseId)));
      if (dup) throw new ConflictException('This client already has a tariff in this warehouse');
      return (await tx.insert(wms3plClients).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  /**
   * Charges for a period: pallet-days (each day's closing quantity of each of the client's items,
   * rounded up to whole pallets), units received and dispatched, and a top-up to the monthly minimum.
   */
  private async compute(tx: Transaction, clientId: string, from: string, to: string) {
    if (to < from) throw new BadRequestException('The period ends before it starts');
    const [c] = await tx.select().from(wms3plClients).where(eq(wms3plClients.id, clientId));
    if (!c) throw new NotFoundException('Client not found');
    const perItem = await many<{ itemId: string; code: string; name: string; palletDays: string; unitsIn: string; unitsOut: string }>(
      tx,
      sql`with days as (select d::date as d from generate_series(${from}::date, ${to}::date, interval '1 day') d),
               own as (select p.item_id, coalesce(p.units_per_pallet, ${c.defaultUnitsPerPallet}::numeric) as upp from wms_item_profiles p where p.owner_party_id = ${c.partyId}),
               moves as (select l.item_id, l.posting_date, l.qty from stock_ledger l where l.warehouse_id = ${c.warehouseId} and l.item_id in (select item_id from own) and not l.is_reversal
                           and not exists (select 1 from stock_ledger r where r.voucher_id = l.voucher_id and r.is_reversal and r.item_id = l.item_id))
          select o.item_id as "itemId", i.code, i.name,
                 (select coalesce(sum(case when b.qty > 0 then ceil(b.qty / nullif(o.upp, 0)) else 0 end), 0) from (
                    select (select coalesce(sum(m.qty), 0) from moves m where m.item_id = o.item_id and m.posting_date <= days.d) as qty from days) b)::text as "palletDays",
                 (select coalesce(sum(m.qty), 0) from moves m where m.item_id = o.item_id and m.qty > 0 and m.posting_date between ${from} and ${to})::text as "unitsIn",
                 (select coalesce(sum(-m.qty), 0) from moves m where m.item_id = o.item_id and m.qty < 0 and m.posting_date between ${from} and ${to})::text as "unitsOut"
          from own o join items i on i.id = o.item_id order by i.code`,
    );
    const palletDays = perItem.reduce((s, r) => s + Number(r.palletDays), 0);
    const unitsIn = perItem.reduce((s, r) => s + Number(r.unitsIn), 0);
    const unitsOut = perItem.reduce((s, r) => s + Number(r.unitsOut), 0);
    const storage = palletDays * Number(c.storagePerPalletDay);
    const handling = unitsIn * Number(c.inboundPerUnit) + unitsOut * Number(c.outboundPerUnit);
    const minimum = c.minimumMonthly ? Number(c.minimumMonthly) : 0;
    const topUp = Math.max(0, minimum - storage - handling);
    return { client: c, perItem, palletDays, unitsIn, unitsOut, storage: Number(money(storage)), handling: Number(money(handling)), topUp: Number(money(topUp)), total: Number(money(storage + handling + topUp)) };
  }

  preview(auth: AuthContext, clientId: string, input: z.infer<typeof billPeriodSchema>) {
    return this.database.run(auth, async (tx) => {
      const r = await this.compute(tx, clientId, input.from, input.to);
      const { client: _c, ...rest } = r;
      return rest;
    });
  }

  /** Saves the bill and raises a draft sales invoice to the client for it. */
  async bill(auth: AuthContext, clientId: string, input: z.infer<typeof billPeriodSchema>, meta: RequestMeta) {
    const r = await this.database.run(auth, async (tx) => {
      const [dup] = await many<{ fromDate: string }>(tx, sql`select from_date as "fromDate" from wms_3pl_bills where client_id = ${clientId} and from_date <= ${input.to} and to_date >= ${input.from} limit 1`);
      if (dup) throw new ConflictException(`This period overlaps a bill from ${dup.fromDate}`);
      return this.compute(tx, clientId, input.from, input.to);
    });
    if (r.total <= 0) throw new BadRequestException('Nothing to bill for this period');
    const line = (desc: string, amount: number) => ({ itemId: r.client.serviceItemId, qty: '1', rate: money(amount), description: desc });
    const lines = [
      r.storage > 0 && line(`Storage ${input.from} to ${input.to}: ${r.palletDays} pallet-days @ ₹${Number(r.client.storagePerPalletDay)}`, r.storage),
      r.unitsIn > 0 && Number(r.client.inboundPerUnit) > 0 && line(`Handling in: ${r.unitsIn} units @ ₹${Number(r.client.inboundPerUnit)}`, r.unitsIn * Number(r.client.inboundPerUnit)),
      r.unitsOut > 0 && Number(r.client.outboundPerUnit) > 0 && line(`Handling out: ${r.unitsOut} units @ ₹${Number(r.client.outboundPerUnit)}`, r.unitsOut * Number(r.client.outboundPerUnit)),
      r.topUp > 0 && line('Top-up to the monthly minimum', r.topUp),
    ].filter(Boolean) as ReturnType<typeof line>[];
    const invoice = (await this.invoices.create(auth, createInvoiceSchema.parse({ customerId: r.client.partyId, notes: `Warehousing ${input.from} to ${input.to}.`, lines }), meta)) as { id: string };
    return this.database.run(auth, async (tx) =>
      (
        await tx
          .insert(wms3plBills)
          .values({ tenantId: auth.tenantId, clientId, fromDate: input.from, toDate: input.to, palletDays: r.palletDays.toFixed(2), unitsIn: r.unitsIn.toFixed(4), unitsOut: r.unitsOut.toFixed(4), storageAmount: money(r.storage), handlingAmount: money(r.handling), minimumTopUp: money(r.topUp), total: money(r.total), invoiceId: invoice.id, createdBy: auth.userId })
          .returning()
      )[0],
    );
  }

  bills(auth: AuthContext, clientId: string) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select b.id, b.from_date as "fromDate", b.to_date as "toDate", b.pallet_days as "palletDays", b.units_in as "unitsIn", b.units_out as "unitsOut", b.total, b.invoice_id as "invoiceId", d.status as "invoiceStatus", d.number as "invoiceNumber" from wms_3pl_bills b left join documents d on d.id = b.invoice_id where b.client_id = ${clientId} order by b.from_date desc`),
    );
  }

  // ---- insights -------------------------------------------------------------------------------------

  /** Pick-face min / max suggested from the last 30 days of outbound quantities of each face's item. */
  faceSuggestions(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, async (tx) => {
      const faces = await many<{ id: string; code: string; itemId: string; itemCode: string; min: string | null; max: string | null; maxQty: string | null }>(
        tx,
        sql`select b.id, b.code, b.fixed_item_id as "itemId", i.code as "itemCode", b.replen_min::text as min, b.replen_max::text as max, b.max_qty::text as "maxQty"
            from wms_bins b join items i on i.id = b.fixed_item_id where b.warehouse_id = ${warehouseId} and b.is_active order by b.code`,
      );
      if (!faces.length) return [];
      const daily = await many<{ itemId: string; d: string; qty: string }>(
        tx,
        sql`select l.item_id as "itemId", l.posting_date::text as d, sum(-l.qty)::text as qty from stock_ledger l
            where l.warehouse_id = ${warehouseId} and l.item_id in ${faces.map((f) => f.itemId)} and l.qty < 0 and not l.is_reversal and l.posting_date > current_date - 30
              and not exists (select 1 from stock_ledger r where r.voucher_id = l.voucher_id and r.item_id = l.item_id and (r.qty > 0 or r.is_reversal))
            group by 1, 2`,
      );
      return faces.map((f) => {
        const series = Array.from({ length: 30 }, (_, i) => {
          const d = new Date(Date.now() + 5.5 * 3_600_000 - i * 86_400_000).toISOString().slice(0, 10);
          return Number(daily.find((x) => x.itemId === f.itemId && x.d === d)?.qty ?? 0);
        });
        const s = faceLevels(series, { capacity: f.maxQty ? Number(f.maxQty) : null });
        return { binId: f.id, bin: f.code, itemCode: f.itemCode, currentMin: f.min, currentMax: f.max, avgDaily: s.avg, peakDaily: s.peak, suggestedMin: s.min, suggestedMax: s.max };
      });
    });
  }

  applyLevels(auth: AuthContext, input: z.infer<typeof applyLevelsSchema>) {
    return this.database.run(auth, async (tx) => {
      for (const l of input.levels) {
        if (l.max <= l.min) throw new BadRequestException('Max must be above min');
        await tx.update(wmsBins).set({ replenMin: l.min.toFixed(4), replenMax: l.max.toFixed(4) }).where(and(eq(wmsBins.id, l.binId), sql`${wmsBins.fixedItemId} is not null`));
      }
      return { updated: input.levels.length };
    });
  }

  /**
   * Floor productivity in a period: per person, picks and put-aways done, units, active time (gaps of
   * up to 10 minutes between confirmations), picks per hour and short picks; plus count accuracy.
   */
  productivity(auth: AuthContext, warehouseId: string, from: string, to: string) {
    return this.database.run(auth, async (tx) => {
      const people = await many<{ userId: string; name: string; picks: number; putaways: number; units: string; shortPicks: number; activeMinutes: number }>(
        tx,
        sql`with done as (
              select t.done_by, t.kind, t.done_at, t.qty, t.done_qty, lag(t.done_at) over (partition by t.done_by order by t.done_at) as prev
              from wms_tasks t where t.warehouse_id = ${warehouseId} and t.status = 'done' and t.done_by is not null
                and (t.done_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date)
            select d.done_by as "userId", u.full_name as name, count(*) filter (where d.kind = 'pick')::int as picks, count(*) filter (where d.kind in ('putaway', 'replenish'))::int as putaways,
                   coalesce(sum(d.done_qty), 0)::text as units, count(*) filter (where d.kind = 'pick' and d.done_qty < d.qty)::int as "shortPicks",
                   coalesce(sum(extract(epoch from d.done_at - d.prev) / 60) filter (where d.done_at - d.prev <= interval '10 minutes'), 0)::int as "activeMinutes"
            from done d join users u on u.id = d.done_by group by d.done_by, u.full_name order by picks desc`,
      );
      const [acc] = await many<{ counts: number; avg: string | null; lines: number }>(
        tx,
        sql`select count(*)::int as counts, round(avg(accuracy_pct), 2)::text as avg, coalesce(sum((select count(*) from wms_bin_count_lines l where l.count_id = c.id)), 0)::int as lines
            from wms_bin_counts c where c.warehouse_id = ${warehouseId} and c.status = 'posted' and (c.posted_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date`,
      );
      return {
        from,
        to,
        people: people.map((p) => ({ ...p, picksPerHour: p.activeMinutes > 0 ? Math.round((p.picks / (p.activeMinutes / 60)) * 10) / 10 : null })),
        totals: { picks: people.reduce((s, p) => s + p.picks, 0), shortPicks: people.reduce((s, p) => s + p.shortPicks, 0), putaways: people.reduce((s, p) => s + p.putaways, 0) },
        accuracy: { counts: acc.counts, lines: acc.lines, avgPct: acc.avg },
      };
    });
  }

  // ---- RFID (pilot) -----------------------------------------------------------------------------------

  tags(auth: AuthContext, itemId?: string) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select t.id, t.epc, t.item_id as "itemId", i.code as "itemCode", t.serial_no as "serialNo", t.created_at as "createdAt" from wms_rfid_tags t join items i on i.id = t.item_id where true ${itemId ? sql`and t.item_id = ${itemId}` : sql``} order by t.created_at desc limit 500`),
    );
  }

  saveTag(auth: AuthContext, input: z.infer<typeof tagSchema>) {
    return this.database.run(auth, async (tx) => {
      const epc = input.epc.toUpperCase();
      const [dup] = await tx.select({ id: wmsRfidTags.id }).from(wmsRfidTags).where(eq(wmsRfidTags.epc, epc));
      if (dup) throw new ConflictException('This EPC is already registered');
      return (await tx.insert(wmsRfidTags).values({ tenantId: auth.tenantId, epc, itemId: input.itemId, serialNo: input.serialNo?.toUpperCase() ?? null }).returning())[0];
    });
  }

  /** Records gate reads: registered tags first, then GS1 SGTIN-96 decoded against item barcodes. Duplicate EPCs in one batch count once. */
  reads(auth: AuthContext, input: z.infer<typeof readsSchema>) {
    return this.database.run(auth, async (tx) => {
      const epcs = [...new Set(input.epcs.map((e) => e.toUpperCase()))];
      const known = await tx.select().from(wmsRfidTags).where(inArray(wmsRfidTags.epc, epcs));
      const decoded = epcs.map((epc) => ({ epc, sg: known.some((k) => k.epc === epc) ? null : decodeSgtin96(epc) }));
      const forms = [...new Set(decoded.flatMap((d) => (d.sg ? gtinForms(d.sg.gtin) : [])))];
      const barcodes = forms.length ? await tx.select({ barcode: itemBarcodes.barcode, itemId: itemBarcodes.itemId }).from(itemBarcodes).where(inArray(itemBarcodes.barcode, forms)) : [];
      const rows = decoded.map(({ epc, sg }) => {
        const k = known.find((x) => x.epc === epc);
        if (k) return { epc, gtin: null, itemId: k.itemId, serialNo: k.serialNo };
        const itemId = sg ? (barcodes.find((b) => gtinForms(sg.gtin).includes(b.barcode))?.itemId ?? null) : null;
        return { epc, gtin: sg?.gtin ?? null, itemId, serialNo: sg?.serial ?? null };
      });
      await tx.insert(wmsRfidReads).values(rows.map((r) => ({ tenantId: auth.tenantId, gate: input.gate, deliveryId: input.deliveryId ?? null, ...r })));
      return { read: rows.length, matched: rows.filter((r) => r.itemId).length, unknown: rows.filter((r) => !r.itemId).map((r) => r.epc) };
    });
  }

  /** Compares what a delivery should carry with the tags read against it at the gate. */
  gateCheck(auth: AuthContext, deliveryId: string) {
    return this.database.run(auth, async (tx) => {
      const expected = await many<{ itemId: string; code: string; qty: string; serials: string[] | null }>(
        tx,
        sql`select l.item_id as "itemId", i.code, sum(l.base_qty)::text as qty,
                   coalesce((select array_agg(s) from delivery_note_lines l2 cross join unnest(l2.serial_nos) as s where l2.delivery_id = ${deliveryId} and l2.item_id = l.item_id), '{}') as serials
            from delivery_note_lines l join items i on i.id = l.item_id where l.delivery_id = ${deliveryId} group by l.item_id, i.code`,
      );
      if (!expected.length) throw new NotFoundException('Delivery note not found or empty');
      const reads = await many<{ itemId: string | null; serialNo: string | null; epc: string }>(tx, sql`select distinct on (epc) item_id as "itemId", serial_no as "serialNo", epc from wms_rfid_reads where delivery_id = ${deliveryId}`);
      const lines = expected.map((e) => {
        const r = reads.filter((x) => x.itemId === e.itemId);
        const readSerials = r.map((x) => x.serialNo?.toUpperCase()).filter(Boolean) as string[];
        const want = (e.serials ?? []).map((s) => s.toUpperCase());
        return { itemId: e.itemId, code: e.code, expected: Number(e.qty), read: r.length, missingSerials: want.filter((s) => !readSerials.includes(s)), ok: r.length >= Number(e.qty) && want.every((s) => readSerials.includes(s)) };
      });
      const unexpected = reads.filter((x) => !x.itemId || !expected.some((e) => e.itemId === x.itemId)).map((x) => x.epc);
      return { deliveryId, ok: lines.every((l) => l.ok) && !unexpected.length, lines, unexpected };
    });
  }
}
