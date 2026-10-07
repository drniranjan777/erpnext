import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { itemBarcodes, items, wmsAppointments, wmsBins, wmsDockDoors, wmsPackages, wmsSettings, wmsTasks, wmsWaves, type Transaction } from '@nextgen/database';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { applyBinMove, NIL_BATCH, wmsConfigs } from '../inventory/bins';
import { ReceiptsService } from '../purchase/receipts.service';
import { createGrnSchema } from '../purchase/receipts.schemas';
import { DeliveriesService } from '../sales/deliveries.service';
import { createDeliverySchema } from '../sales/sales.schemas';
import { allocate, normaliseSscc, sscc, validSscc, type BinStockRow } from './outbound';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const n4 = (v: number) => v.toFixed(4);

export const settingsSchema = z.object({ gs1Prefix: z.string().trim().regex(/^\d{7,10}$/, '7 to 10 digits').nullable(), ssccExtension: z.number().int().min(0).max(9).default(0) });
export const doorSchema = z.object({ warehouseId: z.uuid(), code: z.string().trim().min(1).max(10), name: z.string().trim().min(2).max(60), direction: z.enum(['inbound', 'outbound', 'both']).default('both'), isActive: z.boolean().default(true) });
export const appointmentSchema = z.object({
  doorId: z.uuid(),
  direction: z.enum(['inbound', 'outbound']),
  partyId: z.uuid().nullable().optional(),
  documentId: z.uuid().nullable().optional(),
  reference: text(80),
  vehicleNo: text(15),
  startsAt: z.iso.datetime({ offset: true }),
  minutes: z.number().int().min(10).max(24 * 60).default(60),
  notes: text(500),
});
export const appointmentStatusSchema = z.object({ status: z.enum(['arrived', 'in_progress', 'done', 'no_show', 'cancelled']) });
export const receivingSchema = z.object({
  poId: z.uuid(),
  warehouseId: z.uuid(),
  appointmentId: z.uuid().nullable().optional(),
  vehicleNo: text(15),
  challanNo: text(40),
  lines: z.array(z.object({ poLineId: z.uuid(), receivedQty: z.number().positive().max(1e10), batchNo: text(40), mfgDate: z.iso.date().nullable().optional(), expiryDate: z.iso.date().nullable().optional() })).min(1).max(300),
});
export const waveSchema = z.object({ warehouseId: z.uuid(), orderIds: z.array(z.uuid()).min(1).max(100), mode: z.enum(['order', 'batch', 'zone']).default('order') });
export const pickSchema = z.object({ binCode: z.string().trim().max(30).optional(), binId: z.uuid().optional(), qty: z.number().min(0).max(1e10) });
export const packageSchema = z.object({ orderId: z.uuid(), waveId: z.uuid().nullable().optional(), kind: z.enum(['carton', 'pallet']).default('carton') });
export const packItemSchema = z.object({ itemId: z.uuid(), batchId: z.uuid().nullable().optional(), qty: z.number().positive().max(1e10) });
export const closePackageSchema = z.object({ grossWeightKg: z.number().positive().max(1e6).nullable().optional() });
export const loadSchema = z.object({ deliveryId: z.uuid(), code: z.string().trim().min(18).max(40), vehicleNo: text(15) });

/**
 * Inbound and outbound flows on top of bin stock: dock appointments, receiving by scan into a GRN,
 * waves of FEFO pick tasks from sales orders, packing into SSCC-numbered cartons, delivery notes
 * built from what was picked, and the loading check.
 */
@Injectable()
export class WmsFlowService {
  constructor(
    private readonly database: DatabaseService,
    private readonly receipts: ReceiptsService,
    private readonly deliveries: DeliveriesService,
  ) {}

  private async cfg(tx: Transaction, warehouseId: string) {
    const c = (await wmsConfigs(tx, [warehouseId])).get(warehouseId);
    if (!c) throw new BadRequestException('This warehouse does not run with bins');
    return c;
  }

  // ---- settings and scanning ------------------------------------------------------------------

  settings(auth: AuthContext) {
    return this.database.run(auth, async (tx) => (await tx.select().from(wmsSettings))[0] ?? { gs1Prefix: null, ssccExtension: 0 });
  }

  saveSettings(auth: AuthContext, input: z.infer<typeof settingsSchema>) {
    return this.database.run(auth, async (tx) =>
      (await tx.insert(wmsSettings).values({ tenantId: auth.tenantId, ...input }).onConflictDoUpdate({ target: wmsSettings.tenantId, set: { ...input, updatedAt: new Date() } }).returning())[0],
    );
  }

