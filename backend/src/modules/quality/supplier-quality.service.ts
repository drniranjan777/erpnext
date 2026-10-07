import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { approvedManufacturers, inspectionParameters, parties, supplierAudits, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { attributeChart, variablesCharts } from './spc';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export const auditSchema = z.object({
  partyId: z.uuid(),
  auditDate: z.iso.date(),
  kind: z.enum(['system', 'process', 'product']).default('system'),
  auditor: z.string().trim().min(2).max(120),
  score: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
    .refine((v) => v === null || (Number(v) >= 0 && Number(v) <= 100), 'Score: 0 to 100'),
  result: z.enum(['approved', 'conditional', 'disapproved']),
  findings: optionalText(4000),
  nextDue: z.iso.date().nullable().optional(),
});

export const amlSchema = z.object({
  itemId: z.uuid(),
  manufacturer: z.string().trim().min(1).max(120),
  mpn: z.string().trim().max(80).default(''),
  partyId: z.uuid().nullable().optional(),
  status: z.enum(['approved', 'conditional', 'disqualified']).default('approved'),
  approvedOn: z.iso.date().nullable().optional(),
  notes: optionalText(500),
});

/**
 * Supplier quality (scorecards, audits, approved manufacturer list) and SPC on inspection
 * readings.
 */
@Injectable()
export class SupplierQualityService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Per vendor over a period: lot acceptance, PPM, NCRs and their cost, on-time delivery,
   * open SCARs and the last audit, rolled into a score (50 % acceptance, 30 % on time,
   * 20 % audit) and a grade.
   */
  scorecard(auth: AuthContext, q: { from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; name: string; lots: number; accepted: number; received: string | null; rejected: string | null; ncrs: number; copq: string | null; lines: number; on_time: number; scars: number; audit_score: string | null; audit_result: string | null; audit_date: string | null }>(
        tx,
        sql`with lots as (
              select g.vendor_id, count(*)::int as lots, count(*) filter (where qi.result = 'accepted')::int as accepted,
                     sum(qi.lot_qty) as received, sum(qi.rejected_qty + qi.rework_qty) as rejected
              from quality_inspections qi join documents d on d.id = qi.id join goods_receipts g on g.id = qi.source_doc_id
              where qi.stage = 'incoming' and d.status = 'approved' and d.doc_date between ${q.from}::date and ${q.to}::date
              group by 1),
            nc as (
              select n.party_id, count(*)::int as ncrs, sum(n.copq) as copq
              from ncrs n join documents d on d.id = n.id
              where d.status = 'approved' and n.source in ('incoming', 'supplier') and d.doc_date between ${q.from}::date and ${q.to}::date
              group by 1),
            otd as (
              select g.vendor_id, count(*)::int as lines,
                     count(*) filter (where gd.doc_date <= coalesce(pl.delivery_date, po.expected_date, gd.doc_date))::int as on_time
              from goods_receipt_lines gl join goods_receipts g on g.id = gl.grn_id join documents gd on gd.id = g.id
              join purchase_order_lines pl on pl.id = gl.po_line_id join purchase_orders po on po.id = pl.po_id
              where gd.status = 'approved' and gd.doc_date between ${q.from}::date and ${q.to}::date
              group by 1),
            sc as (
              select c.party_id, count(*)::int as scars from capas c join documents d on d.id = c.id
              where c.is_scar and c.stage <> 'closed' and d.status <> 'cancelled' group by 1),
            au as (
              select distinct on (party_id) party_id, score, result, audit_date from supplier_audits order by party_id, audit_date desc)
            select p.id, p.name, coalesce(lots.lots, 0) as lots, coalesce(lots.accepted, 0) as accepted, lots.received::text, lots.rejected::text,
                   coalesce(nc.ncrs, 0) as ncrs, nc.copq::text, coalesce(otd.lines, 0) as lines, coalesce(otd.on_time, 0) as on_time, coalesce(sc.scars, 0) as scars,
                   au.score::text as audit_score, au.result as audit_result, au.audit_date::text as audit_date
            from parties p
            left join lots on lots.vendor_id = p.id left join nc on nc.party_id = p.id left join otd on otd.vendor_id = p.id left join sc on sc.party_id = p.id left join au on au.party_id = p.id
            where p.is_vendor and (lots.lots is not null or nc.ncrs is not null or otd.lines is not null or sc.scars is not null or au.party_id is not null)
            order by p.name`,
      );
      return rows.map((r) => {
        const acceptance = r.lots ? (r.accepted / r.lots) * 100 : null;
        const otdPct = r.lines ? (r.on_time / r.lines) * 100 : null;
        const ppm = num(r.received) > 0 ? Math.round((num(r.rejected) / num(r.received)) * 1_000_000) : null;
        const audit = r.audit_score !== null ? num(r.audit_score) : null;
        const parts: [number | null, number][] = [
          [acceptance, 0.5],
          [otdPct, 0.3],
          [audit, 0.2],
        ];
        const known = parts.filter(([v]) => v !== null) as [number, number][];
        const weight = known.reduce((s, [, w]) => s + w, 0);
        const score = weight ? Math.round(known.reduce((s, [v, w]) => s + v * w, 0) / weight) : null;
        return {
          vendor: { id: r.id, name: r.name },
          lots: r.lots,
          acceptancePct: acceptance === null ? null : Math.round(acceptance * 10) / 10,
          ppm,
          ncrs: r.ncrs,
          copq: r.copq ?? '0',
          deliveries: r.lines,
          onTimePct: otdPct === null ? null : Math.round(otdPct * 10) / 10,
          openScars: r.scars,
          lastAudit: r.audit_date ? { date: r.audit_date, score: r.audit_score, result: r.audit_result } : null,
          score,
          grade: score === null ? null : score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D',
        };
      });
    });
  }

  audits(auth: AuthContext, partyId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.id, a.party_id as "partyId", p.name as vendor, a.audit_date::text as "auditDate", a.kind, a.auditor, a.score::text, a.result, a.findings, a.next_due::text as "nextDue",
                   (a.next_due is not null and a.next_due < (now() at time zone 'Asia/Kolkata')::date and not exists (select 1 from supplier_audits b where b.party_id = a.party_id and b.audit_date > a.audit_date)) as overdue
            from supplier_audits a join parties p on p.id = a.party_id ${partyId ? sql`where a.party_id = ${partyId}` : sql``}
            order by a.audit_date desc`,
      ),
    );
  }

  addAudit(auth: AuthContext, input: z.infer<typeof auditSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select({ isVendor: parties.isVendor }).from(parties).where(eq(parties.id, input.partyId));
      if (!p?.isVendor) throw new BadRequestException('Choose a vendor');
      if (input.nextDue && input.nextDue <= input.auditDate) throw new BadRequestException('The next audit must be after this one');
      const [r] = await tx.insert(supplierAudits).values({ tenantId: auth.tenantId, ...input, nextDue: input.nextDue ?? null, createdBy: auth.userId }).returning();
      return r;
    });
  }

  aml(auth: AuthContext, itemId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select m.id, m.item_id as "itemId", i.code, i.name, m.manufacturer, m.mpn, m.party_id as "partyId", p.name as supplier, m.status, m.approved_on::text as "approvedOn", m.notes
            from approved_manufacturers m join items i on i.id = m.item_id left join parties p on p.id = m.party_id
            ${itemId ? sql`where m.item_id = ${itemId}` : sql``} order by i.code, m.manufacturer, m.mpn`,
      ),
    );
  }

  saveAml(auth: AuthContext, id: string | null, input: z.infer<typeof amlSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, partyId: input.partyId ?? null, approvedOn: input.approvedOn ?? null };
      try {
        if (id) {
          const [r] = await tx.update(approvedManufacturers).set(values).where(eq(approvedManufacturers.id, id)).returning();
          if (!r) throw new NotFoundException('Entry not found');
          return r;
        }
        const [r] = await tx.insert(approvedManufacturers).values({ tenantId: auth.tenantId, ...values }).returning();
        return r;
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException(`${input.manufacturer} ${input.mpn} is already listed for this item`);
        throw e;
      }
    });
  }

  removeAml(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(approvedManufacturers).where(and(eq(approvedManufacturers.id, id)));
    });
  }

  // ---- SPC --------------------------------------------------------------------------------

  /** Characteristics with readings, for picking a chart. */
  spcParameters(auth: AuthContext, itemId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select pa.id, pa.name, pa.kind, pa.unit, pa.lower_limit::text as "lowerLimit", pa.upper_limit::text as "upperLimit", pl.code as plan, pl.stage, i.id as "itemId", i.code as "itemCode", i.name as "itemName",
                   (select count(distinct r.inspection_id)::int from inspection_readings r where r.parameter_id = pa.id) as lots
            from inspection_parameters pa join inspection_plans pl on pl.id = pa.plan_id join items i on i.id = pl.item_id
            where exists (select 1 from inspection_readings r where r.parameter_id = pa.id) ${itemId ? sql`and pl.item_id = ${itemId}` : sql``}
            order by i.code, pl.code, pa.seq`,
      ),
    );
  }

  /**
   * Control chart for a characteristic: each inspection lot is a subgroup (its samples' readings).
   * Measured characteristics get X-bar R / S or I-MR with capability; pass / fail ones a p, np,
   * c or u chart.
   */
  spc(auth: AuthContext, q: { parameterId: string; from?: string; to?: string; chart?: 'p' | 'np' | 'c' | 'u'; limit: number }) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select().from(inspectionParameters).where(eq(inspectionParameters.id, q.parameterId));
      if (!p) throw new NotFoundException('Characteristic not found');
      const rows = await many<{ inspection_id: string; number: string | null; batch_no: string | null; doc_date: string; value: string | null; passed: boolean | null; sample_size: number }>(
        tx,
        sql`select r.inspection_id, d.number, qi.batch_no, d.doc_date::text, r.value::text, r.passed, qi.sample_size
            from inspection_readings r join quality_inspections qi on qi.id = r.inspection_id join documents d on d.id = qi.id
            where r.parameter_id = ${p.id} ${q.from ? sql`and d.doc_date >= ${q.from}::date` : sql``} ${q.to ? sql`and d.doc_date <= ${q.to}::date` : sql``}
              and r.inspection_id in (
                select x.inspection_id from (select distinct r2.inspection_id, d2.id from inspection_readings r2 join documents d2 on d2.id = r2.inspection_id where r2.parameter_id = ${p.id} order by d2.id desc limit ${sql`${q.limit}::int`}) x)
            order by d.id, r.sample_no`,
      );
      const groups = new Map<string, { label: string; date: string; values: number[]; n: number; fails: number }>();
      for (const r of rows) {
        const g = groups.get(r.inspection_id) ?? { label: r.batch_no ?? r.number ?? 'draft', date: r.doc_date, values: [], n: 0, fails: 0 };
        if (r.value !== null) g.values.push(Number(r.value));
        if (p.kind === 'attribute') {
          g.n++;
          if (r.passed === false) g.fails++;
        } else if (p.lowerLimit !== null || p.upperLimit !== null) {
          const v = Number(r.value);
          if ((p.lowerLimit !== null && v < Number(p.lowerLimit)) || (p.upperLimit !== null && v > Number(p.upperLimit))) g.fails++;
        }
        groups.set(r.inspection_id, g);
      }
      const list = [...groups.values()];
      const parameter = { id: p.id, name: p.name, kind: p.kind, unit: p.unit, lowerLimit: p.lowerLimit, upperLimit: p.upperLimit };
      if (p.kind === 'attribute') {
        const constant = new Set(list.map((g) => g.n)).size === 1;
        const kind = q.chart ?? (constant ? 'np' : 'p');
        return { parameter, type: kind, subgroups: list.length, charts: [attributeChart(kind, list.map((g) => ({ label: g.label, n: g.n, count: g.fails })))].filter(Boolean), capability: null };
      }
      const v = variablesCharts(list.map((g) => ({ label: g.label, values: g.values })), p.lowerLimit === null ? null : Number(p.lowerLimit), p.upperLimit === null ? null : Number(p.upperLimit));
      return { parameter, type: v?.type ?? null, subgroups: list.length, subgroupSize: v?.subgroupSize ?? null, charts: v?.charts ?? [], capability: v?.capability ?? null };
    });
  }
}
