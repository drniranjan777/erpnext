import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ccpRecords, complianceCertificates, foodLabels, haccpPlans, iotAlarmRules, itemAllergens, recalls, type HaccpCcp, type HaccpHazard, type Nutrition, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { ESignService } from '../gmp/esign.service';
import { excursions } from '../plant/analytics';
import { TraceabilityService } from '../quality/traceability.service';
import { ALLERGENS, allergenStatement, changeover, codexDecision, flattenTrace, nutritionPanel, recallMetrics, rollUp, significant, withinLimits } from './food-rules';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const text = (n: number) => z.string().trim().max(n).nullable().optional();
const allergen = z.enum(Object.keys(ALLERGENS) as [string, ...string[]]);
const yn = z.boolean().nullable().optional();
const r3 = z.number().int().min(1).max(3);

export const planSchema = z.object({ code: z.string().trim().min(1).max(30), title: z.string().trim().min(2).max(160), itemId: z.uuid().nullable().optional(), scope: text(1000), team: text(300), steps: z.array(z.object({ no: z.number().int().min(1).max(500), name: z.string().trim().min(1).max(120) })).max(200).default([]) });
export const analysisSchema = z.object({
  steps: z.array(z.object({ no: z.number().int().min(1).max(500), name: z.string().trim().min(1).max(120) })).max(200),
  hazards: z.array(z.object({ id: z.string().max(40).optional(), step: z.number().int(), type: z.enum(['biological', 'chemical', 'physical', 'allergen']), description: z.string().trim().min(2).max(300), severity: r3, likelihood: r3, controls: text(300), q1: yn, q2: yn, q3: yn, q4: yn })).max(500),
  ccps: z.array(z.object({ id: z.string().max(40).optional(), hazardId: z.string().min(1).max(40), name: z.string().trim().min(2).max(120), limitMin: z.number().nullable().optional(), limitMax: z.number().nullable().optional(), unit: text(20), monitoring: z.string().trim().min(2).max(300), frequency: z.string().trim().min(1).max(80), responsibility: z.string().trim().min(1).max(120), correctiveAction: z.string().trim().min(3).max(500), verification: z.string().trim().min(3).max(300), signalId: z.uuid().nullable().optional() })).max(100),
});
export const approveSchema = z.object({ password: z.string().min(1).max(200), reason: text(500) });
export const ccpRecordSchema = z.object({ ccpId: z.string().min(1).max(40), value: z.number().finite(), batchNo: text(40), correctiveAction: text(500), productHeld: z.boolean().default(false), recordedAt: z.iso.datetime({ offset: true }).optional() });
export const allergenSchema = z.object({ itemId: z.uuid(), contains: z.array(allergen).max(14).default([]), mayContain: z.array(allergen).max(14).default([]) });
export const recallSchema = z.object({ code: z.string().trim().min(1).max(30), kind: z.enum(['mock', 'real']), itemId: z.uuid(), batchNo: z.string().trim().min(1).max(40), reason: z.string().trim().min(3).max(1000), recallClass: z.enum(['I', 'II', 'III']).nullable().optional() });
export const recoverSchema = z.object({ party: z.string().trim().min(1).max(160), qty: z.number().positive(), note: text(300) });
export const closeRecallSchema = z.object({ conclusion: z.string().trim().min(3).max(2000) });
export const labelSchema = z.object({
  itemId: z.uuid(),
  vegMark: z.enum(['veg', 'non_veg']),
  ingredients: z.string().trim().min(2).max(4000),
  nutrition: z.object({ energyKcal: z.number().min(0), protein: z.number().min(0), carbohydrate: z.number().min(0), totalSugars: z.number().min(0), addedSugars: z.number().min(0), totalFat: z.number().min(0), saturatedFat: z.number().min(0), transFat: z.number().min(0), cholesterolMg: z.number().min(0).nullable().optional(), sodiumMg: z.number().min(0) }),
  servingSizeG: z.number().positive().nullable().optional(),
  netQuantity: text(40),
  storage: text(200),
  fssaiLicenceNo: z.string().trim().regex(/^\d{14}$/, 'FSSAI licence numbers have 14 digits').nullable().optional(),
});
export const certificateSchema = z.object({
  subjectType: z.enum(['party', 'item', 'company']),
  subjectId: z.uuid().nullable().optional(),
  type: z.enum(['fssc22000', 'brcgs', 'iso22000', 'fssai', 'halal', 'organic', 'gots', 'oekotex', 'bis', 'iso9001', 'iso14001', 'iatf16949', 'other']),
  number: z.string().trim().min(1).max(60),
  issuer: text(120),
  scope: text(500),
  validFrom: z.iso.date().nullable().optional(),
  validUntil: z.iso.date().nullable().optional(),
  url: text(1000),
});

