import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asns, customerScheduleLines, customerSchedules, items, parties, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { DatabaseService } from '../../database/database.service';
import { parseSheet } from '../imports/file-parser';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');

export const scheduleSchema = z.object({
  customerId: z.uuid(),
  itemId: z.uuid(),
  customerPartNo: z.string().trim().max(60).nullable().optional(),
  month,
  reference: z.string().trim().max(80).nullable().optional(),
  lines: z.array(z.object({ date: z.iso.date(), qty: z.number().min(0).max(1e9) })).min(1).max(62),
});
export const asnSchema = z.object({ expectedAt: z.iso.datetime({ offset: true }).nullable().optional() });

/**
 * OEM delivery schedules (monthly releases, revised as the customer sends new ones), adherence of
 * dispatches to the schedule, and advance shipping notices for deliveries.
 */
@Injectable()
export class SchedulesService {
  constructor(private readonly database: DatabaseService) {}

  list(auth: AuthContext, q: { month?: string; customerId?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.number, s.month, s.revision, s.reference, s.customer_part_no as "customerPartNo", p.name as customer, s.customer_id as "customerId", i.code as "itemCode", i.name as "itemName", s.item_id as "itemId",
                   (select coalesce(sum(qty), 0)::float8 from customer_schedule_lines l where l.schedule_id = s.id) as qty
            from customer_schedules s join parties p on p.id = s.customer_id join items i on i.id = s.item_id
            where s.status = 'active' ${q.month ? sql`and s.month = ${q.month}` : sql``} ${q.customerId ? sql`and s.customer_id = ${q.customerId}` : sql``}
            order by s.month desc, p.name, i.code limit 1000`,
      ),
    );
  }

  /** A new schedule, or a revision that supersedes the active one for the same customer, item and month. */
  save(auth: AuthContext, input: z.infer<typeof scheduleSchema>) {
    return this.database.run(auth, (tx) => this.saveTx(tx, auth, input));
  }

  private async saveTx(tx: Transaction, auth: AuthContext, input: z.infer<typeof scheduleSchema>) {
    const [c] = await tx.select({ isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, input.customerId));
    if (!c?.isCustomer) throw new BadRequestException('Choose a customer');
    const [it] = await tx.select({ id: items.id }).from(items).where(eq(items.id, input.itemId));
    if (!it) throw new NotFoundException('Item not found');
    for (const l of input.lines) if (l.date.slice(0, 7) !== input.month) throw new BadRequestException(`${l.date} is not in ${input.month}`);
    const [cur] = await tx
      .select()
      .from(customerSchedules)
      .where(and(eq(customerSchedules.customerId, input.customerId), eq(customerSchedules.itemId, input.itemId), eq(customerSchedules.month, input.month), eq(customerSchedules.status, 'active')))
      .for('update');
    if (cur) await tx.update(customerSchedules).set({ status: 'superseded' }).where(eq(customerSchedules.id, cur.id));
    const number = cur?.number ?? (await nextCode(tx, auth.tenantId, 'customer_schedule', 'SCH', 5));
    const [s] = await tx
      .insert(customerSchedules)
      .values({ tenantId: auth.tenantId, number, customerId: input.customerId, itemId: input.itemId, customerPartNo: input.customerPartNo ?? cur?.customerPartNo ?? null, month: input.month, revision: cur ? cur.revision + 1 : 0, reference: input.reference ?? null, createdBy: auth.userId })
      .returning();
    // Same-day lines are added together.
    const byDate = new Map<string, number>();
    for (const l of input.lines) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.qty);
    await tx.insert(customerScheduleLines).values([...byDate].map(([date, qty]) => ({ tenantId: auth.tenantId, scheduleId: s.id, date, qty: String(qty) })));
    return s;
  }

  /** Customer schedule files: customer GSTIN or code, item code (or customer part no), date, qty. */
  async importFile(auth: AuthContext, buffer: Buffer, fileName: string) {
    const sheet = await parseSheet(buffer, fileName);
    return this.database.run(auth, async (tx) => {
      const groups = new Map<string, { customerId: string; itemId: string; customerPartNo: string | null; month: string; lines: { date: string; qty: number }[] }>();
      const errors: { row: number; error: string }[] = [];
      for (const r of sheet.rows) {
        const v = r.values;
        const cust = v.customer_code || v.customer || v.gstin;
        const part = v.customer_part_no || v.part_no || null;
        const itemCode = v.item_code || v.item || null;
        const date = (v.date || v.delivery_date || '').trim();
        const q = Number(v.qty || v.quantity);
        if (!cust || !(itemCode || part) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(q >= 0)) {
          errors.push({ row: r.rowNo, error: 'Needs customer, item code or part no, date (YYYY-MM-DD) and qty' });
          continue;
        }
        const [p] = await many<{ id: string }>(tx, sql`select id from parties where is_customer and deleted_at is null and (code = ${cust} or gstin = ${cust.toUpperCase()}) limit 1`);
        if (!p) {
          errors.push({ row: r.rowNo, error: `Customer ${cust} not found` });
          continue;
        }
        let itemId: string | null = null;
        if (itemCode) itemId = (await many<{ id: string }>(tx, sql`select id from items where code = ${itemCode} limit 1`))[0]?.id ?? null;
        if (!itemId && part) itemId = (await many<{ id: string }>(tx, sql`select item_id as id from customer_schedules where customer_id = ${p.id} and customer_part_no = ${part} order by created_at desc limit 1`))[0]?.id ?? null;
        if (!itemId) {
          errors.push({ row: r.rowNo, error: `Item ${itemCode ?? part} not found` });
          continue;
        }
        const key = `${p.id}|${itemId}|${date.slice(0, 7)}`;
        const g = groups.get(key) ?? { customerId: p.id, itemId, customerPartNo: part, month: date.slice(0, 7), lines: [] };
        g.lines.push({ date, qty: q });
        groups.set(key, g);
      }
      for (const g of groups.values()) await this.saveTx(tx, auth, g);
      return { schedules: groups.size, errors: errors.slice(0, 50) };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(customerSchedules).where(eq(customerSchedules.id, id));
      if (!s) throw new NotFoundException('Schedule not found');
      const lines = await tx.select({ date: customerScheduleLines.date, qty: customerScheduleLines.qty }).from(customerScheduleLines).where(eq(customerScheduleLines.scheduleId, id)).orderBy(customerScheduleLines.date);
      const revisions = await tx.select({ id: customerSchedules.id, revision: customerSchedules.revision, createdAt: customerSchedules.createdAt }).from(customerSchedules).where(and(eq(customerSchedules.number, s.number), eq(customerSchedules.tenantId, s.tenantId))).orderBy(desc(customerSchedules.revision));
      return { ...s, lines, revisions };
    });
  }

  /**
   * Schedule against dispatch for a month, per customer and item: cumulative scheduled quantity
   * due by each date versus cumulative quantity delivered (posted delivery notes) by then.
   * Adherence = delivered ÷ due, capped at 100 %, with the shortfall and the excess.
   */
  adherence(auth: AuthContext, m: string, customerId?: string) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ scheduleId: string; customer: string; itemCode: string; itemName: string; customerId: string; itemId: string; scheduled: number; dueToDate: number; delivered: number; deliveredToDate: number; onTimeDays: number; dueDays: number }>(
        tx,
        sql`with s as (
              select s.id, s.customer_id, s.item_id from customer_schedules s where s.status = 'active' and s.month = ${m} ${customerId ? sql`and s.customer_id = ${customerId}` : sql``}
            ), sl as (
              select s.id as schedule_id, s.customer_id, s.item_id, l.date, l.qty from s join customer_schedule_lines l on l.schedule_id = s.id
            ), d as (
              select dn.customer_id, dl.item_id, doc.doc_date as date, sum(dl.base_qty) as qty
              from delivery_notes dn join documents doc on doc.id = dn.id join delivery_note_lines dl on dl.delivery_id = dn.id
              where doc.status = 'approved' and to_char(doc.doc_date, 'YYYY-MM') = ${m}
              group by 1, 2, 3
            )
            select s.id as "scheduleId", p.name as customer, i.code as "itemCode", i.name as "itemName", s.customer_id as "customerId", s.item_id as "itemId",
                   (select coalesce(sum(qty), 0) from sl where sl.schedule_id = s.id)::float8 as scheduled,
                   (select coalesce(sum(qty), 0) from sl where sl.schedule_id = s.id and sl.date <= (now() at time zone 'Asia/Kolkata')::date)::float8 as "dueToDate",
                   (select coalesce(sum(qty), 0) from d where d.customer_id = s.customer_id and d.item_id = s.item_id)::float8 as delivered,
                   (select coalesce(sum(qty), 0) from d where d.customer_id = s.customer_id and d.item_id = s.item_id and d.date <= (now() at time zone 'Asia/Kolkata')::date)::float8 as "deliveredToDate",
                   -- A schedule date is met when the cumulative dispatch by then covers the cumulative schedule.
                   (select count(*) from sl x where x.schedule_id = s.id and x.date <= (now() at time zone 'Asia/Kolkata')::date
                      and (select coalesce(sum(qty), 0) from d where d.customer_id = s.customer_id and d.item_id = s.item_id and d.date <= x.date)
                          >= (select sum(qty) from sl y where y.schedule_id = s.id and y.date <= x.date))::int as "onTimeDays",
                   (select count(*) from sl x where x.schedule_id = s.id and x.date <= (now() at time zone 'Asia/Kolkata')::date)::int as "dueDays"
            from s join parties p on p.id = s.customer_id join items i on i.id = s.item_id
            order by p.name, i.code`,
      );
      return rows.map((r) => ({
        ...r,
        adherencePct: r.dueToDate > 0 ? Math.round(Math.min(1, r.deliveredToDate / r.dueToDate) * 1000) / 10 : null,
        onTimePct: r.dueDays ? Math.round((r.onTimeDays / r.dueDays) * 1000) / 10 : null,
        shortfall: Math.max(0, r.dueToDate - r.deliveredToDate),
        excess: Math.max(0, r.delivered - r.scheduled),
      }));
    });
  }

  // ---- ASN --------------------------------------------------------------------------------

  asns(auth: AuthContext, customerId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.id, a.number, a.shipped_at as "shippedAt", a.expected_at as "expectedAt", a.vehicle_no as "vehicleNo", a.lr_no as "lrNo", a.packages, a.status, a.lines,
                   p.name as customer, d.number as "deliveryNumber", a.delivery_id as "deliveryId"
            from asns a join parties p on p.id = a.customer_id join documents d on d.id = a.delivery_id
            where true ${customerId ? sql`and a.customer_id = ${customerId}` : sql``} order by a.created_at desc limit 300`,
      ),
    );
  }

  /** An ASN from a posted delivery note, with the customer's part numbers from the schedules. */
  createAsn(auth: AuthContext, deliveryId: string, input: z.infer<typeof asnSchema>) {
    return this.database.run(auth, async (tx) => {
      const [d] = await many<{ id: string; status: string; customerId: string; transporter: string | null; vehicleNo: string | null; lrNo: string | null; packages: number | null; docDate: string; number: string }>(
        tx,
        sql`select dn.id, doc.status, dn.customer_id as "customerId", dn.transporter, dn.vehicle_no as "vehicleNo", dn.lr_no as "lrNo", dn.packages, doc.doc_date::text as "docDate", doc.number
            from delivery_notes dn join documents doc on doc.id = dn.id where dn.id = ${deliveryId}`,
      );
      if (!d) throw new NotFoundException('Delivery note not found');
      if (d.status !== 'approved') throw new BadRequestException('Post the delivery note before sending an ASN');
      const [dup] = await tx.select({ number: asns.number }).from(asns).where(eq(asns.deliveryId, deliveryId));
      if (dup) throw new ConflictException(`ASN ${dup.number} was already sent for this delivery`);
      const lines = await many<{ itemCode: string; itemName: string; customerPartNo: string | null; qty: string; uom: string; batchNo: string | null }>(
        tx,
        sql`select i.code as "itemCode", i.name as "itemName", u.code as uom, l.qty::text as qty, l.batch_no as "batchNo",
                   (select s.customer_part_no from customer_schedules s where s.customer_id = ${d.customerId} and s.item_id = l.item_id and s.customer_part_no is not null order by s.created_at desc limit 1) as "customerPartNo"
            from delivery_note_lines l join items i on i.id = l.item_id join uoms u on u.id = l.uom_id where l.delivery_id = ${deliveryId} order by l.line_no`,
      );
      const number = await nextCode(tx, auth.tenantId, 'asn', 'ASN', 6);
      return (
        await tx
          .insert(asns)
          .values({ tenantId: auth.tenantId, number, deliveryId, customerId: d.customerId, shippedAt: new Date(`${d.docDate}T12:00:00+05:30`), expectedAt: input.expectedAt ? new Date(input.expectedAt) : null, transporter: d.transporter, vehicleNo: d.vehicleNo, lrNo: d.lrNo, packages: d.packages, lines, createdBy: auth.userId })
          .returning()
      )[0];
    });
  }

  markReceived(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.update(asns).set({ status: 'received' }).where(eq(asns.id, id)).returning();
      if (!a) throw new NotFoundException('ASN not found');
      return a;
    });
  }
}
