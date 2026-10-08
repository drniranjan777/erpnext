import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { buyerOrders, socialAudits, styleSamples, techPacks, type Transaction } from '@nextgen/database';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { auditState, breakdownTotals, measurementCheck, MILESTONES, missingCertificates, tna } from './textile-rules';
import { many } from '../../common/sql';

const text = (n: number) => z.string().trim().max(n).nullable().optional();
const SAMPLE_TYPES = ['lab_dip', 'proto', 'fit', 'size_set', 'pp', 'top', 'shipment'] as const;

export const techPackSchema = z.object({
  styleNo: z.string().trim().min(1).max(40),
  buyerId: z.uuid().nullable().optional(),
  season: text(40),
  description: z.string().trim().min(2).max(300),
  sizes: z.array(z.string().trim().min(1).max(10)).max(20).default([]),
  colours: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  materials: z.array(z.object({ component: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200), itemId: z.uuid().nullable().optional(), consumption: z.number().min(0), unit: z.string().trim().min(1).max(10), supplier: text(120) })).max(100).default([]),
  measurements: z.array(z.object({ code: z.string().trim().min(1).max(10), description: z.string().trim().min(1).max(120), tolerance: z.number().min(0).max(20), sizes: z.record(z.string(), z.number()) })).max(100).default([]),
  construction: text(5000),
  requiredCertificates: z.array(z.enum(['gots', 'oekotex', 'organic', 'iso14001', 'other'])).max(10).default([]),
  itemId: z.uuid().nullable().optional(),
});
export const orderSchema = z.object({
  buyerId: z.uuid(),
  poNo: z.string().trim().min(1).max(40),
  techPackId: z.uuid(),
  breakdown: z.record(z.string().min(1).max(40), z.record(z.string().min(1).max(10), z.number().int().min(0))),
  price: z.number().min(0),
  currency: z.string().trim().length(3).default('USD'),
  poDate: z.iso.date(),
  exFactory: z.iso.date(),
  incoterm: text(10),
  salesOrderId: z.uuid().nullable().optional(),
});
export const milestoneSchema = z.object({ key: z.enum(MILESTONES.map((m) => m.key) as [string, ...string[]]), date: z.iso.date().nullable() });
export const sampleSchema = z.object({ techPackId: z.uuid(), type: z.enum(SAMPLE_TYPES), colour: text(40), size: text(10), sentOn: z.iso.date().nullable().optional(), courierRef: text(60), measured: z.record(z.string(), z.number()).default({}) });
export const decideSampleSchema = z.object({ status: z.enum(['approved', 'approved_with_comments', 'rejected']), buyerComments: text(2000), decidedOn: z.iso.date().optional() });
export const auditSchema = z.object({
  partyId: z.uuid().nullable().optional(),
  standard: z.enum(['BSCI', 'SMETA', 'WRAP', 'SA8000', 'Higg FEM', 'Higg FSLM', 'GOTS', 'buyer COC', 'other']),
  auditedOn: z.iso.date(),
  auditor: text(120),
  rating: text(20),
  criticalFindings: z.number().int().min(0).default(0),
  majorFindings: z.number().int().min(0).default(0),
  minorFindings: z.number().int().min(0).default(0),
  validUntil: z.iso.date().nullable().optional(),
  capDueOn: z.iso.date().nullable().optional(),
  notes: text(2000),
});

/**
 * Textile and apparel export pack: tech packs (materials, measurement specification with
 * tolerances, construction, required certificates), buyer POs with the size × colour breakdown and
 * the time-and-action calendar, samples through approval rounds with measurement checks, and
 * social / environmental compliance audits. GOTS and OEKO-TEX certificates live in the certificates
 * register (compliance_certificates).
 */
@Injectable()
export class TextileService {
  constructor(private readonly database: DatabaseService) {}

  // ---- tech packs --------------------------------------------------------------------------------