  /** What a scanned code is in this warehouse: a bin, a carton (SSCC) or an item (code or barcode). */
  resolve(auth: AuthContext, warehouseId: string, code: string) {
    return this.database.run(auth, async (tx) => {
      const raw = code.trim();
      const [bin] = await tx.select({ id: wmsBins.id, code: wmsBins.code }).from(wmsBins).where(and(eq(wmsBins.warehouseId, warehouseId), eq(wmsBins.code, raw.toUpperCase())));
      if (bin) return { kind: 'bin' as const, ...bin };
      const s = normaliseSscc(raw);
      if (validSscc(s)) {
        const [p] = await tx.select({ id: wmsPackages.id, sscc: wmsPackages.sscc, status: wmsPackages.status, orderId: wmsPackages.orderId }).from(wmsPackages).where(eq(wmsPackages.sscc, s));
        if (p) return { kind: 'package' as const, ...p };
      }
      const [byBarcode] = await tx
        .select({ id: items.id, code: items.code, name: items.name, uomId: itemBarcodes.uomId })
        .from(itemBarcodes)
        .innerJoin(items, eq(items.id, itemBarcodes.itemId))
        .where(eq(itemBarcodes.barcode, raw));
      const [byCode] = byBarcode ? [] : await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(eq(items.code, raw.toUpperCase()));
      const it = byBarcode ?? byCode;
      if (!it) throw new NotFoundException(`Nothing matches ${raw}`);
      return { kind: 'item' as const, id: it.id, code: it.code, name: it.name, uomId: (byBarcode?.uomId as string | null | undefined) ?? null };
    });
  }

  // ---- docks ----------------------------------------------------------------------------------

