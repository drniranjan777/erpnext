import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { apqpProjects, controlPlans, csrRequirements, ediMessages, ediPartners, fmeas, lpaAudits, lpaChecklists, ppapSubmissions, type ControlPlanRow, type FmeaRow, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { SchedulesService } from '../crm/schedules.service';
import { ESignService } from '../gmp/esign.service';
import { actionPriority, apqpProgress, apqpTemplate, buildDesadv, buildInvoic, lpaScore, ppapElements, ppapOpen, readSchedule } from './auto-rules';
import { many } from '../../common/sql';

const code = z.string().trim().min(1).max(30);
const text = (n: number) => z.string().trim().max(n).nullable().optional();
const r10 = z.number().int().min(1).max(10);
const password = z.string().min(1).max(200);

export const apqpSchema = z.object({ code, name: z.string().trim().min(2).max(160), customerId: z.uuid().nullable().optional(), itemId: z.uuid().nullable().optional(), customerPartNo: text(60), program: text(80), sopDate: z.iso.date().nullable().optional() });
export const deliverableSchema = z.object({ code: z.string().min(1).max(20), status: z.enum(['open', 'in_progress', 'done', 'na']), owner: text(80), due: z.iso.date().nullable().optional(), notes: text(1000) });
export const gateSchema = z.object({ phase: z.number().int().min(1).max(5), reason: text(500), password });
export const ppapSchema = z.object({ code, itemId: z.uuid(), customerId: z.uuid().nullable().optional(), apqpProjectId: z.uuid().nullable().optional(), customerPartNo: text(60), drawingRev: text(20), level: z.number().int().min(1).max(5).default(3), reason: z.enum(['initial', 'engineering_change', 'tooling', 'correction', 'other']).default('initial') });
export const elementSchema = z.object({ no: z.number().int().min(1).max(18), status: z.enum(['not_started', 'in_progress', 'complete', 'na']), reference: text(300), notes: text(1000), requirement: z.enum(['S', 'R', '*']).optional() });
export const pswSchema = z.object({ declaration: z.string().trim().min(10).max(1000), password });
export const decisionSchema = z.object({ decision: z.enum(['approved', 'interim', 'rejected']), comments: text(2000) });
const fmeaRow = z.object({
  id: z.string().max(40).optional(),
  step: z.string().trim().min(1).max(200),
  failureMode: z.string().trim().min(1).max(300),
  effect: z.string().trim().min(1).max(300),
  severity: r10,
  special: z.enum(['CC', 'SC']).nullable().optional(),
  cause: z.string().trim().min(1).max(300),
  prevention: text(300),
  occurrence: r10,
  detectionControl: text(300),
  detection: r10,
  action: text(300),
  owner: text(80),
  due: z.iso.date().nullable().optional(),
  done: z.boolean().optional(),
  newSeverity: r10.nullable().optional(),
  newOccurrence: r10.nullable().optional(),
  newDetection: r10.nullable().optional(),
});
export const fmeaSchema = z.object({ code, kind: z.enum(['design', 'process']), title: z.string().trim().min(2).max(160), itemId: z.uuid().nullable().optional(), team: text(300), rows: z.array(fmeaRow).max(500).default([]) });
const cpRow = z.object({ step: z.string().trim().min(1).max(200), machine: text(80), characteristic: z.string().trim().min(1).max(200), type: z.enum(['product', 'process']), special: z.enum(['CC', 'SC']).nullable().optional(), specification: z.string().trim().max(200), technique: z.string().trim().max(200), sampleSize: z.string().trim().max(40), frequency: z.string().trim().max(80), method: z.string().trim().max(200), reaction: z.string().trim().max(300) });
export const controlPlanSchema = z.object({ code, itemId: z.uuid(), fmeaId: z.uuid().nullable().optional(), phase: z.enum(['prototype', 'pre_launch', 'production']), rows: z.array(cpRow).max(500).default([]) });
export const checklistSchema = z.object({ area: z.string().trim().min(2).max(120), questions: z.array(z.string().trim().min(3).max(300)).min(1).max(60) });
export const lpaAuditSchema = z.object({ checklistId: z.uuid(), layer: z.number().int().min(1).max(3), auditedOn: z.iso.date().optional(), answers: z.array(z.object({ question: z.string().min(1).max(300), answer: z.enum(['yes', 'no', 'na']), note: text(500), fixedOnSpot: z.boolean().optional() })).min(1).max(60) });
export const csrSchema = z.object({ customerId: z.uuid(), reference: text(120), requirement: z.string().trim().min(3).max(2000), clause: text(40), howMet: text(2000), status: z.enum(['open', 'met', 'not_applicable']).default('open'), reviewedOn: z.iso.date().nullable().optional() });
export const partnerSchema = z.object({ partyId: z.uuid(), ourId: z.string().trim().min(2).max(35), theirId: z.string().trim().min(2).max(35), partMap: z.record(z.string().trim().min(1).max(40), z.uuid()).default({}) });
export const ediInSchema = z.object({ raw: z.string().min(10).max(500_000) });

/**
 * Automotive (IATF 16949) pack: APQP projects with phase gates, PPAP submissions (18 elements by
 * level, PSW, customer decision), AIAG-VDA FMEAs with action priority, control plans (also drawn
 * from the PFMEA), layered process audits, customer-specific requirements, and EDIFACT with OEMs.
 */
@Injectable()
export class AutoService {
  constructor(
    private readonly database: DatabaseService,
    private readonly esign: ESignService,
    private readonly schedules: SchedulesService,
  ) {}

  // ---- APQP --------------------------------------------------------------------------------------

  apqpList(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; code: string; name: string; customer: string | null; item: string | null; sopDate: string | null; status: string; deliverables: { phase: number; status: string; code: string; name: string }[]; gates: Record<string, string> }>(
        tx,
        sql`select a.id, a.code, a.name, p.name as customer, i.name as item, a.sop_date::text as "sopDate", a.status, a.deliverables, a.gates
            from apqp_projects a left join parties p on p.id = a.customer_id left join items i on i.id = a.item_id order by a.created_at desc`,
      );
      return rows.map((r) => ({ ...r, progress: apqpProgress(r.deliverables as never), gatesPassed: Object.keys(r.gates).length, deliverables: undefined }));
    });
  }

  createApqp(auth: AuthContext, input: z.infer<typeof apqpSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: apqpProjects.id }).from(apqpProjects).where(eq(apqpProjects.code, input.code));
      if (dup) throw new ConflictException(`Project ${input.code} already exists`);
      return (await tx.insert(apqpProjects).values({ tenantId: auth.tenantId, ...input, customerId: input.customerId ?? null, itemId: input.itemId ?? null, customerPartNo: input.customerPartNo ?? null, program: input.program ?? null, sopDate: input.sopDate ?? null, deliverables: apqpTemplate(), createdBy: auth.userId }).returning())[0];
    });
  }

  getApqp(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.apqpView(tx, id));
  }

  private async apqpView(tx: Transaction, id: string) {
    const [a] = await tx.select().from(apqpProjects).where(eq(apqpProjects.id, id));
    if (!a) throw new NotFoundException('APQP project not found');
    const gates = await this.esign.forRecord(tx, 'apqp_gate', id);
    const ppaps = await many(tx, sql`select id, code, level, status from ppap_submissions where apqp_project_id = ${id}`);
    return { ...a, progress: apqpProgress(a.deliverables), gateSignatures: gates, ppaps };
  }

  updateDeliverable(auth: AuthContext, id: string, input: z.infer<typeof deliverableSchema>) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(apqpProjects).where(eq(apqpProjects.id, id)).for('update');
      if (!a) throw new NotFoundException('APQP project not found');
      const d = a.deliverables.find((x) => x.code === input.code);
      if (!d) throw new BadRequestException('Not a deliverable of this project');
      if (a.gates[String(d.phase)]) throw new ConflictException(`Phase ${d.phase} has passed its gate`);
      const deliverables = a.deliverables.map((x) => (x.code === input.code ? { ...x, status: input.status, owner: input.owner ?? x.owner ?? null, due: input.due ?? x.due ?? null, notes: input.notes ?? x.notes ?? null } : x));
      await tx.update(apqpProjects).set({ deliverables }).where(eq(apqpProjects.id, id));
      return this.apqpView(tx, id);
    });
  }

  /** Signs a phase gate once every deliverable of the phase is done or not applicable, in order. */
  gate(auth: AuthContext, id: string, input: z.infer<typeof gateSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(apqpProjects).where(eq(apqpProjects.id, id)).for('update');
      if (!a) throw new NotFoundException('APQP project not found');
      if (a.gates[String(input.phase)]) throw new ConflictException(`Phase ${input.phase} has already passed its gate`);
      if (input.phase > 1 && !a.gates[String(input.phase - 1)]) throw new ConflictException(`Pass the gate of phase ${input.phase - 1} first`);
      const p = apqpProgress(a.deliverables)[input.phase - 1];
      if (!p.ready) throw new ConflictException(`Phase ${input.phase} has ${p.total - p.done} deliverable(s) open`);
      const sig = await this.esign.sign(tx, auth, { entityType: 'apqp_gate', entityId: id, meaning: `APQP phase ${input.phase} gate passed`, reason: input.reason ?? null, payload: { phase: input.phase, deliverables: a.deliverables.filter((d) => d.phase === input.phase) }, password: input.password, ip: meta.ip });
      const gates = { ...a.gates, [String(input.phase)]: sig.id };
      await tx.update(apqpProjects).set({ gates, status: input.phase === 5 ? 'completed' : a.status }).where(eq(apqpProjects.id, id));
      return this.apqpView(tx, id);
    });
  }

  // ---- PPAP --------------------------------------------------------------------------------------

  ppapList(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.code, i.code as "itemCode", i.name as "itemName", p.name as customer, s.level, s.reason, s.status, s.submitted_at as "submittedAt",
              (select count(*)::int from jsonb_array_elements(s.elements) e where e->>'status' in ('complete', 'na')) as complete
            from ppap_submissions s join items i on i.id = s.item_id left join parties p on p.id = s.customer_id order by s.created_at desc`,
      ),
    );
  }

  createPpap(auth: AuthContext, input: z.infer<typeof ppapSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: ppapSubmissions.id }).from(ppapSubmissions).where(eq(ppapSubmissions.code, input.code));
      if (dup) throw new ConflictException(`PPAP ${input.code} already exists`);
      return (await tx.insert(ppapSubmissions).values({ tenantId: auth.tenantId, ...input, customerId: input.customerId ?? null, apqpProjectId: input.apqpProjectId ?? null, customerPartNo: input.customerPartNo ?? null, drawingRev: input.drawingRev ?? null, elements: ppapElements(input.level), createdBy: auth.userId }).returning())[0];
    });
  }

  getPpap(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.ppapView(tx, id));
  }

  private async ppapView(tx: Transaction, id: string) {
    const [s] = await many<Record<string, unknown> & { itemId: string; elements: never }>(
      tx,
      sql`select s.*, s.item_id as "itemId", i.code as "itemCode", i.name as "itemName", p.name as customer from ppap_submissions s join items i on i.id = s.item_id left join parties p on p.id = s.customer_id where s.id = ${id}`,
    );
    if (!s) throw new NotFoundException('PPAP not found');
    // Records in the system that can serve as evidence for the elements.
    const evidence = {
      fmeas: await many(tx, sql`select id, code, kind, title, revision from fmeas where item_id = ${s.itemId}`),
      controlPlans: await many(tx, sql`select id, code, phase, revision from control_plans where item_id = ${s.itemId}`),
      inspections: await many(tx, sql`select q.id, d.number, q.result from quality_inspections q join documents d on d.id = q.id where q.item_id = ${s.itemId} order by d.doc_date desc limit 10`),
      drawings: await many(tx, sql`select id, drawing_no as "drawingNo", revision from drawings where item_id = ${s.itemId}`),
    };
    const psw = await this.esign.forRecord(tx, 'ppap', id);
    return { ...s, open: ppapOpen(s.elements as never), evidence, psw };
  }

  updateElement(auth: AuthContext, id: string, input: z.infer<typeof elementSchema>) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(ppapSubmissions).where(eq(ppapSubmissions.id, id)).for('update');
      if (!s) throw new NotFoundException('PPAP not found');
      if (s.status !== 'draft' && s.status !== 'rejected') throw new ConflictException('The PPAP has been submitted');
      if (input.no === 18) throw new BadRequestException('The PSW is completed by signing it');
      if (input.requirement && s.level !== 4) throw new BadRequestException('Only level 4 lets the customer set each requirement');
      const elements = s.elements.map((e) => (e.no === input.no ? { ...e, status: input.status, reference: input.reference ?? e.reference ?? null, notes: input.notes ?? e.notes ?? null, requirement: input.requirement ?? e.requirement } : e));
      await tx.update(ppapSubmissions).set({ elements }).where(eq(ppapSubmissions.id, id));
      return this.ppapView(tx, id);
    });
  }

  /** The supplier signs the PSW; every element to be submitted must be complete. */
  submit(auth: AuthContext, id: string, input: z.infer<typeof pswSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(ppapSubmissions).where(eq(ppapSubmissions.id, id)).for('update');
      if (!s) throw new NotFoundException('PPAP not found');
      if (s.status !== 'draft' && s.status !== 'rejected') throw new ConflictException('Already submitted');
      const open = ppapOpen(s.elements);
      if (open.length) throw new ConflictException(`Complete first: ${open.map((e) => `${e.no} ${e.name}`).join('; ')}`);
      const sig = await this.esign.sign(tx, auth, { entityType: 'ppap', entityId: id, meaning: 'Part submission warrant signed', reason: input.declaration, payload: { code: s.code, itemId: s.itemId, level: s.level, reason: s.reason, elements: s.elements }, password: input.password, ip: meta.ip });
      const elements = s.elements.map((e) => (e.no === 18 ? { ...e, status: 'complete', reference: `Signed ${new Date().toISOString().slice(0, 10)}` } : e));
      await tx.update(ppapSubmissions).set({ elements, status: 'submitted', pswSignatureId: sig.id, submittedAt: new Date() }).where(eq(ppapSubmissions.id, id));
      return this.ppapView(tx, id);
    });
  }

  decide(auth: AuthContext, id: string, input: z.infer<typeof decisionSchema>) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.update(ppapSubmissions).set({ status: input.decision, customerComments: input.comments ?? null, customerDecisionAt: new Date() }).where(and(eq(ppapSubmissions.id, id), eq(ppapSubmissions.status, 'submitted'))).returning({ id: ppapSubmissions.id });
      if (!s) throw new ConflictException('Only a submitted PPAP can get a customer decision');
      return this.ppapView(tx, id);
    });
  }

  // ---- FMEA and control plans ---------------------------------------------------------------------

  private fmeaRows(rows: z.infer<typeof fmeaRow>[]): FmeaRow[] {
    return rows.map((r) => ({ ...r, id: r.id ?? randomUUID(), special: r.special ?? null, done: r.done ?? false }));
  }

  private withAp(f: typeof fmeas.$inferSelect) {
    const rows = f.rows.map((r) => ({
      ...r,
      ap: actionPriority(r.severity, r.occurrence, r.detection),
      newAp: r.newSeverity && r.newOccurrence && r.newDetection ? actionPriority(r.newSeverity, r.newOccurrence, r.newDetection) : null,
    }));
    const count = (ap: string) => rows.filter((r) => (r.newAp ?? r.ap) === ap).length;
    return { ...f, rows, summary: { high: count('H'), medium: count('M'), low: count('L'), highWithoutAction: rows.filter((r) => r.ap === 'H' && !r.action).length } };
  }

  fmeaList(auth: AuthContext) {
    return this.database.run(auth, async (tx) => (await tx.select().from(fmeas).orderBy(desc(fmeas.updatedAt))).map((f) => ({ ...this.withAp(f), rows: undefined })));
  }

  saveFmea(auth: AuthContext, id: string | null, input: z.infer<typeof fmeaSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { code: input.code, kind: input.kind, title: input.title, itemId: input.itemId ?? null, team: input.team ?? null, rows: this.fmeaRows(input.rows), updatedBy: auth.userId, updatedAt: new Date() };
      if (id) {
        const [cur] = await tx.select().from(fmeas).where(eq(fmeas.id, id));
        if (!cur) throw new NotFoundException('FMEA not found');
        const [f] = await tx.update(fmeas).set({ ...values, revision: cur.revision + 1 }).where(eq(fmeas.id, id)).returning();
        return this.withAp(f);
      }
      const [dup] = await tx.select({ id: fmeas.id }).from(fmeas).where(eq(fmeas.code, input.code));
      if (dup) throw new ConflictException(`FMEA ${input.code} already exists`);
      return this.withAp((await tx.insert(fmeas).values({ tenantId: auth.tenantId, ...values }).returning())[0]);
    });
  }

  getFmea(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [f] = await tx.select().from(fmeas).where(eq(fmeas.id, id));
      if (!f) throw new NotFoundException('FMEA not found');
      return this.withAp(f);
    });
  }

  saveControlPlan(auth: AuthContext, id: string | null, input: z.infer<typeof controlPlanSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { code: input.code, itemId: input.itemId, fmeaId: input.fmeaId ?? null, phase: input.phase, rows: input.rows as ControlPlanRow[], updatedBy: auth.userId, updatedAt: new Date() };
      if (id) {
        const [cur] = await tx.select().from(controlPlans).where(eq(controlPlans.id, id));
        if (!cur) throw new NotFoundException('Control plan not found');
        return (await tx.update(controlPlans).set({ ...values, revision: cur.revision + 1 }).where(eq(controlPlans.id, id)).returning())[0];
      }
      const [dup] = await tx.select({ id: controlPlans.id }).from(controlPlans).where(eq(controlPlans.code, input.code));
      if (dup) throw new ConflictException(`Control plan ${input.code} already exists`);
      return (await tx.insert(controlPlans).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  /** Draft control plan rows from a process FMEA: every special characteristic and high-priority failure mode. */
  draftFromFmea(auth: AuthContext, fmeaId: string) {
    return this.database.run(auth, async (tx) => {
      const [f] = await tx.select().from(fmeas).where(eq(fmeas.id, fmeaId));
      if (!f) throw new NotFoundException('FMEA not found');
      if (f.kind !== 'process') throw new BadRequestException('Control plans are drawn from a process FMEA');
      const rows: ControlPlanRow[] = f.rows
        .filter((r) => r.special || actionPriority(r.severity, r.occurrence, r.detection) !== 'L')
        .map((r) => ({ step: r.step, machine: null, characteristic: r.failureMode.replace(/^(no |wrong |missing |incorrect )/i, ''), type: 'process', special: r.special ?? null, specification: '', technique: r.detectionControl ?? '', sampleSize: '', frequency: '', method: r.prevention ?? '', reaction: 'Stop, segregate suspect parts, inform the supervisor and quality' }));
      return { fmea: { id: f.id, code: f.code, itemId: f.itemId }, rows };
    });
  }

  controlPlans(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.code, c.phase, c.revision, c.rows, c.updated_at as "updatedAt", i.code as "itemCode", i.name as "itemName", f.code as "fmeaCode"
            from control_plans c join items i on i.id = c.item_id left join fmeas f on f.id = c.fmea_id order by c.updated_at desc`,
      ),
    );
  }

  // ---- LPA ---------------------------------------------------------------------------------------

  checklists(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(lpaChecklists).orderBy(lpaChecklists.area));
  }

  addChecklist(auth: AuthContext, input: z.infer<typeof checklistSchema>) {
    return this.database.run(auth, async (tx) => (await tx.insert(lpaChecklists).values({ tenantId: auth.tenantId, ...input }).returning())[0]);
  }

  recordAudit(auth: AuthContext, input: z.infer<typeof lpaAuditSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(lpaChecklists).where(eq(lpaChecklists.id, input.checklistId));
      if (!c) throw new NotFoundException('Checklist not found');
      const missing = c.questions.filter((q) => !input.answers.some((a) => a.question === q));
      if (missing.length) throw new BadRequestException(`Answer every question (${missing.length} missing)`);
      const bad = input.answers.filter((a) => a.answer === 'no' && !a.note);
      if (bad.length) throw new BadRequestException('Describe each finding');
      const [a] = await tx.insert(lpaAudits).values({ tenantId: auth.tenantId, checklistId: c.id, layer: input.layer, auditor: auth.userId, auditedOn: input.auditedOn ?? todayIST(), answers: input.answers.map((x) => ({ ...x, note: x.note ?? null })) }).returning();
      return { ...a, ...lpaScore(a.answers) };
    });
  }

  /** Audits done by layer and compliance over the last days, with open findings. */
  lpaSummary(auth: AuthContext, days: number) {
    return this.database.run(auth, async (tx) => {
      const audits = await many<{ id: string; layer: number; area: string; auditedOn: string; auditor: string | null; answers: { question: string; answer: 'yes' | 'no' | 'na'; note: string | null; fixedOnSpot?: boolean }[] }>(
        tx,
        sql`select a.id, a.layer, c.area, a.audited_on::text as "auditedOn", u.full_name as auditor, a.answers from lpa_audits a join lpa_checklists c on c.id = a.checklist_id
            left join users u on u.id = a.auditor where a.audited_on > current_date - ${days}::int order by a.audited_on desc`,
      );
      const byLayer = [1, 2, 3].map((layer) => {
        const list = audits.filter((x) => x.layer === layer);
        const all = list.flatMap((x) => x.answers);
        return { layer, audits: list.length, ...lpaScore(all) };
      });
      const findings = audits.flatMap((x) => x.answers.filter((q) => q.answer === 'no').map((q) => ({ audit: x.id, area: x.area, layer: x.layer, date: x.auditedOn, question: q.question, note: q.note, fixedOnSpot: !!q.fixedOnSpot })));
      return { days, byLayer, findings, audits: audits.map((x) => ({ id: x.id, layer: x.layer, area: x.area, auditedOn: x.auditedOn, auditor: x.auditor, ...lpaScore(x.answers) })) };
    });
  }

  // ---- CSR ---------------------------------------------------------------------------------------

  csrList(auth: AuthContext, customerId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.*, p.name as customer from csr_requirements r join parties p on p.id = r.customer_id ${customerId ? sql`where r.customer_id = ${customerId}` : sql``} order by p.name, r.created_at`,
      ),
    );
  }

  saveCsr(auth: AuthContext, id: string | null, input: z.infer<typeof csrSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, reference: input.reference ?? null, clause: input.clause ?? null, howMet: input.howMet ?? null, reviewedOn: input.reviewedOn ?? null };
      if (input.status === 'met' && !values.howMet) throw new BadRequestException('Say how the requirement is met');
      if (id) {
        const [r] = await tx.update(csrRequirements).set(values).where(eq(csrRequirements.id, id)).returning();
        if (!r) throw new NotFoundException('Requirement not found');
        return r;
      }
      return (await tx.insert(csrRequirements).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  // ---- EDI ---------------------------------------------------------------------------------------

  partners(auth: AuthContext) {
    return this.database.run(auth, (tx) => many(tx, sql`select e.*, p.name as party from edi_partners e join parties p on p.id = e.party_id order by p.name`));
  }

  savePartner(auth: AuthContext, input: z.infer<typeof partnerSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { partyId: input.partyId, ourId: input.ourId, theirId: input.theirId, partMap: input.partMap };
      return (await tx.insert(ediPartners).values({ tenantId: auth.tenantId, ...values }).onConflictDoUpdate({ target: [ediPartners.tenantId, ediPartners.theirId], set: values }).returning())[0];
    });
  }

  /**
   * Reads a DELFOR / DELJIT from a customer, maps its parts to items and, when every part is
   * known, loads the dated quantities into the customer's delivery schedules (one per item and
   * month, as a new revision).
   */
  async receive(auth: AuthContext, raw: string) {
    const r = await this.database.run(auth, async (tx) => {
      let parsed: ReturnType<typeof readSchedule>;
      try {
        parsed = readSchedule(raw);
      } catch (e) {
        const [m] = await tx.insert(ediMessages).values({ tenantId: auth.tenantId, direction: 'in', type: 'UNKNOWN', raw, status: 'error', error: e instanceof Error ? e.message : String(e) }).returning();
        return { error: m.error!, id: m.id } as const;
      }
      const [partner] = parsed.sender ? await tx.select().from(ediPartners).where(eq(ediPartners.theirId, parsed.sender)) : [];
      const items = partner ? await many<{ id: string; code: string; name: string }>(tx, sql`select id, code, name from items where id in ${Object.values(partner.partMap).length ? Object.values(partner.partMap) : ['00000000-0000-0000-0000-000000000000']}`) : [];
      const lines = parsed.lines.map((l) => {
        const itemId = partner?.partMap[l.part] ?? null;
        const it = items.find((x) => x.id === itemId);
        return { ...l, itemId, itemCode: it?.code ?? null, itemName: it?.name ?? null };
      });
      const unmapped = [...new Set(lines.filter((l) => !l.itemId).map((l) => l.part))];
      const error = !partner ? `Unknown sender ${parsed.sender}` : unmapped.length ? `Parts not mapped to items: ${unmapped.join(', ')}` : null;
      const [m] = await tx
        .insert(ediMessages)
        .values({ tenantId: auth.tenantId, partnerId: partner?.id ?? null, direction: 'in', type: parsed.type, reference: parsed.reference, raw, parsed: { ...parsed, lines }, status: error ? 'error' : 'processed', error })
        .returning();
      const totals = Object.values(
        lines.reduce<Record<string, { part: string; itemCode: string | null; firm: number; forecast: number }>>((acc, l) => {
          acc[l.part] ??= { part: l.part, itemCode: l.itemCode, firm: 0, forecast: 0 };
          if (l.firm) acc[l.part].firm += l.qty;
          else acc[l.part].forecast += l.qty;
          return acc;
        }, {}),
      );
      return { id: m.id, type: parsed.type, reference: parsed.reference, status: m.status, error, lines, totals, customerId: partner?.partyId ?? null };
    });
    if ('error' in r && !('lines' in r)) throw new BadRequestException({ message: r.error, id: r.id });
    const full = r as Exclude<typeof r, { readonly error: string; readonly id: string }>;
    let schedules = 0;
    if (!full.error && full.customerId) {
      const groups = new Map<string, { itemId: string; part: string; month: string; byDate: Map<string, number> }>();
      for (const l of full.lines) {
        const key = `${l.itemId}|${l.date.slice(0, 7)}`;
        const g = groups.get(key) ?? { itemId: l.itemId!, part: l.part, month: l.date.slice(0, 7), byDate: new Map() };
        g.byDate.set(l.date, (g.byDate.get(l.date) ?? 0) + l.qty);
        groups.set(key, g);
      }
      for (const g of groups.values()) {
        await this.schedules.save(auth, { customerId: full.customerId, itemId: g.itemId, customerPartNo: g.part, month: g.month, reference: `EDI ${full.type} ${full.reference ?? ''}`.trim(), lines: [...g.byDate.entries()].map(([date, qty]) => ({ date, qty })) });
        schedules++;
      }
    }
    const { customerId: _c, ...out } = full;
    return { ...out, schedules };
  }

  private async partnerFor(tx: Transaction, partyId: string) {
    const [p] = await tx.select().from(ediPartners).where(eq(ediPartners.partyId, partyId));
    if (!p) throw new BadRequestException('The customer is not set up for EDI');
    const reverse = Object.fromEntries(Object.entries(p.partMap).map(([part, item]) => [item, part]));
    return { p, reverse };
  }

  /** DESADV for a delivery note. */
  sendDesadv(auth: AuthContext, deliveryId: string) {
    return this.database.run(auth, async (tx) => {
      const [d] = await many<{ number: string | null; date: string; customerId: string; orderRef: string | null }>(
        tx,
        sql`select doc.number, doc.doc_date::text as date, dn.customer_id as "customerId", so.number as "orderRef" from delivery_notes dn join documents doc on doc.id = dn.id
            left join documents so on so.id = dn.order_id where dn.id = ${deliveryId}`,
      );
      if (!d) throw new NotFoundException('Delivery not found');
      if (!d.number) throw new ConflictException('Submit the delivery first');
      const { p, reverse } = await this.partnerFor(tx, d.customerId);
      const lines = await many<{ itemId: string; code: string; qty: number }>(tx, sql`select l.item_id as "itemId", i.code, sum(l.base_qty)::float8 as qty from delivery_note_lines l join items i on i.id = l.item_id where l.delivery_id = ${deliveryId} group by 1, 2`);
      const raw = buildDesadv({ sender: p.ourId, receiver: p.theirId, number: d.number, date: d.date, orderRef: d.orderRef, lines: lines.map((l) => ({ part: reverse[l.itemId] ?? l.code, qty: l.qty })) });
      const [m] = await tx.insert(ediMessages).values({ tenantId: auth.tenantId, partnerId: p.id, direction: 'out', type: 'DESADV', reference: d.number, raw, status: 'sent' }).returning();
      return { id: m.id, raw };
    });
  }

  /** INVOIC for a sales invoice. */
  sendInvoic(auth: AuthContext, invoiceId: string) {
    return this.database.run(auth, async (tx) => {
      const [h] = await many<{ number: string | null; date: string; customerId: string; taxable: number; tax: number; total: number }>(
        tx,
        sql`select doc.number, doc.doc_date::text as date, si.customer_id as "customerId", si.taxable_total::float8 as taxable, si.tax_total::float8 as tax, si.grand_total::float8 as total
            from sales_invoices si join documents doc on doc.id = si.id where si.id = ${invoiceId}`,
      );
      if (!h) throw new NotFoundException('Invoice not found');
      if (!h.number) throw new ConflictException('Submit the invoice first');
      const { p, reverse } = await this.partnerFor(tx, h.customerId);
      const lines = await many<{ itemId: string; code: string; qty: number; rate: number; amount: number; gstRate: number }>(
        tx,
        sql`select l.item_id as "itemId", i.code, l.qty::float8 as qty, l.rate::float8 as rate, l.taxable_value::float8 as amount, l.gst_rate::float8 as "gstRate" from sales_invoice_lines l join items i on i.id = l.item_id where l.invoice_id = ${invoiceId} order by l.line_no`,
      );
      const raw = buildInvoic({ sender: p.ourId, receiver: p.theirId, number: h.number, date: h.date, taxable: h.taxable, tax: h.tax, total: h.total, lines: lines.map((l) => ({ part: reverse[l.itemId] ?? l.code, qty: l.qty, price: l.rate, amount: l.amount, gstRate: l.gstRate })) });
      const [m] = await tx.insert(ediMessages).values({ tenantId: auth.tenantId, partnerId: p.id, direction: 'out', type: 'INVOIC', reference: h.number, raw, status: 'sent' }).returning();
      return { id: m.id, raw };
    });
  }

  messages(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select m.id, m.direction, m.type, m.reference, m.status, m.error, m.created_at as "createdAt", p.name as party,
              coalesce(jsonb_array_length(m.parsed->'lines'), 0)::int as lines
            from edi_messages m left join edi_partners e on e.id = m.partner_id left join parties p on p.id = e.party_id order by m.created_at desc limit 200`,
      ),
    );
  }

  message(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select().from(ediMessages).where(eq(ediMessages.id, id));
      if (!m) throw new NotFoundException('Message not found');
      return m;
    });
  }
}