  techPacks(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.style_no as "styleNo", t.description, t.season, t.version, t.status, p.name as buyer, t.updated_at as "updatedAt",
                   (select count(*)::int from style_samples s where s.tech_pack_id = t.id and s.status = 'pending') as "pendingSamples",
                   (select count(*)::int from buyer_orders o where o.tech_pack_id = t.id and o.status = 'open') as "openOrders"
            from tech_packs t left join parties p on p.id = t.buyer_id order by t.updated_at desc`,
      ),
    );
  }

  private async packView(tx: Transaction, id: string) {
    const [t] = await tx.select().from(techPacks).where(eq(techPacks.id, id));
    if (!t) throw new NotFoundException('Tech pack not found');
    const [buyer] = t.buyerId ? await many<{ name: string }>(tx, sql`select name from parties where id = ${t.buyerId}`) : [];
    const samples = (await tx.select().from(styleSamples).where(eq(styleSamples.techPackId, id)).orderBy(styleSamples.createdAt)).map((s) => ({ ...s, check: s.size ? measurementCheck(t.measurements, s.size, s.measured) : null }));
    const orders = await many(tx, sql`select o.id, o.po_no as "poNo", p.name as buyer, o.ex_factory as "exFactory", o.status from buyer_orders o join parties p on p.id = o.buyer_id where o.tech_pack_id = ${id} order by o.ex_factory`);
    return { ...t, buyer: buyer?.name ?? null, samples, orders };
  }

  getPack(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.packView(tx, id));
  }

  /** Create or update by style number; changing an approved pack makes a new draft version. */
  savePack(auth: AuthContext, input: z.infer<typeof techPackSchema>) {
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select().from(techPacks).where(sql`${techPacks.styleNo} = ${input.styleNo}`);
      if (!t) {
        const [r] = await tx
          .insert(techPacks)
          .values({ tenantId: auth.tenantId, ...input })
          .returning({ id: techPacks.id });
        return this.packView(tx, r.id);
      }
      await tx
        .update(techPacks)
        .set({ ...input, version: t.status === 'approved' ? t.version + 1 : t.version, status: 'draft', approvedAt: null, updatedAt: new Date() })
        .where(eq(techPacks.id, t.id));
      return this.packView(tx, t.id);
    });
  }

  approvePack(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const t = await this.packView(tx, id);
      if (t.status === 'approved') throw new ConflictException('Already approved');
      if (!t.sizes.length || !t.measurements.length) throw new ConflictException('A tech pack needs its sizes and the measurement specification before approval');
      await tx.update(techPacks).set({ status: 'approved', approvedAt: new Date() }).where(eq(techPacks.id, id));
      return this.packView(tx, id);
    });
  }

  // ---- buyer orders ------------------------------------------------------------------------------

  private async orderView(tx: Transaction, id: string) {
    const [o] = await tx.select().from(buyerOrders).where(eq(buyerOrders.id, id));
    if (!o) throw new NotFoundException('Buyer order not found');
    const [t] = await tx.select().from(techPacks).where(eq(techPacks.id, o.techPackId));
    const [buyer] = await many<{ name: string }>(tx, sql`select name from parties where id = ${o.buyerId}`);
    const approved = await many<{ type: string; on: string }>(tx, sql`select type, min(decided_on)::text as on from style_samples where tech_pack_id = ${o.techPackId} and status in ('approved', 'approved_with_comments') group by type`);
    const certs = await many<{ type: string; validUntil: string | null }>(tx, sql`select type, valid_until::text as "validUntil" from compliance_certificates where subject_type = 'company' or (subject_type = 'item' and subject_id = ${t.itemId})`);
    const totals = breakdownTotals(o.breakdown);
    const plan = tna(o.poDate, o.exFactory, o.milestones, Object.fromEntries(approved.map((a) => [a.type, a.on])), todayIST());
    return {
      ...o,
      buyer: buyer?.name ?? null,
      style: { id: t.id, styleNo: t.styleNo, description: t.description, version: t.version, status: t.status },
      totals,
      value: Math.round(totals.total * o.price * 100) / 100,
      tna: plan,
      late: plan.filter((m) => m.state === 'late').length,
      missingCertificates: missingCertificates(t.requiredCertificates, certs, o.exFactory),
    };
  }

  orders(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const ids = await many<{ id: string }>(tx, sql`select id from buyer_orders where status = 'open' or ex_factory > current_date - 90 order by ex_factory`);
      const out = [];
      for (const r of ids) {
        const v = await this.orderView(tx, r.id);
        out.push({ id: v.id, poNo: v.poNo, buyer: v.buyer, styleNo: v.style.styleNo, exFactory: v.exFactory, status: v.status, qty: v.totals.total, value: v.value, currency: v.currency, late: v.late, next: v.tna.find((m) => !m.doneOn) ?? null, missingCertificates: v.missingCertificates });
      }
      return out;
    });
  }

  getOrder(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.orderView(tx, id));
  }

  createOrder(auth: AuthContext, input: z.infer<typeof orderSchema>) {
    if (input.exFactory < input.poDate) throw new ConflictException('Ex-factory cannot be before the PO date');
    return this.database.run(auth, async (tx) => {
      const [t] = await tx.select({ sizes: techPacks.sizes, colours: techPacks.colours }).from(techPacks).where(eq(techPacks.id, input.techPackId));
      if (!t) throw new NotFoundException('Tech pack not found');
      const badSize = Object.values(input.breakdown).flatMap((s) => Object.keys(s)).find((s) => t.sizes.length && !t.sizes.includes(s));
      if (badSize) throw new ConflictException(`Size ${badSize} is not in the tech pack`);
      const [r] = await tx
        .insert(buyerOrders)
        .values({ tenantId: auth.tenantId, ...input })
        .returning({ id: buyerOrders.id });
      return this.orderView(tx, r.id);
    });
  }

  milestone(auth: AuthContext, id: string, input: z.infer<typeof milestoneSchema>) {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(buyerOrders).where(eq(buyerOrders.id, id));
      if (!o) throw new NotFoundException('Buyer order not found');
      const m = { ...o.milestones };
      if (input.date) m[input.key] = input.date;
      else delete m[input.key];
      await tx
        .update(buyerOrders)
        .set({ milestones: m, status: input.key === 'ex_factory' && input.date ? 'shipped' : o.status })
        .where(eq(buyerOrders.id, id));
      return this.orderView(tx, id);
    });
  }

  // ---- samples -----------------------------------------------------------------------------------

  addSample(auth: AuthContext, input: z.infer<typeof sampleSchema>) {
    return this.database.run(auth, async (tx) => {
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int + 1 as n from style_samples where tech_pack_id = ${input.techPackId} and type = ${input.type}`);
      await tx.insert(styleSamples).values({ tenantId: auth.tenantId, ...input, round: n, createdBy: auth.userId });
      return this.packView(tx, input.techPackId);
    });
  }

  decideSample(auth: AuthContext, id: string, input: z.infer<typeof decideSampleSchema>) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(styleSamples).where(eq(styleSamples.id, id));
      if (!s) throw new NotFoundException('Sample not found');
      if (s.status !== 'pending') throw new ConflictException('The buyer already decided on this sample');
      if (input.status === 'rejected' && !input.buyerComments) throw new ConflictException('Record the buyer’s comments for a rejection');
      await tx
        .update(styleSamples)
        .set({ status: input.status, buyerComments: input.buyerComments ?? null, decidedOn: input.decidedOn ?? todayIST() })
        .where(eq(styleSamples.id, id));
      return this.packView(tx, s.techPackId);
    });
  }

  // ---- social audits -----------------------------------------------------------------------------

  audits(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; party: string | null; standard: string; auditedOn: string; auditor: string | null; rating: string | null; criticalFindings: number; majorFindings: number; minorFindings: number; validUntil: string | null; capDueOn: string | null; capStatus: string; notes: string | null }>(
        tx,
        sql`select a.id, p.name as party, a.standard, a.audited_on::text as "auditedOn", a.auditor, a.rating, a.critical_findings as "criticalFindings", a.major_findings as "majorFindings", a.minor_findings as "minorFindings",
                   a.valid_until::text as "validUntil", a.cap_due_on::text as "capDueOn", a.cap_status as "capStatus", a.notes
            from social_audits a left join parties p on p.id = a.party_id order by a.audited_on desc`,
      );
      const today = todayIST();
      return rows.map((r) => ({ ...r, ...auditState(r, today) }));
    });
  }

  addAudit(auth: AuthContext, input: z.infer<typeof auditSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(socialAudits)
        .values({ tenantId: auth.tenantId, ...input, capStatus: input.criticalFindings + input.majorFindings + input.minorFindings > 0 ? 'open' : 'closed' })
        .returning();
      return r;
    });
  }

  closeCap(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(socialAudits).set({ capStatus: 'closed' }).where(eq(socialAudits.id, id)).returning();
      if (!r) throw new NotFoundException('Audit not found');
      return r;
    });
  }
}