/**
 * Food safety pack: HACCP plans (hazard analysis, Codex decision tree, CCPs with limits, signed
 * approval, sensor CCPs watched by IoT alarms), CCP monitoring, the allergen matrix with BOM roll-up
 * and changeover checks, recalls and mock-recall drills traced through the lot genealogy, label
 * content with %RDA, the FSSAI annual return figures, and the certificates register.
 */
@Injectable()
export class FoodService {
  constructor(
    private readonly database: DatabaseService,
    private readonly esign: ESignService,
    private readonly trace: TraceabilityService,
  ) {}

  // ---- HACCP -------------------------------------------------------------------------------------

  plans(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select p.id, p.code, p.title, p.version, p.status, p.updated_at as "updatedAt", i.name as item, jsonb_array_length(p.ccps)::int as ccps, jsonb_array_length(p.hazards)::int as hazards,
              (select count(*)::int from ccp_records r where r.plan_id = p.id and not r.ok and r.recorded_at > now() - interval '30 days') as "deviations30d"
            from haccp_plans p left join items i on i.id = p.item_id order by p.code`,
      ),
    );
  }

  createPlan(auth: AuthContext, input: z.infer<typeof planSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: haccpPlans.id }).from(haccpPlans).where(eq(haccpPlans.code, input.code));
      if (dup) throw new ConflictException(`Plan ${input.code} already exists`);
      return (await tx.insert(haccpPlans).values({ tenantId: auth.tenantId, ...input, itemId: input.itemId ?? null, scope: input.scope ?? null, team: input.team ?? null, updatedBy: auth.userId }).returning())[0];
    });
  }

  getPlan(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.planView(tx, id));
  }

  private analyse(p: { hazards: HaccpHazard[]; ccps: HaccpCcp[] }) {
    return p.hazards.map((h) => {
      const sig = significant(h);
      const decision = sig ? codexDecision(h) : { ccp: false, reason: 'Not significant: controlled by prerequisite programmes' };
      return { ...h, significant: sig, ccp: decision.ccp, reason: decision.reason, hasCcp: p.ccps.some((c) => c.hazardId === h.id) };
    });
  }

  private async planView(tx: Transaction, id: string) {
    const [p] = await tx.select().from(haccpPlans).where(eq(haccpPlans.id, id));
    if (!p) throw new NotFoundException('HACCP plan not found');
    const analysis = this.analyse(p);
    const approval = await this.esign.forRecord(tx, 'haccp_plan', id);
    const problems = [
      ...analysis.filter((h) => h.significant && h.ccp === null).map((h) => `Step ${h.step}: ${h.reason}`),
      ...analysis.filter((h) => h.ccp && !h.hasCcp).map((h) => `Step ${h.step}: "${h.description}" is a CCP but has no limits and monitoring`),
      ...p.ccps.filter((c) => c.limitMin == null && c.limitMax == null).map((c) => `${c.name}: set at least one critical limit`),
    ];
    return { ...p, analysis, problems, approval };
  }

  /** Saves the hazard analysis and CCPs; changing an approved plan starts a new version. */
  saveAnalysis(auth: AuthContext, id: string, input: z.infer<typeof analysisSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select().from(haccpPlans).where(eq(haccpPlans.id, id)).for('update');
      if (!p) throw new NotFoundException('HACCP plan not found');
      const stepNos = new Set(input.steps.map((s) => s.no));
      const bad = input.hazards.filter((h) => !stepNos.has(h.step));
      if (bad.length) throw new BadRequestException(`Hazards on unknown steps: ${bad.map((h) => h.step).join(', ')}`);
      const hazards: HaccpHazard[] = input.hazards.map((h) => ({ ...h, id: h.id ?? randomUUID(), controls: h.controls ?? null }));
      const ids = new Set(hazards.map((h) => h.id));
      const orphan = input.ccps.filter((c) => !ids.has(c.hazardId));
      if (orphan.length) throw new BadRequestException('Every CCP must belong to a hazard of the plan');
      for (const c of input.ccps) if (c.limitMin != null && c.limitMax != null && c.limitMin > c.limitMax) throw new BadRequestException(`${c.name}: the lower limit is above the upper limit`);
      const ccps: HaccpCcp[] = input.ccps.map((c) => ({ ...c, id: c.id ?? randomUUID(), limitMin: c.limitMin ?? null, limitMax: c.limitMax ?? null, unit: c.unit ?? null, signalId: c.signalId ?? null }));
      const reopen = p.status === 'approved';
      await tx
        .update(haccpPlans)
        .set({ steps: input.steps, hazards, ccps, status: 'draft', approvalSignatureId: null, version: reopen ? p.version + 1 : p.version, updatedBy: auth.userId, updatedAt: new Date() })
        .where(eq(haccpPlans.id, id));
      return this.planView(tx, id);
    });
  }

  /** Signed approval; CCPs measured by a sensor get a critical IoT alarm on their limits. */
  approve(auth: AuthContext, id: string, input: z.infer<typeof approveSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const v = await this.planView(tx, id);
      if (v.status === 'approved') throw new ConflictException('Already approved');
      if (v.problems.length) throw new ConflictException(`Not ready: ${v.problems.join('; ')}`);
      const sig = await this.esign.sign(tx, auth, { entityType: 'haccp_plan', entityId: id, meaning: `HACCP plan version ${v.version} approved`, reason: input.reason ?? null, payload: { code: v.code, version: v.version, steps: v.steps, hazards: v.hazards, ccps: v.ccps }, password: input.password, ip: meta.ip });
      await tx.update(haccpPlans).set({ status: 'approved', approvalSignatureId: sig.id }).where(eq(haccpPlans.id, id));
      for (const c of v.ccps.filter((x) => x.signalId)) {
        const name = `CCP ${v.code}: ${c.name}`;
        const [exists] = await tx.select({ id: iotAlarmRules.id }).from(iotAlarmRules).where(and(eq(iotAlarmRules.signalId, c.signalId!), eq(iotAlarmRules.name, name)));
        const values =
          c.limitMin != null && c.limitMax != null
            ? { op: 'outside', threshold: c.limitMin, threshold2: c.limitMax }
            : c.limitMin != null
              ? { op: 'below', threshold: c.limitMin, threshold2: null }
              : { op: 'above', threshold: c.limitMax!, threshold2: null };
        if (exists) await tx.update(iotAlarmRules).set({ ...values, isActive: true }).where(eq(iotAlarmRules.id, exists.id));
        else await tx.insert(iotAlarmRules).values({ tenantId: auth.tenantId, signalId: c.signalId!, name, ...values, delaySeconds: 0, severity: 'critical', notify: true });
      }
      return this.planView(tx, id);
    });
  }

  recordCcp(auth: AuthContext, id: string, input: z.infer<typeof ccpRecordSchema>) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select().from(haccpPlans).where(eq(haccpPlans.id, id));
      if (!p) throw new NotFoundException('HACCP plan not found');
      if (p.status !== 'approved') throw new ConflictException('Monitor against an approved plan');
      const c = p.ccps.find((x) => x.id === input.ccpId);
      if (!c) throw new BadRequestException('Not a CCP of this plan');
      const ok = withinLimits(input.value, c.limitMin, c.limitMax);
      if (!ok && !input.correctiveAction) throw new BadRequestException(`Outside the critical limit: record the corrective action (${c.correctiveAction})`);
      const [r] = await tx
        .insert(ccpRecords)
        .values({ tenantId: auth.tenantId, planId: id, ccpId: c.id, value: input.value, recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(), ok, batchNo: input.batchNo ?? null, correctiveAction: input.correctiveAction ?? null, productHeld: input.productHeld, recordedBy: auth.userId })
        .returning();
      return r;
    });
  }

  /** CCP records of a period, with sensor CCPs summarised from their readings. */
  monitoring(auth: AuthContext, id: string, days: number) {
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select().from(haccpPlans).where(eq(haccpPlans.id, id));
      if (!p) throw new NotFoundException('HACCP plan not found');
      const records = await many(
        tx,
        sql`select r.id, r.ccp_id as "ccpId", r.value, r.recorded_at as "recordedAt", r.method, r.ok, r.batch_no as "batchNo", r.corrective_action as "correctiveAction", r.product_held as "productHeld", u.full_name as "recordedBy"
            from ccp_records r left join users u on u.id = r.recorded_by where r.plan_id = ${id} and r.recorded_at > now() - make_interval(days => ${days}::int) order by r.recorded_at desc`,
      );
      const sensors = [];
      for (const c of p.ccps.filter((x) => x.signalId)) {
        const readings = await many<{ ts: string; value: number }>(tx, sql`select ts, value from iot_readings where signal_id = ${c.signalId} and ts > now() - make_interval(days => ${days}::int) order by ts`);
        const ex = excursions(readings.map((r) => ({ ts: Date.parse(r.ts), value: r.value })), c.limitMin ?? null, c.limitMax ?? null);
        sensors.push({ ccpId: c.id, name: c.name, readings: readings.length, min: readings.length ? Math.min(...readings.map((r) => r.value)) : null, max: readings.length ? Math.max(...readings.map((r) => r.value)) : null, minutesOutside: ex.minutesOutside, excursions: ex.excursions.length });
      }
      return { records, sensors };
    });
  }

  // ---- allergens ---------------------------------------------------------------------------------

  private async allergenData(tx: Transaction) {
    const own = await tx.select().from(itemAllergens);
    const edges = await many<{ parent: string; child: string }>(
      tx,
      sql`select distinct b.item_id as parent, l.item_id as child from boms b join documents d on d.id = b.id join bom_lines l on l.bom_id = b.id
          where d.status = 'approved' and l.kind = 'component'`,
    );
    const ownMap = new Map(own.map((a) => [a.itemId, { contains: a.contains, mayContain: a.mayContain }]));
    const children = new Map<string, string[]>();
    for (const e of edges) children.set(e.parent, [...(children.get(e.parent) ?? []), e.child]);
    return { ownMap, children };
  }

  /** The allergen matrix: every item with declared allergens or a BOM, rolled up through its components. */
  matrix(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const { ownMap, children } = await this.allergenData(tx);
      const ids = [...new Set([...ownMap.keys(), ...children.keys()])];
      if (!ids.length) return { allergens: ALLERGENS, items: [] };
      const items = await many<{ id: string; code: string; name: string; type: string }>(tx, sql`select id, code, name, type from items where id in ${ids} order by code`);
      return {
        allergens: ALLERGENS,
        items: items.map((i) => {
          const r = rollUp(i.id, ownMap, children);
          return { ...i, declared: ownMap.get(i.id) ?? { contains: [], mayContain: [] }, ...r, statement: allergenStatement(r.contains, r.mayContain) };
        }),
      };
    });
  }

  setAllergens(auth: AuthContext, input: z.infer<typeof allergenSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { contains: input.contains, mayContain: input.mayContain.filter((a) => !input.contains.includes(a)) };
      return (await tx.insert(itemAllergens).values({ tenantId: auth.tenantId, itemId: input.itemId, ...values }).onConflictDoUpdate({ target: [itemAllergens.tenantId, itemAllergens.itemId], set: values }).returning())[0];
    });
  }

  changeover(auth: AuthContext, fromItemId: string, toItemId: string) {
    return this.database.run(auth, async (tx) => {
      const { ownMap, children } = await this.allergenData(tx);
      const a = rollUp(fromItemId, ownMap, children);
      const b = rollUp(toItemId, ownMap, children);
      return { from: a.contains, to: b.contains, ...changeover(a.contains, b.contains) };
    });
  }

  // ---- recalls -----------------------------------------------------------------------------------

  /** Starts a recall or a drill and traces the lot at once (forward to customers, back to its materials). */
  async startRecall(auth: AuthContext, input: z.infer<typeof recallSchema>) {
    const startedAt = new Date();
    const forward = await this.trace.forward(auth, { itemId: input.itemId, batchNo: input.batchNo });
    const backward = await this.trace.backward(auth, { itemId: input.itemId, batchNo: input.batchNo }).catch(() => null);
    const t = flattenTrace(forward as never, backward as never);
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: recalls.id }).from(recalls).where(eq(recalls.code, input.code));
      if (dup) throw new ConflictException(`Recall ${input.code} already exists`);
      const [r] = await tx.insert(recalls).values({ tenantId: auth.tenantId, ...input, recallClass: input.recallClass ?? null, startedAt, trace: t, createdBy: auth.userId }).returning();
      return this.recallView(r);
    });
  }

  private recallView(r: typeof recalls.$inferSelect) {
    return { ...r, metrics: recallMetrics(r) };
  }

  recalls(auth: AuthContext) {
    return this.database.run(auth, async (tx) => (await tx.select().from(recalls).orderBy(desc(recalls.startedAt))).map((r) => this.recallView(r)));
  }

  getRecall(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(recalls).where(eq(recalls.id, id));
      if (!r) throw new NotFoundException('Recall not found');
      return this.recallView(r);
    });
  }

  /** Marks the trace as complete: every customer identified and contacted. */
  traceDone(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(recalls).set({ traceCompletedAt: new Date() }).where(and(eq(recalls.id, id), sql`${recalls.traceCompletedAt} is null`)).returning();
      if (!r) throw new ConflictException('Recall not found or trace already confirmed');
      return this.recallView(r);
    });
  }

  recover(auth: AuthContext, id: string, input: z.infer<typeof recoverSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(recalls).where(eq(recalls.id, id)).for('update');
      if (!r) throw new NotFoundException('Recall not found');
      if (r.status !== 'open') throw new ConflictException('The recall is closed');
      const recovered = [...r.recovered, { party: input.party, qty: input.qty, note: input.note ?? null, at: new Date().toISOString() }];
      const [u] = await tx.update(recalls).set({ recovered }).where(eq(recalls.id, id)).returning();
      return this.recallView(u);
    });
  }

  closeRecall(auth: AuthContext, id: string, input: z.infer<typeof closeRecallSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(recalls).set({ status: 'closed', closedAt: new Date(), conclusion: input.conclusion }).where(and(eq(recalls.id, id), eq(recalls.status, 'open'))).returning();
      if (!r) throw new ConflictException('Recall not found or already closed');
      return this.recallView(r);
    });
  }

  // ---- labels ------------------------------------------------------------------------------------

  saveLabel(auth: AuthContext, input: z.infer<typeof labelSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { vegMark: input.vegMark, ingredients: input.ingredients, nutrition: input.nutrition as Nutrition, servingSizeG: input.servingSizeG ?? null, netQuantity: input.netQuantity ?? null, storage: input.storage ?? null, fssaiLicenceNo: input.fssaiLicenceNo ?? null, updatedAt: new Date() };
      await tx.insert(foodLabels).values({ tenantId: auth.tenantId, itemId: input.itemId, ...values }).onConflictDoUpdate({ target: [foodLabels.tenantId, foodLabels.itemId], set: values });
      return this.labelTx(tx, input.itemId);
    });
  }

  label(auth: AuthContext, itemId: string) {
    return this.database.run(auth, (tx) => this.labelTx(tx, itemId));
  }

  private async labelTx(tx: Transaction, itemId: string) {
    const [l] = await tx.select().from(foodLabels).where(eq(foodLabels.itemId, itemId));
    if (!l) throw new NotFoundException('No label for this item');
    const [item] = await many<{ code: string; name: string }>(tx, sql`select code, name from items where id = ${itemId}`);
    const { ownMap, children } = await this.allergenData(tx);
    const a = rollUp(itemId, ownMap, children);
    return { ...l, item, allergens: a, allergenStatement: allergenStatement(a.contains, a.mayContain), panel: nutritionPanel(l.nutrition, l.servingSizeG) };
  }

  labels(auth: AuthContext) {
    return this.database.run(auth, (tx) => many(tx, sql`select l.item_id as "itemId", i.code, i.name, l.veg_mark as "vegMark", l.updated_at as "updatedAt" from food_labels l join items i on i.id = l.item_id order by i.code`));
  }

  // ---- FSSAI return ------------------------------------------------------------------------------

  /** Quantities made and sold per finished item in a period, for the FSSAI annual return. */
  fssaiReturn(auth: AuthContext, from: string, to: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select i.id as "itemId", i.code, i.name, u.code as uom,
              coalesce((select sum(l.qty) from production_entry_lines l join production_entries e on e.id = l.entry_id join documents d on d.id = e.id
                        where l.item_id = i.id and l.kind = 'output' and d.status = 'approved' and d.doc_date between ${from} and ${to}), 0)::float8 as made,
              coalesce((select sum(l.base_qty) from sales_invoice_lines l join documents d on d.id = l.invoice_id
                        where l.item_id = i.id and d.status not in ('draft', 'cancelled') and d.doc_date between ${from} and ${to}), 0)::float8 as sold
            from items i join uoms u on u.id = i.base_uom_id where i.type = 'finished_good' and i.deleted_at is null order by i.code`,
      ),
    );
  }

  // ---- certificates ------------------------------------------------------------------------------

  certificates(auth: AuthContext, q: { subjectType?: string; subjectId?: string; expiringDays?: number }) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<Record<string, unknown> & { validUntil: string | null }>(
        tx,
        sql`select c.id, c.subject_type as "subjectType", c.subject_id as "subjectId", coalesce(p.name, i.name, co.name, case when c.subject_type = 'company' then (select name from companies where deleted_at is null order by created_at limit 1) end) as subject, c.type, c.number, c.issuer, c.scope,
              c.valid_from::text as "validFrom", c.valid_until::text as "validUntil", c.url
            from compliance_certificates c left join parties p on p.id = c.subject_id and c.subject_type = 'party' left join items i on i.id = c.subject_id and c.subject_type = 'item'
            left join companies co on co.id = c.subject_id and c.subject_type = 'company'
            where true ${q.subjectType ? sql`and c.subject_type = ${q.subjectType}` : sql``} ${q.subjectId ? sql`and c.subject_id = ${q.subjectId}` : sql``}
            order by c.valid_until nulls last`,
      );
      const today = todayIST();
      const soon = new Date(Date.parse(today) + (q.expiringDays ?? 60) * 86_400_000).toISOString().slice(0, 10);
      return rows.map((r) => ({ ...r, state: !r.validUntil ? 'valid' : r.validUntil < today ? 'expired' : r.validUntil <= soon ? 'expiring' : 'valid' }));
    });
  }

  addCertificate(auth: AuthContext, input: z.infer<typeof certificateSchema>) {
    return this.database.run(auth, async (tx) => {
      if (input.subjectType !== 'company' && !input.subjectId) throw new BadRequestException('Choose whose certificate it is');
      if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) throw new BadRequestException('Valid until is before valid from');
      return (await tx.insert(complianceCertificates).values({ tenantId: auth.tenantId, ...input, subjectId: input.subjectId ?? null, issuer: input.issuer ?? null, scope: input.scope ?? null, validFrom: input.validFrom ?? null, validUntil: input.validUntil ?? null, url: input.url ?? null, createdBy: auth.userId }).returning())[0];
    });
  }
}
