import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { batchReviews, emLocations, emSamples, gmpSettings, lineClearances, type EmParameter, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DeviationsService } from '../qms/deviations.service';
import { ESignService } from './esign.service';
import { batchExceptions, EM_UNITS, emStatus, type BatchFacts } from './rules';
import { many } from '../../common/sql';

const password = z.string().min(1, 'Enter your password to sign').max(200);

const DEFAULT_CHECKLIST = [
  'Previous product, materials and intermediates removed',
  'Previous batch documents and labels removed',
  'Equipment cleaned and status label shows "clean"',
  'Waste bins emptied',
  'Correct batch documents and labels issued for this batch',
];

export const settingsSchema = z.object({ requireLineClearance: z.boolean(), lineClearanceHours: z.number().min(1).max(168).default(12), lineClearanceChecklist: z.array(z.string().trim().min(3).max(200)).max(40).default([]) });
export const clearanceSchema = z.object({
  workOrderId: z.uuid(),
  machineId: z.uuid().nullable().optional(),
  area: z.string().trim().max(120).nullable().optional(),
  previousItemId: z.uuid().nullable().optional(),
  previousBatch: z.string().trim().max(60).nullable().optional(),
  checklist: z.array(z.object({ item: z.string().trim().min(1).max(200), ok: z.boolean(), note: z.string().trim().max(300).nullable().optional() })).min(1).max(40),
  password,
});
export const verifySchema = z.object({ approved: z.boolean(), reason: z.string().trim().max(500).nullable().optional(), password });
export const commentSchema = z.object({ key: z.string().min(1).max(200), text: z.string().trim().min(2).max(1000) });
export const decideSchema = z.object({ approved: z.boolean(), reason: z.string().trim().min(3).max(1000), password });
export const locationSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(120),
  room: z.string().trim().max(80).nullable().optional(),
  grade: z.enum(['A', 'B', 'C', 'D', 'ISO5', 'ISO6', 'ISO7', 'ISO8', 'CNC']),
  parameters: z
    .array(
      z.object({
        param: z.enum(['viable_settle', 'viable_active', 'viable_contact', 'particles_0_5', 'particles_5_0', 'temperature', 'humidity', 'diff_pressure']),
        unit: z.string().trim().max(20).optional(),
        alertLimit: z.number().nullable().optional(),
        actionLimit: z.number().nullable().optional(),
        direction: z.enum(['above', 'below']).default('above'),
        signalId: z.uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
  isActive: z.boolean().default(true),
});
export const sampleSchema = z.object({
  locationId: z.uuid(),
  param: z.string().min(1).max(40),
  value: z.number().finite(),
  sampledAt: z.iso.datetime({ offset: true }).optional(),
  condition: z.enum(['in_operation', 'at_rest']).default('in_operation'),
  workOrderId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * GMP controls: line clearance signed by production and verified by QA, electronic batch record
 * review by exception ending in a signed QA decision, and environmental monitoring of classified
 * areas against EU GMP Annex 1 limits (action-limit results raise a deviation).
 */
@Injectable()
export class GmpService {
  constructor(
    private readonly database: DatabaseService,
    private readonly esign: ESignService,
    private readonly deviations: DeviationsService,
  ) {}

  // ---- settings ----------------------------------------------------------------------------------

  async settingsTx(tx: Transaction, tenantId: string) {
    const [s] = await tx.select().from(gmpSettings);
    const row = s ?? { requireLineClearance: false, lineClearanceHours: 12, lineClearanceChecklist: [] as string[] };
    return { ...row, tenantId, lineClearanceChecklist: row.lineClearanceChecklist.length ? row.lineClearanceChecklist : DEFAULT_CHECKLIST };
  }

  settings(auth: AuthContext) {
    return this.database.run(auth, (tx) => this.settingsTx(tx, auth.tenantId));
  }

  saveSettings(auth: AuthContext, input: z.infer<typeof settingsSchema>) {
    return this.database.run(auth, async (tx) => {
      await tx.insert(gmpSettings).values({ tenantId: auth.tenantId, ...input }).onConflictDoUpdate({ target: gmpSettings.tenantId, set: input });
      return this.settingsTx(tx, auth.tenantId);
    });
  }

  verifySignatures(auth: AuthContext) {
    return this.esign.verify(auth);
  }

  // ---- line clearance ----------------------------------------------------------------------------

  /** Whether a job may start: a QA-verified clearance for the work order (and machine) within the set hours. */
  async clearanceFor(tx: Transaction, tenantId: string, workOrderId: string, machineId: string | null) {
    const s = await this.settingsTx(tx, tenantId);
    if (!s.requireLineClearance) return { required: false, ok: true, detail: null as string | null };
    const [c] = await many<{ clearedAt: string }>(
      tx,
      sql`select cleared_at as "clearedAt" from line_clearances where work_order_id = ${workOrderId} and status = 'cleared'
          and (machine_id is null or ${machineId}::uuid is null or machine_id = ${machineId}::uuid) and cleared_at > now() - make_interval(hours => ${Math.round(s.lineClearanceHours)}::int)
          order by cleared_at desc limit 1`,
    );
    return { required: true, ok: !!c, detail: c ? null : `No line clearance verified by QA in the last ${s.lineClearanceHours} h` };
  }

  clearances(auth: AuthContext, workOrderId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.work_order_id as "workOrderId", d.number as "workOrderNumber", i.name as "itemName", m.code as "machineCode", c.area, pi.name as "previousItem", c.previous_batch as "previousBatch",
              c.checklist, c.status, c.created_at as "createdAt", c.cleared_at as "clearedAt",
              ps.signer_name as "productionBy", ps.signed_at as "productionAt", qs.signer_name as "qaBy", qs.signed_at as "qaAt", qs.reason as "qaReason"
            from line_clearances c join work_orders wo on wo.id = c.work_order_id join documents d on d.id = wo.id join items i on i.id = wo.item_id
            left join machines m on m.id = c.machine_id left join items pi on pi.id = c.previous_item_id
            left join e_signatures ps on ps.id = c.production_signature_id left join e_signatures qs on qs.id = c.qa_signature_id
            ${workOrderId ? sql`where c.work_order_id = ${workOrderId}` : sql``} order by c.created_at desc limit 200`,
      ),
    );
  }

  /** Production records the checklist and signs; every item must be ticked. */
  createClearance(auth: AuthContext, input: z.infer<typeof clearanceSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const open = input.checklist.filter((c) => !c.ok);
      if (open.length) throw new BadRequestException(`Not cleared: ${open.map((c) => c.item).join('; ')}`);
      const [c] = await tx
        .insert(lineClearances)
        .values({ tenantId: auth.tenantId, workOrderId: input.workOrderId, machineId: input.machineId ?? null, area: input.area ?? null, previousItemId: input.previousItemId ?? null, previousBatch: input.previousBatch ?? null, checklist: input.checklist.map((x) => ({ item: x.item, ok: x.ok, note: x.note ?? null })) })
        .returning();
      const sig = await this.esign.sign(tx, auth, { entityType: 'line_clearance', entityId: c.id, meaning: 'Line clearance done', payload: { workOrderId: c.workOrderId, machineId: c.machineId, area: c.area, previousBatch: c.previousBatch, checklist: c.checklist }, password: input.password, ip: meta.ip });
      await tx.update(lineClearances).set({ productionSignatureId: sig.id }).where(eq(lineClearances.id, c.id));
      return { ...c, productionSignature: sig };
    });
  }

  /** QA verifies (or fails) the clearance with a second signature by a different person. */
  verifyClearance(auth: AuthContext, id: string, input: z.infer<typeof verifySchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(lineClearances).where(eq(lineClearances.id, id)).for('update');
      if (!c) throw new NotFoundException('Line clearance not found');
      if (c.status !== 'pending') throw new ConflictException('This line clearance has already been verified');
      const [p] = await many<{ userId: string }>(tx, sql`select user_id as "userId" from e_signatures where id = ${c.productionSignatureId}`);
      if (p?.userId === auth.userId) throw new ConflictException('QA verification must be signed by someone other than the person who did the clearance');
      if (!input.approved && !input.reason) throw new BadRequestException('Say why the clearance failed');
      const sig = await this.esign.sign(tx, auth, { entityType: 'line_clearance', entityId: c.id, meaning: input.approved ? 'Line clearance verified (QA)' : 'Line clearance failed (QA)', reason: input.reason ?? null, payload: { clearanceId: c.id, checklist: c.checklist, approved: input.approved }, password: input.password, ip: meta.ip });
      const [r] = await tx
        .update(lineClearances)
        .set({ status: input.approved ? 'cleared' : 'failed', qaSignatureId: sig.id, clearedAt: input.approved ? new Date() : null })
        .where(eq(lineClearances.id, id))
        .returning();
      return { ...r, qaSignature: sig };
    });
  }

  // ---- batch record review ------------------------------------------------------------------------

  private async facts(tx: Transaction, tenantId: string, workOrderId: string): Promise<BatchFacts> {
    const execs = await many<{ id: string; operation: string; checks: BatchFacts['executions'][number]['checks']; firstOff: string; inlineFailed: number; recipeDownload: string | null; recipeId: string | null; machineId: string | null; startedAt: string; endedAt: string | null }>(
      tx,
      sql`select e.id, op.name as operation, e.checks, e.first_off as "firstOff",
            (select count(*)::int from mes_inline_checks c where c.execution_id = e.id and not c.all_ok) as "inlineFailed",
            ic.status as "recipeDownload", e.recipe_id as "recipeId", e.machine_id as "machineId", jc.started_at as "startedAt", jc.ended_at as "endedAt"
          from mes_executions e join job_cards jc on jc.id = e.job_card_id join work_order_operations op on op.id = jc.operation_id left join iot_commands ic on ic.id = e.command_id
          where jc.work_order_id = ${workOrderId} order by jc.started_at`,
    );
    const executions: BatchFacts['executions'] = [];
    for (const e of execs) {
      const recipeOut: string[] = [];
      if (e.recipeId) {
        const params = await many<{ name: string; min: number | null; max: number | null; signalCode: string | null }>(
          tx,
          sql`select p->>'name' as name, (p->>'min')::float8 as min, (p->>'max')::float8 as max, p->>'signalCode' as "signalCode" from mes_recipes r, jsonb_array_elements(r.parameters) p where r.id = ${e.recipeId}`,
        );
        for (const p of params.filter((x) => x.signalCode && (x.min !== null || x.max !== null))) {
          const [m] = await many<{ min: number | null; max: number | null }>(
            tx,
            sql`select min(r.value) as min, max(r.value) as max from iot_readings r join iot_signals s on s.id = r.signal_id
                where lower(s.code) = lower(${p.signalCode}) and r.ts >= ${e.startedAt} and r.ts <= coalesce(${e.endedAt}::timestamptz, now())`,
          );
          if (m && m.min !== null && ((p.min !== null && m.min < p.min) || (p.max !== null && (m.max ?? 0) > p.max))) recipeOut.push(p.name);
        }
      }
      executions.push({ id: e.id, operation: e.operation, checks: e.checks, firstOff: e.firstOff, inlineFailed: e.inlineFailed, recipeOut, recipeDownload: e.recipeDownload });
    }
    const jobRejects = await many<{ operation: string; qty: number; reason: string | null }>(
      tx,
      sql`select op.name as operation, sum(jc.reject_qty)::float8 as qty, string_agg(distinct jc.reject_reason, '; ') as reason from job_cards jc join work_order_operations op on op.id = jc.operation_id
          where jc.work_order_id = ${workOrderId} group by op.name, op.seq order by op.seq`,
    );
    const alarms = await many<{ id: string; message: string; severity: string; machine: string }>(
      tx,
      sql`select distinct a.id, a.message, a.severity, m.code as machine from iot_alarms a join machines m on m.id = a.machine_id
          join job_cards jc on jc.machine_id = a.machine_id and jc.work_order_id = ${workOrderId}
          where a.raised_at between jc.started_at and coalesce(jc.ended_at, now())`,
    );
    const deviations = await many<{ id: string; number: string | null; closed: boolean; kind: string }>(
      tx,
      sql`select d.id, doc.number, (d.closed_at is not null) as closed, d.kind from deviations d join documents doc on doc.id = d.id where d.work_order_id = ${workOrderId} and doc.status not in ('cancelled', 'rejected')`,
    );
    const inspections = await many<{ id: string; number: string | null; status: string; result: string | null }>(
      tx,
      sql`select q.id, doc.number, doc.status, q.result from quality_inspections q join documents doc on doc.id = q.id where q.work_order_id = ${workOrderId} and doc.status not in ('cancelled')`,
    );
    const [wo] = await many<{ startedAt: string | null }>(tx, sql`select min(started_at) as "startedAt" from job_cards where work_order_id = ${workOrderId}`);
    const [cl] = wo?.startedAt
      ? await many<{ n: number }>(
          tx,
          sql`select count(*)::int as n from machine_cleanings mc where mc.verified_by is null and mc.machine_id in (select machine_id from job_cards where work_order_id = ${workOrderId})
              and mc.cleaned_at between ${wo.startedAt}::timestamptz - interval '1 day' and ${wo.startedAt}::timestamptz`,
        )
      : [{ n: 0 }];
    const s = await this.settingsTx(tx, tenantId);
    const [clr] = await many<{ n: number }>(tx, sql`select count(*)::int as n from line_clearances where work_order_id = ${workOrderId} and status = 'cleared'`);
    return { executions, jobRejects, alarms, deviations, clearance: { required: s.requireLineClearance, cleared: clr.n > 0 }, inspections, cleaningsUnverified: cl.n };
  }

  /** Opens (or refreshes) the review of a batch: the exceptions found in its records. */
  openReview(auth: AuthContext, workOrderId: string) {
    return this.database.run(auth, async (tx) => {
      const [wo] = await many<{ id: string }>(tx, sql`select id from work_orders where id = ${workOrderId}`);
      if (!wo) throw new NotFoundException('Work order not found');
      const exceptions = batchExceptions(await this.facts(tx, auth.tenantId, workOrderId));
      const [cur] = await tx.select().from(batchReviews).where(eq(batchReviews.workOrderId, workOrderId));
      if (cur && cur.status !== 'open') return this.reviewView(tx, cur.id);
      if (cur) await tx.update(batchReviews).set({ exceptions, refreshedAt: new Date() }).where(eq(batchReviews.id, cur.id));
      const id = cur?.id ?? (await tx.insert(batchReviews).values({ tenantId: auth.tenantId, workOrderId, exceptions, createdBy: auth.userId }).returning({ id: batchReviews.id }))[0].id;
      return this.reviewView(tx, id);
    });
  }

  reviews(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.work_order_id as "workOrderId", d.number as "workOrderNumber", i.code as "itemCode", i.name as "itemName", wo.batch_no as "batchNo", r.status,
              jsonb_array_length(r.exceptions)::int as exceptions, (select count(*)::int from jsonb_object_keys(r.comments)) as commented,
              r.created_at as "createdAt", r.decided_at as "decidedAt", s.signer_name as "decidedBy"
            from batch_reviews r join work_orders wo on wo.id = r.work_order_id join documents d on d.id = wo.id join items i on i.id = wo.item_id
            left join e_signatures s on s.id = r.signature_id ${status ? sql`where r.status = ${status}` : sql``} order by r.created_at desc limit 200`,
      ),
    );
  }

  private async reviewView(tx: Transaction, id: string) {
    const [r] = await many<Record<string, unknown> & { exceptions: { key: string }[]; comments: Record<string, unknown> }>(
      tx,
      sql`select r.*, d.number as "workOrderNumber", i.code as "itemCode", i.name as "itemName", wo.batch_no as "batchNo", wo.qty, wo.stage
          from batch_reviews r join work_orders wo on wo.id = r.work_order_id join documents d on d.id = wo.id join items i on i.id = wo.item_id where r.id = ${id}`,
    );
    if (!r) throw new NotFoundException('Review not found');
    const signatures = await this.esign.forRecord(tx, 'batch_review', id);
    const pending = r.exceptions.filter((e) => !(e.key in r.comments)).length;
    return {
      id: r.id,
      workOrderId: r.work_order_id,
      workOrderNumber: r.workOrderNumber,
      item: `${r.itemCode} · ${r.itemName}`,
      batchNo: r.batchNo,
      qty: Number(r.qty),
      stage: r.stage,
      status: r.status,
      exceptions: r.exceptions,
      comments: r.comments,
      pendingComments: pending,
      refreshedAt: r.refreshed_at,
      signatures,
    };
  }

  getReview(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.reviewView(tx, id));
  }

  comment(auth: AuthContext, id: string, input: z.infer<typeof commentSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(batchReviews).where(eq(batchReviews.id, id)).for('update');
      if (!r) throw new NotFoundException('Review not found');
      if (r.status !== 'open') throw new ConflictException('The review is closed');
      if (!r.exceptions.some((e) => e.key === input.key)) throw new BadRequestException('Not an exception of this batch');
      const [u] = await many<{ name: string }>(tx, sql`select full_name as name from users where id = ${auth.userId}`);
      await tx.update(batchReviews).set({ comments: { ...r.comments, [input.key]: { text: input.text, by: u.name, at: new Date().toISOString() } } }).where(eq(batchReviews.id, id));
      return this.reviewView(tx, id);
    });
  }

  /** The signed QA decision. Every exception must have been assessed (commented) first. */
  decide(auth: AuthContext, id: string, input: z.infer<typeof decideSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(batchReviews).where(eq(batchReviews.id, id)).for('update');
      if (!r) throw new NotFoundException('Review not found');
      if (r.status !== 'open') throw new ConflictException('The review is already decided');
      const fresh = batchExceptions(await this.facts(tx, auth.tenantId, r.workOrderId));
      const unassessed = fresh.filter((e) => !(e.key in r.comments));
      if (unassessed.length) {
        await tx.update(batchReviews).set({ exceptions: fresh, refreshedAt: new Date() }).where(eq(batchReviews.id, id));
        throw new ConflictException(`Assess every exception first (${unassessed.length} without a comment)`);
      }
      const sig = await this.esign.sign(tx, auth, {
        entityType: 'batch_review',
        entityId: id,
        meaning: input.approved ? 'Batch record reviewed: approved for release' : 'Batch record reviewed: rejected',
        reason: input.reason,
        payload: { workOrderId: r.workOrderId, exceptions: fresh, comments: r.comments, approved: input.approved },
        password: input.password,
        ip: meta.ip,
      });
      await tx.update(batchReviews).set({ status: input.approved ? 'approved' : 'rejected', exceptions: fresh, signatureId: sig.id, decidedAt: new Date() }).where(eq(batchReviews.id, id));
      return this.reviewView(tx, id);
    });
  }

  // ---- environmental monitoring -------------------------------------------------------------------

  locations(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select l.id, l.code, l.name, l.room, l.grade, l.parameters, l.is_active as "isActive",
              (select json_agg(x) from (select distinct on (s.param) s.param, s.value, s.status, s.sampled_at as "sampledAt" from em_samples s where s.location_id = l.id order by s.param, s.sampled_at desc) x) as latest,
              (select count(*)::int from em_samples s where s.location_id = l.id and s.status <> 'ok' and s.sampled_at > now() - interval '30 days') as excursions
            from em_locations l order by l.code`,
      ),
    );
  }

  saveLocation(auth: AuthContext, id: string | null, input: z.infer<typeof locationSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: emLocations.id }).from(emLocations).where(eq(emLocations.code, input.code));
      if (dup && dup.id !== id) throw new ConflictException(`Location ${input.code} already exists`);
      const parameters: EmParameter[] = input.parameters.map((p) => ({ ...p, unit: p.unit || EM_UNITS[p.param] || '', alertLimit: p.alertLimit ?? null, actionLimit: p.actionLimit ?? null, signalId: p.signalId ?? null }));
      const values = { code: input.code, name: input.name, room: input.room ?? null, grade: input.grade, parameters, isActive: input.isActive };
      if (id) {
        const [l] = await tx.update(emLocations).set(values).where(eq(emLocations.id, id)).returning();
        if (!l) throw new NotFoundException('Location not found');
        return l;
      }
      return (await tx.insert(emLocations).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  /** Records a result; at the action limit a deviation is raised automatically. */
  async recordSample(auth: AuthContext, input: z.infer<typeof sampleSchema>, meta: RequestMeta) {
    const saved = await this.database.run(auth, async (tx) => {
      const [l] = await tx.select().from(emLocations).where(eq(emLocations.id, input.locationId));
      if (!l) throw new NotFoundException('Location not found');
      const p = l.parameters.find((x) => x.param === input.param);
      if (!p) throw new BadRequestException(`${l.code} does not monitor ${input.param}`);
      const status = emStatus(p, l.grade, input.value, input.condition);
      const [s] = await tx
        .insert(emSamples)
        .values({ tenantId: auth.tenantId, locationId: l.id, param: input.param, value: input.value, sampledAt: input.sampledAt ? new Date(input.sampledAt) : new Date(), method: 'manual', status, condition: input.condition, workOrderId: input.workOrderId ?? null, notes: input.notes ?? null, sampledBy: auth.userId })
        .returning();
      return { s, l, p };
    });
    if (saved.s.status === 'action') {
      const dev = await this.deviations.create(
        auth,
        {
          kind: 'unplanned',
          category: 'environment',
          description: `Environmental monitoring action limit exceeded at ${saved.l.code} ${saved.l.name} (grade ${saved.l.grade}): ${saved.p.param.replace('_', ' ')} ${saved.s.value} ${saved.p.unit}.`,
          itemId: null,
          batchNo: null,
          workOrderId: saved.s.workOrderId,
          impact: null,
          severity: saved.l.grade === 'A' || saved.l.grade === 'B' ? 4 : 3,
          occurrence: 2,
          detection: 2,
          productImpact: false,
          proposedAction: 'Investigate the excursion, resample, and assess batches made in the area.',
          validUntil: null,
        } as never,
        meta,
      );
      await this.database.run(auth, (tx) => tx.update(emSamples).set({ deviationId: dev.id }).where(eq(emSamples.id, saved.s.id)));
      return { ...saved.s, deviationId: dev.id };
    }
    return saved.s;
  }

  samples(auth: AuthContext, q: { locationId?: string; status?: string; days: number }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.param, s.value, s.sampled_at as "sampledAt", s.method, s.status, s.condition, s.notes, s.deviation_id as "deviationId", dd.number as "deviationNumber",
              l.code as "locationCode", l.name as "locationName", l.grade, u.full_name as "sampledBy", d.number as "workOrderNumber"
            from em_samples s join em_locations l on l.id = s.location_id left join users u on u.id = s.sampled_by left join documents d on d.id = s.work_order_id
            left join documents dd on dd.id = s.deviation_id
            where s.sampled_at > now() - make_interval(days => ${q.days}::int) ${q.locationId ? sql`and s.location_id = ${q.locationId}` : sql``} ${q.status ? sql`and s.status = ${q.status}` : sql``}
            order by s.sampled_at desc limit 500`,
      ),
    );
  }

  /** Trend of a location's parameter, for the EM report. */
  trend(auth: AuthContext, locationId: string, param: string, days: number) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({ value: emSamples.value, sampledAt: emSamples.sampledAt, status: emSamples.status })
        .from(emSamples)
        .where(and(eq(emSamples.locationId, locationId), eq(emSamples.param, param), sql`${emSamples.sampledAt} > now() - make_interval(days => ${days}::int)`))
        .orderBy(desc(emSamples.sampledAt));
      const n = rows.length;
      return { n, alerts: rows.filter((r) => r.status === 'alert').length, actions: rows.filter((r) => r.status === 'action').length, max: n ? Math.max(...rows.map((r) => r.value)) : null, rows };
    });
  }
}