  doors(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) => tx.select().from(wmsDockDoors).where(eq(wmsDockDoors.warehouseId, warehouseId)).orderBy(wmsDockDoors.code));
  }

  saveDoor(auth: AuthContext, id: string | null, input: z.infer<typeof doorSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.cfg(tx, input.warehouseId);
      if (id) {
        const [d] = await tx.update(wmsDockDoors).set({ code: input.code, name: input.name, direction: input.direction, isActive: input.isActive }).where(eq(wmsDockDoors.id, id)).returning();
        if (!d) throw new NotFoundException('Dock door not found');
        return d;
      }
      const [dup] = await tx.select({ id: wmsDockDoors.id }).from(wmsDockDoors).where(and(eq(wmsDockDoors.warehouseId, input.warehouseId), eq(wmsDockDoors.code, input.code)));
      if (dup) throw new ConflictException(`Door ${input.code} already exists`);
      return (await tx.insert(wmsDockDoors).values({ tenantId: auth.tenantId, ...input }).returning())[0];
    });
  }

  appointments(auth: AuthContext, warehouseId: string, date: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.id, a.number, a.direction, a.status, a.door_id as "doorId", d.code as door, a.party_id as "partyId", p.name as party, a.document_id as "documentId", doc.number as "documentNumber", doc.doc_type as "documentType",
                   a.reference, a.vehicle_no as "vehicleNo", a.starts_at as "startsAt", a.ends_at as "endsAt", a.arrived_at as "arrivedAt", a.done_at as "doneAt", a.notes
            from wms_appointments a join wms_dock_doors d on d.id = a.door_id left join parties p on p.id = a.party_id left join documents doc on doc.id = a.document_id
            where a.warehouse_id = ${warehouseId} and (a.starts_at at time zone 'Asia/Kolkata')::date = ${date}::date order by a.starts_at, d.code`,
      ),
    );
  }

  book(auth: AuthContext, input: z.infer<typeof appointmentSchema>) {
    return this.database.run(auth, async (tx) => {
      const [door] = await tx.select().from(wmsDockDoors).where(eq(wmsDockDoors.id, input.doorId)).for('update');
      if (!door || !door.isActive) throw new NotFoundException('Dock door not found');
      if (door.direction !== 'both' && door.direction !== input.direction) throw new BadRequestException(`Door ${door.code} is for ${door.direction} vehicles only`);
      const starts = new Date(input.startsAt);
      const ends = new Date(starts.getTime() + input.minutes * 60_000);
      const [clash] = await many<{ number: string }>(
        tx,
        sql`select number from wms_appointments where door_id = ${door.id} and status in ('booked', 'arrived', 'in_progress') and starts_at < ${ends.toISOString()} and ends_at > ${starts.toISOString()} limit 1`,
      );
      if (clash) throw new ConflictException(`Door ${door.code} is booked then (${clash.number}); choose another time or door`);
      const number = await nextCode(tx, auth.tenantId, 'wms_appointment', 'DA', 6);
      return (
        await tx
          .insert(wmsAppointments)
          .values({ tenantId: auth.tenantId, number, warehouseId: door.warehouseId, doorId: door.id, direction: input.direction, partyId: input.partyId ?? null, documentId: input.documentId ?? null, reference: input.reference ?? null, vehicleNo: input.vehicleNo?.toUpperCase().replace(/[\s-]/g, '') ?? null, startsAt: starts, endsAt: ends, notes: input.notes ?? null, createdBy: auth.userId })
          .returning()
      )[0];
    });
  }

  setAppointment(auth: AuthContext, id: string, status: z.infer<typeof appointmentStatusSchema>['status']) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(wmsAppointments).where(eq(wmsAppointments.id, id)).for('update');
      if (!a) throw new NotFoundException('Appointment not found');
      const next: Record<string, string[]> = { booked: ['arrived', 'no_show', 'cancelled'], arrived: ['in_progress', 'done', 'cancelled'], in_progress: ['done'] };
      if (!next[a.status]?.includes(status)) throw new ConflictException(`An appointment that is ${a.status.replace('_', ' ')} cannot become ${status.replace('_', ' ')}`);
      const now = new Date();
      return (await tx.update(wmsAppointments).set({ status, ...(status === 'arrived' ? { arrivedAt: now } : {}), ...(status === 'in_progress' ? { startedAt: now } : {}), ...(status === 'done' ? { doneAt: now } : {}) }).where(eq(wmsAppointments.id, id)).returning())[0];
    });
  }

  // ---- inbound --------------------------------------------------------------------------------

  /** Turns the quantities counted by scanning into a draft GRN against the PO (it lands in RECV when submitted). */
  async receive(auth: AuthContext, input: z.infer<typeof receivingSchema>, meta: RequestMeta) {
    await this.database.run(auth, (tx) => this.cfg(tx, input.warehouseId));
    const grn = (await this.receipts.create(
      auth,
      createGrnSchema.parse({
        poId: input.poId,
        warehouseId: input.warehouseId,
        vehicleNo: input.vehicleNo ?? null,
        challanNo: input.challanNo ?? null,
        notes: 'Received by scan at the dock.',
        lines: input.lines.map((l) => ({ poLineId: l.poLineId, receivedQty: String(l.receivedQty), batchNo: l.batchNo ?? null, mfgDate: l.mfgDate ?? null, expiryDate: l.expiryDate ?? null })),
      }),
      meta,
    )) as { id: string };
    if (input.appointmentId) {
      await this.database.run(auth, (tx) => tx.update(wmsAppointments).set({ status: 'in_progress', startedAt: new Date(), documentId: input.poId }).where(and(eq(wmsAppointments.id, input.appointmentId!), inArray(wmsAppointments.status, ['booked', 'arrived']))));
    }
    return grn;
  }

  // ---- waves and picking ------------------------------------------------------------------------

  /** Sales orders that still have something to pick from this warehouse. */
  pickable(auth: AuthContext, warehouseId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select so.id, d.number, d.doc_date::text as "docDate", p.name as customer, so.expected_date::text as "expectedDate", count(l.id)::int as lines,
                   sum(greatest(0, l.qty - l.delivered_qty) * l.conversion_factor)::float8 as "openBaseQty"
            from sales_orders so join documents d on d.id = so.id join parties p on p.id = so.customer_id join sales_order_lines l on l.order_id = so.id join items i on i.id = l.item_id
            where d.status = 'approved' and so.closed_at is null and (so.warehouse_id = ${warehouseId} or so.warehouse_id is null) and i.is_stock_item and l.qty > l.delivered_qty
              and not exists (select 1 from wms_waves w where w.status in ('open', 'picked') and so.id = any(w.order_ids))
            group by so.id, d.number, d.doc_date, p.name, so.expected_date order by so.expected_date nulls last, d.doc_date limit 200`,
      ),
    );
  }

  /** Creates pick tasks for the open quantities of the orders, FEFO from storage bins, in walking order. */
  createWave(auth: AuthContext, input: z.infer<typeof waveSchema>) {
    return this.database.run(auth, async (tx) => {
      const cfg = await this.cfg(tx, input.warehouseId);
      await tx.execute(sql`select 1 from wms_warehouses where warehouse_id = ${input.warehouseId} for update`);
      const orders = await many<{ id: string; number: string; status: string; warehouseId: string | null; closedAt: string | null }>(
        tx,
        sql`select so.id, d.number, d.status, so.warehouse_id as "warehouseId", so.closed_at as "closedAt" from sales_orders so join documents d on d.id = so.id where so.id in ${input.orderIds}`,
      );
      for (const id of input.orderIds) {
        const o = orders.find((x) => x.id === id);
        if (!o) throw new NotFoundException('Sales order not found');
        if (o.status !== 'approved' || o.closedAt) throw new BadRequestException(`Order ${o.number} is not open for delivery`);
        if (o.warehouseId && o.warehouseId !== input.warehouseId) throw new BadRequestException(`Order ${o.number} ships from another warehouse`);
      }
      const busy = await many<{ number: string }>(tx, sql`select number from wms_waves where status in ('open', 'picked') and order_ids && ${sql.raw(`'{${input.orderIds.join(',')}}'::uuid[]`)} limit 1`);
      if (busy.length) throw new ConflictException(`One of these orders is already in wave ${busy[0].number}`);
      const lines = await many<{ id: string; orderId: string; itemId: string; open: string; minShelf: number | null }>(
        tx,
        sql`select l.id, l.order_id as "orderId", l.item_id as "itemId", ((l.qty - l.delivered_qty) * l.conversion_factor - coalesce((
                     select sum(dl.base_qty) from delivery_note_lines dl join documents dd on dd.id = dl.delivery_id where dl.so_line_id = l.id and dd.status = 'draft'), 0))::text as open,
                   p.min_shelf_life_days as "minShelf"
            from sales_order_lines l join items i on i.id = l.item_id left join wms_item_profiles p on p.item_id = l.item_id
            where l.order_id in ${input.orderIds} and i.is_stock_item and l.qty > l.delivered_qty order by l.order_id, l.line_no`,
      );
      const itemIds = [...new Set(lines.map((l) => l.itemId))];
      if (!itemIds.length) throw new BadRequestException('Nothing left to pick on these orders');
      const stock = await many<Omit<BinStockRow, 'qty'> & { itemId: string; zoneSeq: number; qty: string; [k: string]: unknown }>(
        tx,
        sql`select s.item_id as "itemId", s.bin_id as "binId", b.code, nullif(s.batch_key, ${NIL_BATCH}::uuid) as "batchId", bt.expiry_date::text as "expiryDate", s.qty::text as qty, b.pick_sequence as "pickSequence",
                   z.kind as "zoneKind", z.sequence as "zoneSeq", b.is_blocked as blocked, coalesce(bt.qc_status in ('quarantine', 'under_test', 'rejected'), false) as held
            from wms_bin_stock s join wms_bins b on b.id = s.bin_id join wms_zones z on z.id = b.zone_id left join batches bt on bt.id = s.batch_key
            where s.warehouse_id = ${input.warehouseId} and s.item_id in ${itemIds} and s.qty > 0 and b.is_active`,
      );
      // Quantities already promised to open picks elsewhere.
      const reservedRows = await many<{ binId: string; batchId: string | null; qty: string }>(
        tx,
        sql`select from_bin_id as "binId", batch_id as "batchId", sum(qty)::text as qty from wms_tasks where warehouse_id = ${input.warehouseId} and status = 'open' and from_bin_id is not null group by from_bin_id, batch_id`,
      );
      const reserved = new Map(reservedRows.map((r) => [`${r.binId}|${r.batchId ?? ''}`, Number(r.qty)]));
      const today = todayIST();
      const number = await nextCode(tx, auth.tenantId, 'wms_wave', 'WV', 5);
      const shortages: { orderId: string; soLineId: string; itemId: string; short: string; why: string }[] = [];
      const picks: { orderId: string; soLineId: string; itemId: string; binId: string; batchId: string | null; qty: number; pickSequence: number; zoneSeq: number }[] = [];
      for (const l of lines) {
        const need = Number(l.open);
        if (need <= 0) continue;
        const rows = stock.filter((s) => s.itemId === l.itemId).map((s) => ({ ...s, qty: Number(s.qty) }));
        const r = allocate(need, rows, { today, minShelfLifeDays: l.minShelf, reserved });
        for (const p of r.picks) {
          const s = rows.find((x) => x.binId === p.binId)!;
          picks.push({ orderId: l.orderId, soLineId: l.id, itemId: l.itemId, binId: p.binId, batchId: p.batchId, qty: p.qty, pickSequence: s.pickSequence, zoneSeq: s.zoneSeq });
        }
        if (r.short > 0) shortages.push({ orderId: l.orderId, soLineId: l.id, itemId: l.itemId, short: n4(r.short), why: r.why });
      }
      if (!picks.length) throw new BadRequestException(`Nothing can be picked: ${shortages[0]?.why ?? 'no stock'}`);
      const orderIdx = new Map(input.orderIds.map((id, i) => [id, i]));
      picks.sort((a, b) =>
        input.mode === 'order' ? orderIdx.get(a.orderId)! - orderIdx.get(b.orderId)! || a.pickSequence - b.pickSequence : input.mode === 'zone' ? a.zoneSeq - b.zoneSeq || a.pickSequence - b.pickSequence : a.pickSequence - b.pickSequence,
      );
      const [wave] = await tx.insert(wmsWaves).values({ tenantId: auth.tenantId, number, warehouseId: input.warehouseId, mode: input.mode, orderIds: input.orderIds, shortages, createdBy: auth.userId }).returning();
      let seq = 0;
      for (const p of picks) {
        const taskNo = await nextCode(tx, auth.tenantId, 'wms_task', 'WT', 6);
        await tx.insert(wmsTasks).values({
          tenantId: auth.tenantId,
          number: taskNo,
          warehouseId: input.warehouseId,
          kind: 'pick',
          itemId: p.itemId,
          batchId: p.batchId,
          qty: n4(p.qty),
          fromBinId: p.binId,
          toBinId: cfg.dispatchBinId,
          reason: 'first expiry first out',
          sourceType: 'sales_order_line',
          sourceId: p.soLineId,
          waveId: wave.id,
          orderId: p.orderId,
          pathSeq: ++seq,
          createdBy: auth.userId,
        });
      }
      return { ...wave, picks: picks.length };
    });
  }

  waves(auth: AuthContext, warehouseId: string, status?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select w.id, w.number, w.mode, w.status, w.created_at as "createdAt", w.shortages, cardinality(w.order_ids) as orders,
                   (select count(*)::int from wms_tasks t where t.wave_id = w.id) as picks, (select count(*)::int from wms_tasks t where t.wave_id = w.id and t.status = 'open') as "openPicks"
            from wms_waves w where w.warehouse_id = ${warehouseId} ${status ? sql`and w.status = ${status}` : sql``} order by w.created_at desc limit 100`,
      ),
    );
  }

  wave(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [w] = await many<{ id: string; orderIds: string[] }>(tx, sql`select w.id, w.number, w.mode, w.status, w.warehouse_id as "warehouseId", w.order_ids as "orderIds", w.shortages, w.created_at as "createdAt" from wms_waves w where w.id = ${id}`);
      if (!w) throw new NotFoundException('Wave not found');
      const orders = await many(
        tx,
        sql`select so.id, d.number, p.name as customer,
                   (select count(*)::int from wms_packages k where k.order_id = so.id and k.wave_id = ${id}) as packages,
                   (select max(dd.number) from wms_packages k join documents dd on dd.id = k.delivery_id where k.order_id = so.id and k.wave_id = ${id}) as "deliveryNumber",
                   (select max(k.delivery_id::text) from wms_packages k where k.order_id = so.id and k.wave_id = ${id}) as "deliveryId"
            from sales_orders so join documents d on d.id = so.id join parties p on p.id = so.customer_id where so.id in ${w.orderIds}`,
      );
      const tasks = await many(
        tx,
        sql`select t.id, t.number, t.status, t.path_seq as "pathSeq", t.order_id as "orderId", d.number as "orderNumber", t.item_id as "itemId", i.code as "itemCode", i.name as "itemName", t.batch_id as "batchId", bt.batch_no as "batchNo", bt.expiry_date::text as "expiryDate",
                   t.qty::text as qty, t.done_qty::text as "doneQty", fb.code as "fromBin", z.code as zone, db.code as "doneBin", t.assignee_id as "assigneeId", u.full_name as assignee
            from wms_tasks t join items i on i.id = t.item_id left join batches bt on bt.id = t.batch_id left join wms_bins fb on fb.id = t.from_bin_id left join wms_zones z on z.id = fb.zone_id
            left join wms_bins db on db.id = t.done_bin_id left join documents d on d.id = t.order_id left join users u on u.id = t.assignee_id
            where t.wave_id = ${id} order by t.path_seq`,
      );
      return { ...w, orders, tasks };
    });
  }

  cancelWave(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.select().from(wmsWaves).where(eq(wmsWaves.id, id)).for('update');
      if (!w) throw new NotFoundException('Wave not found');
      if (!['open', 'picked'].includes(w.status)) throw new ConflictException(`The wave is ${w.status}`);
      await tx.update(wmsTasks).set({ status: 'cancelled', doneAt: new Date(), doneBy: auth.userId }).where(and(eq(wmsTasks.waveId, id), eq(wmsTasks.status, 'open')));
      await tx.update(wmsWaves).set({ status: 'cancelled' }).where(eq(wmsWaves.id, id));
      return { ok: true, note: 'Anything already picked stays in the dispatch bin; move it back with a bin move if it will not ship.' };
    });
  }

  /** Assigns the open picks of one zone (zone picking) or of the whole wave to a picker. */
  assign(auth: AuthContext, waveId: string, userId: string | null, zone?: string) {
    return this.database.run(auth, async (tx) => {
      const r = await tx.execute(
        sql`update wms_tasks t set assignee_id = ${userId} from wms_bins b join wms_zones z on z.id = b.zone_id
            where t.wave_id = ${waveId} and t.status = 'open' and b.id = t.from_bin_id ${zone ? sql`and z.code = ${zone}` : sql``}`,
      );
      return { assigned: r.rowCount ?? 0 };
    });
  }

  /** Confirms a pick by scanning the bin it was taken from; the goods move to the dispatch bin. */
  confirmPick(auth: AuthContext, id: string, input: z.infer<typeof pickSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(wmsTasks).where(eq(wmsTasks.id, id)).for('update');
      if (!t || t.kind !== 'pick') throw new NotFoundException('Pick not found');
      if (t.status !== 'open') throw new ConflictException(`Pick ${t.number} is already ${t.status}`);
      if (input.qty > Number(t.qty)) throw new BadRequestException(`The pick is for ${Number(t.qty)} only`);
      const cfg = await this.cfg(tx, t.warehouseId);
      const [bin] = input.binId
        ? await tx.select().from(wmsBins).where(and(eq(wmsBins.id, input.binId), eq(wmsBins.warehouseId, t.warehouseId)))
        : await tx.select().from(wmsBins).where(and(eq(wmsBins.code, (input.binCode ?? '').toUpperCase()), eq(wmsBins.warehouseId, t.warehouseId)));
      if (!bin) throw new BadRequestException('Scan a bin of this warehouse');
      if (bin.id === cfg.dispatchBinId || bin.id === cfg.receivingBinId) throw new BadRequestException('Pick from a storage bin');
      const qty = n4(input.qty);
      await tx.update(wmsTasks).set({ status: 'done', doneQty: qty, doneBinId: bin.id, doneAt: new Date(), doneBy: auth.userId }).where(eq(wmsTasks.id, id));
      if (input.qty > 0) {
        await applyBinMove(tx, auth.tenantId, auth.userId, cfg, { warehouseId: t.warehouseId, itemId: t.itemId, batchId: t.batchId, qty: `-${qty}`, binId: bin.id, kind: 'pick', taskId: t.id, label: t.number });
        await applyBinMove(tx, auth.tenantId, auth.userId, cfg, { warehouseId: t.warehouseId, itemId: t.itemId, batchId: t.batchId, qty, binId: cfg.dispatchBinId, kind: 'pick', taskId: t.id, label: t.number });
      }
      if (t.waveId) {
        const [open] = await many(tx, sql`select 1 from wms_tasks where wave_id = ${t.waveId} and status = 'open' limit 1`);
        if (!open) await tx.update(wmsWaves).set({ status: 'picked' }).where(and(eq(wmsWaves.id, t.waveId), eq(wmsWaves.status, 'open')));
      }
      return { ok: true, short: Number(t.qty) - input.qty > 0 ? n4(Number(t.qty) - input.qty) : null, otherBin: bin.id !== t.fromBinId ? bin.code : null };
    });
  }

  // ---- packing ----------------------------------------------------------------------------------

  /** Picked but not yet packed, per order, item and batch. */
  private async unpacked(tx: Transaction, orderId: string) {
    const picked = await many<{ itemId: string; batchId: string | null; qty: string }>(
      tx,
      sql`select t.item_id as "itemId", t.batch_id as "batchId", sum(t.done_qty)::text as qty from wms_tasks t join wms_waves w on w.id = t.wave_id
          where t.order_id = ${orderId} and t.kind = 'pick' and t.status = 'done' and w.status in ('open', 'picked') group by t.item_id, t.batch_id`,
    );
    const packed = await many<{ itemId: string; batchId: string | null; qty: string }>(
      tx,
      sql`select c->>'itemId' as "itemId", nullif(c->>'batchId', '') as "batchId", sum((c->>'qty')::numeric)::text as qty
          from wms_packages k cross join jsonb_array_elements(k.contents) c where k.order_id = ${orderId} and k.delivery_id is null group by 1, 2`,
    );
    return picked.map((p) => ({ ...p, left: Number(p.qty) - Number(packed.find((x) => x.itemId === p.itemId && (x.batchId ?? null) === (p.batchId ?? null))?.qty ?? 0) }));
  }

  packing(auth: AuthContext, orderId: string) {
    return this.database.run(auth, async (tx) => {
      const left = await this.unpacked(tx, orderId);
      const names = left.length ? await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(inArray(items.id, left.map((l) => l.itemId))) : [];
      const packages = await many(tx, sql`select id, sscc, kind, status, contents, gross_weight_kg as "grossWeightKg", delivery_id as "deliveryId", created_at as "createdAt" from wms_packages where order_id = ${orderId} order by created_at`);
      return { toPack: left.filter((l) => l.left > 0).map((l) => ({ ...l, left: n4(l.left), ...names.find((x) => x.id === l.itemId) })), packages };
    });
  }

  openPackage(auth: AuthContext, input: z.infer<typeof packageSchema>) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(wmsSettings);
      if (!s?.gs1Prefix) throw new BadRequestException('Set your GS1 company prefix in warehouse settings to number cartons');
      const [o] = await many<{ warehouseId: string | null }>(tx, sql`select so.warehouse_id as "warehouseId" from sales_orders so where so.id = ${input.orderId}`);
      if (!o) throw new NotFoundException('Sales order not found');
      const [w] = input.waveId ? await tx.select().from(wmsWaves).where(eq(wmsWaves.id, input.waveId)) : [];
      const warehouseId = w?.warehouseId ?? o.warehouseId;
      if (!warehouseId) throw new BadRequestException('Pack from a wave');
      const serial = Number(await nextCode(tx, auth.tenantId, 'sscc', '', 0));
      return (await tx.insert(wmsPackages).values({ tenantId: auth.tenantId, sscc: sscc(s.ssccExtension, s.gs1Prefix, serial), warehouseId, orderId: input.orderId, waveId: input.waveId ?? null, kind: input.kind, createdBy: auth.userId }).returning())[0];
    });
  }

  packItem(auth: AuthContext, id: string, input: z.infer<typeof packItemSchema>) {
    return this.database.run(auth, async (tx) => {
      const [k] = await tx.select().from(wmsPackages).where(eq(wmsPackages.id, id)).for('update');
      if (!k) throw new NotFoundException('Carton not found');
      if (k.status !== 'open') throw new ConflictException(`Carton ${k.sscc} is ${k.status}`);
      const left = (await this.unpacked(tx, k.orderId)).filter((l) => l.itemId === input.itemId && (!input.batchId || l.batchId === input.batchId) && l.left > 0);
      const available = left.reduce((s, l) => s + l.left, 0);
      if (input.qty > available + 1e-9) throw new BadRequestException(available > 0 ? `Only ${available} picked for this order is still unpacked` : 'Nothing of this item was picked for this order');
      // Fill from the batches picked, oldest pick first.
      const contents = [...k.contents];
      let rest = input.qty;
      for (const l of left) {
        if (rest <= 0) break;
        const q = Math.min(rest, l.left);
        const at = contents.findIndex((c) => c.itemId === l.itemId && (c.batchId ?? null) === (l.batchId ?? null));
        if (at >= 0) contents[at] = { ...contents[at], qty: n4(Number(contents[at].qty) + q) };
        else contents.push({ itemId: l.itemId, batchId: l.batchId ?? null, qty: n4(q) });
        rest -= q;
      }
      return (await tx.update(wmsPackages).set({ contents }).where(eq(wmsPackages.id, id)).returning())[0];
    });
  }

  closePackage(auth: AuthContext, id: string, input: z.infer<typeof closePackageSchema>) {
    return this.database.run(auth, async (tx) => {
      const [k] = await tx.select().from(wmsPackages).where(eq(wmsPackages.id, id)).for('update');
      if (!k) throw new NotFoundException('Carton not found');
      if (k.status !== 'open') throw new ConflictException(`Carton ${k.sscc} is already ${k.status}`);
      if (!k.contents.length) throw new BadRequestException('The carton is empty');
      return (await tx.update(wmsPackages).set({ status: 'closed', grossWeightKg: input.grossWeightKg?.toString() ?? null, closedAt: new Date() }).where(eq(wmsPackages.id, id)).returning())[0];
    });
  }

  label(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [k] = await many<{ contents: { itemId: string; batchId: string | null; qty: string }[] }>(
        tx,
        sql`select k.id, k.sscc, k.kind, k.status, k.contents, k.gross_weight_kg as "grossWeightKg", d.number as "orderNumber", so.customer_po_no as "customerPoNo", p.name as customer, so.shipping_address as "shipTo",
                   (select name from companies where deleted_at is null order by created_at limit 1) as shipper, dd.number as "deliveryNumber",
                   (select count(*)::int from wms_packages x where x.order_id = k.order_id and x.created_at <= k.created_at) as seq, (select count(*)::int from wms_packages x where x.order_id = k.order_id) as of
            from wms_packages k join sales_orders so on so.id = k.order_id join documents d on d.id = so.id join parties p on p.id = so.customer_id left join documents dd on dd.id = k.delivery_id where k.id = ${id}`,
      );
      if (!k) throw new NotFoundException('Carton not found');
      const ids = k.contents.map((c) => c.itemId);
      const names = ids.length ? await many<{ id: string; code: string; name: string }>(tx, sql`select id, code, name from items where id in ${ids}`) : [];
      const bnos = k.contents.some((c) => c.batchId) ? await many<{ id: string; batchNo: string; expiryDate: string | null }>(tx, sql`select id, batch_no as "batchNo", expiry_date::text as "expiryDate" from batches where id in ${k.contents.filter((c) => c.batchId).map((c) => c.batchId!)}`) : [];
      return { ...k, contents: k.contents.map((c) => ({ ...c, ...names.find((x) => x.id === c.itemId), batch: bnos.find((b) => b.id === c.batchId) ?? null })) };
    });
  }

  // ---- delivery and loading --------------------------------------------------------------------

  /** Draft delivery notes, one per order, with exactly the batches and quantities picked; closed cartons are attached. */
  deliverWave(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.select().from(wmsWaves).where(eq(wmsWaves.id, id)).for('update');
      if (!w) throw new NotFoundException('Wave not found');
      if (w.status !== 'picked') throw new ConflictException(w.status === 'open' ? 'Finish (or cancel) the open picks first' : `The wave is ${w.status}`);
      const open = await many<{ sscc: string }>(tx, sql`select sscc from wms_packages where wave_id = ${id} and status = 'open' limit 1`);
      if (open.length) throw new ConflictException(`Close carton ${open[0].sscc} first`);
      const created: { orderId: string; deliveryId: string; number: string | null }[] = [];
      for (const orderId of w.orderIds) {
        const lines = await many<{ soLineId: string; batchNo: string | null; baseQty: string; factor: string }>(
          tx,
          sql`select t.source_id as "soLineId", bt.batch_no as "batchNo", sum(t.done_qty)::text as "baseQty", l.conversion_factor::text as factor
              from wms_tasks t join sales_order_lines l on l.id = t.source_id left join batches bt on bt.id = t.batch_id
              where t.wave_id = ${id} and t.order_id = ${orderId} and t.status = 'done' and t.done_qty > 0 group by t.source_id, bt.batch_no, l.conversion_factor, l.line_no order by l.line_no`,
        );
        if (!lines.length) continue;
        const pk = await many<{ n: number; kg: string | null }>(tx, sql`select count(*)::int as n, sum(gross_weight_kg)::text as kg from wms_packages where wave_id = ${id} and order_id = ${orderId} and status = 'closed'`);
        const dn = (await this.deliveries.createTx(
          tx,
          auth,
          createDeliverySchema.parse({
            orderId,
            warehouseId: w.warehouseId,
            packages: pk[0]?.n || null,
            grossWeightKg: pk[0]?.kg ?? null,
            notes: `Picked in wave ${w.number}.`,
            lines: lines.map((l) => ({ soLineId: l.soLineId, qty: Decimal.from(l.baseQty).div(Decimal.from(l.factor)).toFixed(4), batchNo: l.batchNo })),
          }),
          meta,
        )) as { id: string; number: string | null };
        await tx.update(wmsPackages).set({ deliveryId: dn.id }).where(and(eq(wmsPackages.waveId, id), eq(wmsPackages.orderId, orderId)));
        created.push({ orderId, deliveryId: dn.id, number: dn.number });
      }
      if (!created.length) throw new BadRequestException('Nothing was picked in this wave');
      await tx.update(wmsWaves).set({ status: 'delivered' }).where(eq(wmsWaves.id, id));
      return { deliveries: created };
    });
  }

  /** Cartons of a delivery and whether each is on the vehicle. */
  loading(auth: AuthContext, deliveryId: string) {
    return this.database.run(auth, async (tx) => {
      const [d] = await many(tx, sql`select d.id, d.number, d.status, dn.vehicle_no as "vehicleNo", p.name as customer from delivery_notes dn join documents d on d.id = dn.id join sales_orders so on so.id = dn.order_id join parties p on p.id = so.customer_id where dn.id = ${deliveryId}`);
      if (!d) throw new NotFoundException('Delivery note not found');
      const packages = await many<{ status: string }>(tx, sql`select id, sscc, kind, status, gross_weight_kg as "grossWeightKg", vehicle_no as "vehicleNo", loaded_at as "loadedAt" from wms_packages where delivery_id = ${deliveryId} order by created_at`);
      return { ...d, packages, loaded: packages.filter((p) => p.status === 'loaded').length, total: packages.length };
    });
  }

  load(auth: AuthContext, input: z.infer<typeof loadSchema>) {
    return this.database.run(auth, async (tx) => {
      const code = normaliseSscc(input.code);
      if (!validSscc(code)) throw new BadRequestException('That is not a valid SSCC');
      const [k] = await tx.select().from(wmsPackages).where(eq(wmsPackages.sscc, code)).for('update');
      if (!k) throw new NotFoundException(`Carton ${code} is not known`);
      if (k.deliveryId !== input.deliveryId) throw new ConflictException(`Carton ${code} belongs to another delivery; do not load it on this vehicle`);
      if (k.status === 'loaded') throw new ConflictException(`Carton ${code} is already loaded`);
      if (k.status !== 'closed') throw new ConflictException(`Carton ${code} is not closed`);
      await tx.update(wmsPackages).set({ status: 'loaded', vehicleNo: input.vehicleNo?.toUpperCase().replace(/[\s-]/g, '') ?? null, loadedAt: new Date(), loadedBy: auth.userId }).where(eq(wmsPackages.id, k.id));
      const [left] = await many<{ n: number }>(tx, sql`select count(*)::int as n from wms_packages where delivery_id = ${input.deliveryId} and status <> 'loaded'`);
      return { ok: true, sscc: code, remaining: left.n };
    });
  }
}
