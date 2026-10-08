import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  iotCommands,
  jobCards,
  machines,
  mesExecutions,
  mesInlineChecks,
  mesInstructions,
  mesMachineSessions,
  mesRecipes,
  mesSkills,
  type Characteristic,
  type RecipeParameter,
  type Transaction,
} from '@nextgen/database';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { GmpService } from '../gmp/gmp.service';
import { IotService } from '../iot/iot.service';
import { ProductionService } from '../manufacturing/production.service';
import { MesService } from './mes.service';
import { blocked, checksDue, judge, startChecks, type StartContext } from './poka-yoke';
import { many } from '../../common/sql';

const name = z.string().trim().min(1).max(120);
const num = z.number().finite();
const target = z
  .object({ protocol: z.enum(['modbus-tcp', 'mqtt']) })
  .catchall(z.union([z.string().max(300), z.number(), z.boolean()]))
  .nullable()
  .optional();

export const instructionSchema = z.object({
  itemId: z.uuid(),
  operationSeq: z.number().int().min(1).max(999),
  title: z.string().trim().min(2).max(200),
  steps: z.array(z.object({ title: name, body: z.string().trim().max(4000).default(''), imageUrl: z.string().trim().max(1000).nullable().optional(), confirm: z.boolean().default(false), caution: z.boolean().default(false) })).max(60),
  characteristics: z.array(z.object({ name, unit: z.string().trim().max(20).nullable().optional(), min: num.nullable().optional(), max: num.nullable().optional(), everyMinutes: z.number().int().min(1).max(1440).nullable().optional() })).max(40).default([]),
  firstOffRequired: z.boolean().default(false),
  scanMaterials: z.boolean().default(false),
});
export const recipeSchema = z.object({
  itemId: z.uuid(),
  machineId: z.uuid().nullable().optional(),
  parameters: z.array(z.object({ name, unit: z.string().trim().max(20).nullable().optional(), value: num, min: num.nullable().optional(), max: num.nullable().optional(), signalCode: z.string().trim().max(60).nullable().optional(), target })).min(1).max(100),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export const skillSchema = z.object({ operatorName: name, userId: z.uuid().nullable().optional(), workCenterId: z.uuid(), level: z.number().int().min(1).max(4).default(2), validUntil: z.iso.date().nullable().optional() });
export const loginSchema = z.object({ operatorName: name });
export const jobSchema = z.object({
  operationId: z.uuid(),
  machineId: z.uuid(),
  operatorName: z.string().trim().max(120).nullable().optional(),
  toolCode: z.string().trim().max(60).nullable().optional(),
  materials: z.array(z.object({ code: z.string().trim().min(1).max(60), batchNo: z.string().trim().max(60).nullable().optional() })).max(50).default([]),
  stepsAcked: z.array(z.number().int().min(0)).max(100).default([]),
});
export const firstOffSchema = z.object({ approved: z.boolean(), readings: z.array(z.object({ name, value: num })).max(40).default([]), note: z.string().trim().max(500).nullable().optional() });
export const inlineSchema = z.object({ readings: z.array(z.object({ name, value: num })).min(1).max(40) });

/**
 * MES execution at the machine: operator log-in and skills, versioned work instructions and
 * recipes, checks before the start (poka-yoke), first-off approval, in-line quality readings,
 * recipe download to the PLC through the edge gateway, and the batch record of each job.
 */
@Injectable()
export class MesExecutionService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly production: ProductionService,
    private readonly iot: IotService,
    private readonly mes: MesService,
    private readonly gmp: GmpService,
  ) {}

  onModuleInit() {
    // A job that needs a first-off approval cannot book good pieces until it has one.
    this.production.onCardDone(async (tx, _auth, card) => {
      const [e] = await tx.select({ firstOff: mesExecutions.firstOff }).from(mesExecutions).where(eq(mesExecutions.jobCardId, card.id));
      if (e && (e.firstOff === 'pending' || e.firstOff === 'rejected') && Number(card.goodQty) > 0)
        throw new ConflictException(e.firstOff === 'pending' ? 'The first-off piece has not been approved yet; good pieces cannot be booked' : 'The first-off piece was rejected; book the pieces as rejected or get a new first-off approved');
    });
  }

  // ---- instructions ----------------------------------------------------------------------------

  instructions(auth: AuthContext, itemId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select i.id, i.item_id as "itemId", it.code as "itemCode", it.name as "itemName", i.operation_seq as "operationSeq", i.version, i.status, i.title,
              jsonb_array_length(i.steps)::int as steps, jsonb_array_length(i.characteristics)::int as characteristics, i.first_off_required as "firstOffRequired",
              i.scan_materials as "scanMaterials", i.released_at as "releasedAt", u.full_name as "releasedBy"
            from mes_instructions i join items it on it.id = i.item_id left join users u on u.id = i.released_by
            ${itemId ? sql`where i.item_id = ${itemId}` : sql``} order by it.code, i.operation_seq, i.version desc`,
      ),
    );
  }

  instruction(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [i] = await tx.select().from(mesInstructions).where(eq(mesInstructions.id, id));
      if (!i) throw new NotFoundException('Instruction not found');
      return i;
    });
  }

  /** Saves a draft; editing a released version starts a new draft version. */
  saveInstruction(auth: AuthContext, id: string | null, input: z.infer<typeof instructionSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, steps: input.steps, characteristics: input.characteristics as Characteristic[] };
      if (id) {
        const [cur] = await tx.select().from(mesInstructions).where(eq(mesInstructions.id, id));
        if (!cur) throw new NotFoundException('Instruction not found');
        if (cur.status === 'draft') return (await tx.update(mesInstructions).set(values).where(eq(mesInstructions.id, id)).returning())[0];
      }
      const [v] = await many<{ v: number }>(tx, sql`select coalesce(max(version), 0)::int as v from mes_instructions where item_id = ${input.itemId} and operation_seq = ${input.operationSeq}`);
      const [row] = await tx.insert(mesInstructions).values({ tenantId: auth.tenantId, ...values, version: v.v + 1, createdBy: auth.userId }).returning();
      return row;
    });
  }

  release(auth: AuthContext, id: string, kind: 'instruction' | 'recipe') {
    return this.database.run(auth, async (tx) => {
      const table = kind === 'instruction' ? mesInstructions : mesRecipes;
      const [cur] = kind === 'instruction' ? await tx.select().from(mesInstructions).where(eq(mesInstructions.id, id)) : await tx.select().from(mesRecipes).where(eq(mesRecipes.id, id));
      if (!cur) throw new NotFoundException(`${kind === 'instruction' ? 'Instruction' : 'Recipe'} not found`);
      if (cur.status !== 'draft') throw new ConflictException('Only a draft can be released');
      if (kind === 'instruction') {
        const c = cur as typeof mesInstructions.$inferSelect;
        await tx.update(mesInstructions).set({ status: 'retired' }).where(and(eq(mesInstructions.itemId, c.itemId), eq(mesInstructions.operationSeq, c.operationSeq), eq(mesInstructions.status, 'released')));
      } else {
        const c = cur as typeof mesRecipes.$inferSelect;
        await tx
          .update(mesRecipes)
          .set({ status: 'retired' })
          .where(and(eq(mesRecipes.itemId, c.itemId), c.machineId ? eq(mesRecipes.machineId, c.machineId) : isNull(mesRecipes.machineId), eq(mesRecipes.status, 'released')));
      }
      const [r] = await tx.update(table).set({ status: 'released', releasedBy: auth.userId, releasedAt: new Date() }).where(eq(table.id, id)).returning();
      return r;
    });
  }

  private async currentInstruction(tx: Transaction, itemId: string, seq: number) {
    const [i] = await tx
      .select()
      .from(mesInstructions)
      .where(and(eq(mesInstructions.itemId, itemId), eq(mesInstructions.operationSeq, seq), eq(mesInstructions.status, 'released')))
      .orderBy(desc(mesInstructions.version))
      .limit(1);
    return i ?? null;
  }

  // ---- recipes ---------------------------------------------------------------------------------

  recipes(auth: AuthContext, itemId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select r.id, r.item_id as "itemId", it.code as "itemCode", it.name as "itemName", r.machine_id as "machineId", m.code as "machineCode", r.version, r.status,
              r.parameters, r.notes, r.released_at as "releasedAt", u.full_name as "releasedBy"
            from mes_recipes r join items it on it.id = r.item_id left join machines m on m.id = r.machine_id left join users u on u.id = r.released_by
            ${itemId ? sql`where r.item_id = ${itemId}` : sql``} order by it.code, m.code nulls first, r.version desc`,
      ),
    );
  }

  saveRecipe(auth: AuthContext, id: string | null, input: z.infer<typeof recipeSchema>) {
    return this.database.run(auth, async (tx) => {
      for (const p of input.parameters) {
        if (p.min != null && p.max != null && p.min > p.max) throw new BadRequestException(`${p.name}: the minimum is above the maximum`);
        if ((p.min != null && p.value < p.min) || (p.max != null && p.value > p.max)) throw new BadRequestException(`${p.name}: the set-point is outside its limits`);
      }
      const values = { itemId: input.itemId, machineId: input.machineId ?? null, parameters: input.parameters as RecipeParameter[], notes: input.notes ?? null };
      if (id) {
        const [cur] = await tx.select().from(mesRecipes).where(eq(mesRecipes.id, id));
        if (!cur) throw new NotFoundException('Recipe not found');
        if (cur.status === 'draft') return (await tx.update(mesRecipes).set(values).where(eq(mesRecipes.id, id)).returning())[0];
      }
      const [v] = await many<{ v: number }>(
        tx,
        sql`select coalesce(max(version), 0)::int as v from mes_recipes where item_id = ${input.itemId} and ${input.machineId ? sql`machine_id = ${input.machineId}` : sql`machine_id is null`}`,
      );
      const [row] = await tx.insert(mesRecipes).values({ tenantId: auth.tenantId, ...values, version: v.v + 1, createdBy: auth.userId }).returning();
      return row;
    });
  }

  /** The released recipe for the item on this machine, else for the item on any machine. */
  private async currentRecipe(tx: Transaction, itemId: string, machineId: string) {
    const [r] = await tx
      .select()
      .from(mesRecipes)
      .where(and(eq(mesRecipes.itemId, itemId), eq(mesRecipes.status, 'released'), sql`(${mesRecipes.machineId} = ${machineId} or ${mesRecipes.machineId} is null)`))
      .orderBy(sql`${mesRecipes.machineId} nulls last`, desc(mesRecipes.version))
      .limit(1);
    return r ?? null;
  }

  // ---- skills and log-in -----------------------------------------------------------------------

  skills(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.operator_name as "operatorName", s.user_id as "userId", s.work_center_id as "workCenterId", wc.code as "workCenterCode", wc.name as "workCenterName",
              s.level, s.valid_until as "validUntil", (s.valid_until is not null and s.valid_until < ${todayIST()}::date) as expired
            from mes_skills s join work_centers wc on wc.id = s.work_center_id order by wc.code, s.operator_name`,
      ),
    );
  }

  addSkill(auth: AuthContext, input: z.infer<typeof skillSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx
        .select({ id: mesSkills.id })
        .from(mesSkills)
        .where(and(eq(mesSkills.workCenterId, input.workCenterId), sql`lower(${mesSkills.operatorName}) = lower(${input.operatorName})`));
      const values = { operatorName: input.operatorName, userId: input.userId ?? null, workCenterId: input.workCenterId, level: input.level, validUntil: input.validUntil ?? null };
      if (dup) return (await tx.update(mesSkills).set(values).where(eq(mesSkills.id, dup.id)).returning())[0];
      return (await tx.insert(mesSkills).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  removeSkill(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.delete(mesSkills).where(eq(mesSkills.id, id)).returning({ id: mesSkills.id });
      if (!r) throw new NotFoundException('Skill not found');
      return { ok: true };
    });
  }

  login(auth: AuthContext, machineId: string, operatorName: string) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select({ id: machines.id }).from(machines).where(eq(machines.id, machineId));
      if (!m) throw new NotFoundException('Machine not found');
      await tx.update(mesMachineSessions).set({ logoutAt: new Date() }).where(and(eq(mesMachineSessions.machineId, machineId), isNull(mesMachineSessions.logoutAt)));
      const [s] = await tx.insert(mesMachineSessions).values({ tenantId: auth.tenantId, machineId, operatorName, userId: auth.userId }).returning();
      return s;
    });
  }

  logout(auth: AuthContext, machineId: string) {
    return this.database.run(auth, async (tx) => {
      const r = await tx.update(mesMachineSessions).set({ logoutAt: new Date() }).where(and(eq(mesMachineSessions.machineId, machineId), isNull(mesMachineSessions.logoutAt))).returning({ id: mesMachineSessions.id });
      return { ok: r.length > 0 };
    });
  }

  // ---- at the machine --------------------------------------------------------------------------

  /** What the machine can run next, who is logged in and the job running on it. */
  terminal(auth: AuthContext, machineId: string) {
    return this.database.run(auth, async (tx) => {
      const [m] = await many<{ id: string; code: string; name: string; workCenterId: string; workCenterCode: string }>(
        tx,
        sql`select m.id, m.code, m.name, m.work_center_id as "workCenterId", wc.code as "workCenterCode" from machines m join work_centers wc on wc.id = m.work_center_id where m.id = ${machineId}`,
      );
      if (!m) throw new NotFoundException('Machine not found');
      const [session] = await tx.select().from(mesMachineSessions).where(and(eq(mesMachineSessions.machineId, machineId), isNull(mesMachineSessions.logoutAt)));
      const queue = await many(
        tx,
        sql`select op.id as "operationId", op.seq, op.name, op.status, op.scheduled_start as "scheduledStart", wo.id as "workOrderId", d.number as "workOrderNumber",
              wo.item_id as "itemId", i.code as "itemCode", i.name as "itemName", wo.qty as "orderQty", op.good_qty as "goodQty", t.code as "toolCode",
              exists (select 1 from mes_instructions x where x.item_id = wo.item_id and x.operation_seq = op.seq and x.status = 'released') as "hasInstructions"
            from work_order_operations op join work_orders wo on wo.id = op.work_order_id join documents d on d.id = wo.id join items i on i.id = wo.item_id
            left join tools t on t.id = op.tool_id
            where op.work_center_id = ${m.workCenterId} and op.status in ('pending', 'in_progress') and wo.stage in ('released', 'in_progress') and not op.is_subcontract
            order by op.scheduled_start nulls last, d.number, op.seq limit 50`,
      );
      const [running] = await many<{ cardId: string; executionId: string | null }>(
        tx,
        sql`select jc.id as "cardId", e.id as "executionId" from job_cards jc left join mes_executions e on e.job_card_id = jc.id
            where jc.machine_id = ${machineId} and jc.status = 'running' order by jc.started_at desc limit 1`,
      );
      return { machine: m, session: session ?? null, queue, running: running ?? null };
    });
  }

  /** Instructions, recipe, tool and materials for an operation on a machine, before the start. */
  prepare(auth: AuthContext, operationId: string, machineId: string) {
    return this.database.run(auth, async (tx) => {
      const op = await this.operation(tx, operationId);
      const instruction = await this.currentInstruction(tx, op.itemId, op.seq);
      const recipe = await this.currentRecipe(tx, op.itemId, machineId);
      const required = await this.required(tx, op.workOrderId, op.seq, op.firstSeq);
      return { operation: op, instruction, recipe, required };
    });
  }

  private async operation(tx: Transaction, operationId: string) {
    const [op] = await many<{ id: string; seq: number; name: string; workOrderId: string; workOrderNumber: string; itemId: string; itemName: string; workCenterId: string; toolId: string | null; toolCode: string | null; firstSeq: number }>(
      tx,
      sql`select op.id, op.seq, op.name, wo.id as "workOrderId", d.number as "workOrderNumber", wo.item_id as "itemId", i.name as "itemName", op.work_center_id as "workCenterId",
            op.tool_id as "toolId", t.code as "toolCode", (select min(seq) from work_order_operations x where x.work_order_id = wo.id)::int as "firstSeq"
          from work_order_operations op join work_orders wo on wo.id = op.work_order_id join documents d on d.id = wo.id join items i on i.id = wo.item_id
          left join tools t on t.id = op.tool_id where op.id = ${operationId}`,
    );
    if (!op) throw new NotFoundException('Operation not found');
    return op;
  }

  /** Components this operation consumes (materials without a stage go to the first operation). */
  private required(tx: Transaction, workOrderId: string, seq: number, firstSeq: number) {
    return many<{ itemId: string; code: string; name: string }>(
      tx,
      sql`select distinct i.id as "itemId", i.code, i.name from work_order_materials w join items i on i.id = w.item_id
          where w.work_order_id = ${workOrderId} and w.kind = 'component' and (w.operation_seq = ${seq} or (w.operation_seq is null and ${seq} = ${firstSeq}))`,
    );
  }

  private async evaluate(tx: Transaction, auth: AuthContext, input: z.infer<typeof jobSchema>) {
    const op = await this.operation(tx, input.operationId);
    const [m] = await many<{ code: string; workCenterId: string; requiresCleaning: boolean; cleanStatus: string; assetDown: boolean }>(
      tx,
      sql`select m.code, m.work_center_id as "workCenterId", m.requires_cleaning as "requiresCleaning", m.clean_status as "cleanStatus",
            exists (select 1 from maint_assets a where a.machine_id = m.id and a.status = 'down') as "assetDown" from machines m where m.id = ${input.machineId}`,
    );
    if (!m) throw new NotFoundException('Machine not found');
    const [session] = await tx.select().from(mesMachineSessions).where(and(eq(mesMachineSessions.machineId, input.machineId), isNull(mesMachineSessions.logoutAt)));
    const operatorName = input.operatorName?.trim() || session?.operatorName || null;
    const skills = await tx.select({ operatorName: mesSkills.operatorName, level: mesSkills.level, validUntil: mesSkills.validUntil }).from(mesSkills).where(eq(mesSkills.workCenterId, op.workCenterId));
    const toolCode = input.toolCode?.trim() || null;
    const [tool] = await many<{ id: string; code: string; status: string; lifeShots: number | null; shotsUsed: number }>(
      tx,
      sql`select id, code, status, life_shots as "lifeShots", shots_used as "shotsUsed" from tools where ${toolCode ? sql`lower(code) = lower(${toolCode})` : op.toolId ? sql`id = ${op.toolId}` : sql`false`}`,
    );
    const required = await this.required(tx, op.workOrderId, op.seq, op.firstSeq);
    const scanned: StartContext['scanned'] = [];
    for (const s of input.materials) {
      const [it] = await many<{ id: string; code: string }>(tx, sql`select id, code from items where lower(code) = lower(${s.code}) and deleted_at is null limit 1`);
      const [b] = it && s.batchNo ? await many<{ qcStatus: string; expiryDate: string | null }>(tx, sql`select qc_status as "qcStatus", expiry_date as "expiryDate" from batches where item_id = ${it.id} and lower(batch_no) = lower(${s.batchNo})`) : [];
      scanned.push({ code: s.code, batchNo: s.batchNo ?? null, itemId: it?.id ?? null, itemCode: it?.code ?? null, batch: b ?? null, batchMissing: !!(it && s.batchNo && !b) });
    }
    const instruction = await this.currentInstruction(tx, op.itemId, op.seq);
    const lineClearance = await this.gmp.clearanceFor(tx, auth.tenantId, op.workOrderId, input.machineId);
    const checks = startChecks({
      today: todayIST(),
      operatorName,
      skills,
      operation: { workCenterId: op.workCenterId, toolCode: op.toolCode },
      machine: m,
      otherOperator: session?.operatorName ?? null,
      tool: tool ?? null,
      scannedTool: toolCode,
      required,
      scanned,
      instruction: instruction ? { confirmSteps: instruction.steps.map((s, i) => (s.confirm ? i : -1)).filter((i) => i >= 0), scanMaterials: instruction.scanMaterials } : null,
      stepsAcked: input.stepsAcked,
      lineClearance,
    });
    return { op, operatorName, tool: tool ?? null, instruction, checks };
  }

  check(auth: AuthContext, input: z.infer<typeof jobSchema>) {
    return this.database.run(auth, async (tx) => {
      const r = await this.evaluate(tx, auth, input);
      return { canStart: blocked(r.checks).length === 0, checks: r.checks };
    });
  }

  /** Runs the checks, starts the job card, opens the execution and sends the recipe to the gateway. */
  async start(auth: AuthContext, input: z.infer<typeof jobSchema>) {
    const ev = await this.database.run(auth, (tx) => this.evaluate(tx, auth, input));
    const stop = blocked(ev.checks);
    if (stop.length) throw new ConflictException({ message: `Cannot start: ${stop.map((c) => c.detail ?? c.label).join('; ')}`, checks: ev.checks });
    const card = await this.production.start(auth, { operationId: input.operationId, machineId: input.machineId, operatorName: ev.operatorName, toolId: ev.tool?.id ?? null });
    return this.database.run(auth, async (tx) => {
      const recipe = await this.currentRecipe(tx, ev.op.itemId, input.machineId);
      let commandId: string | null = null;
      const writes = (recipe?.parameters ?? []).flatMap((p) => (p.target ? [{ ...p.target, name: p.name, value: p.value }] : []));
      if (recipe && writes.length) {
        const [gw] = await many<{ gatewayId: string }>(
          tx,
          sql`select gateway_id as "gatewayId" from iot_signals where machine_id = ${input.machineId} and gateway_id is not null group by 1 order by count(*) desc limit 1`,
        );
        if (gw) commandId = (await this.iot.createCommand(tx, auth.tenantId, gw.gatewayId, writes, null)).id;
      }
      const [e] = await tx
        .insert(mesExecutions)
        .values({
          tenantId: auth.tenantId,
          jobCardId: card.id,
          machineId: input.machineId,
          operatorName: ev.operatorName,
          instructionId: ev.instruction?.id ?? null,
          stepsAcked: input.stepsAcked,
          checks: ev.checks,
          scans: { tool: input.toolCode ?? null, materials: input.materials },
          firstOff: ev.instruction?.firstOffRequired ? 'pending' : 'not_required',
          recipeId: recipe?.id ?? null,
          commandId,
          createdBy: auth.userId,
        })
        .returning();
      if (commandId) await tx.update(iotCommands).set({ ref: e.id }).where(eq(iotCommands.id, commandId));
      return this.view(tx, e.id);
    });
  }

  private async execution(tx: Transaction, id: string) {
    const [e] = await tx.select().from(mesExecutions).where(eq(mesExecutions.id, id));
    if (!e) throw new NotFoundException('Execution not found');
    const instruction = e.instructionId ? (await tx.select().from(mesInstructions).where(eq(mesInstructions.id, e.instructionId)))[0] : null;
    return { e, instruction };
  }

  firstOff(auth: AuthContext, id: string, input: z.infer<typeof firstOffSchema>) {
    return this.database.run(auth, async (tx) => {
      const { e, instruction } = await this.execution(tx, id);
      if (e.firstOff === 'not_required') throw new ConflictException('This job does not need a first-off approval');
      if (e.firstOff === 'approved') throw new ConflictException('The first-off is already approved');
      const readings = judge(instruction?.characteristics ?? [], input.readings);
      const unknown = readings.filter((r) => !r.known);
      if (unknown.length) throw new BadRequestException(`Not a characteristic of this operation: ${unknown.map((r) => r.name).join(', ')}`);
      const bad = readings.filter((r) => !r.ok);
      if (input.approved && bad.length) throw new BadRequestException(`Cannot approve: ${bad.map((r) => `${r.name} ${r.value}`).join(', ')} out of limits`);
      await tx
        .update(mesExecutions)
        .set({ firstOff: input.approved ? 'approved' : 'rejected', firstOffReadings: readings.map(({ known: _k, ...r }) => r), firstOffNote: input.note ?? null, firstOffBy: auth.userId, firstOffAt: new Date() })
        .where(eq(mesExecutions.id, id));
      return this.view(tx, id);
    });
  }

  /** In-line readings; anything out of limits calls quality on the Andon board. */
  async inline(auth: AuthContext, id: string, input: z.infer<typeof inlineSchema>) {
    const res = await this.database.run(auth, async (tx) => {
      const { e, instruction } = await this.execution(tx, id);
      const [card] = await tx.select({ status: jobCards.status }).from(jobCards).where(eq(jobCards.id, e.jobCardId));
      if (card?.status !== 'running') throw new ConflictException('The job is not running');
      const readings = judge(instruction?.characteristics ?? [], input.readings);
      const unknown = readings.filter((r) => !r.known);
      if (unknown.length) throw new BadRequestException(`Not a characteristic of this operation: ${unknown.map((r) => r.name).join(', ')}`);
      const allOk = readings.every((r) => r.ok);
      await tx.insert(mesInlineChecks).values({ tenantId: auth.tenantId, executionId: id, readings: readings.map(({ known: _k, ...r }) => r), allOk, by: auth.userId });
      return { e, allOk, readings };
    });
    if (!res.allOk && res.e.machineId) {
      const bad = res.readings.filter((r) => !r.ok).map((r) => `${r.name} ${r.value}`).join(', ');
      await this.mes.raiseCall(auth, { machineId: res.e.machineId, kind: 'quality', note: `In-line check out of limits: ${bad}` }).catch(() => undefined);
    }
    return this.database.run(auth, (tx) => this.view(tx, id));
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.view(tx, id));
  }

  /** Everything about the job: the batch record. */
  private async view(tx: Transaction, id: string) {
    const { e, instruction } = await this.execution(tx, id);
    const [card] = await many<{ id: string; status: string; startedAt: string; endedAt: string | null; goodQty: string; rejectQty: string; shots: number; operatorName: string | null; workOrderId: string; workOrderNumber: string; itemCode: string; itemName: string; operation: string; seq: number; machineCode: string | null; toolCode: string | null }>(
      tx,
      sql`select jc.id, jc.status, jc.started_at as "startedAt", jc.ended_at as "endedAt", jc.good_qty as "goodQty", jc.reject_qty as "rejectQty", jc.shots, jc.operator_name as "operatorName",
            wo.id as "workOrderId", d.number as "workOrderNumber", i.code as "itemCode", i.name as "itemName", op.name as operation, op.seq, m.code as "machineCode", t.code as "toolCode"
          from job_cards jc join work_orders wo on wo.id = jc.work_order_id join documents d on d.id = wo.id join items i on i.id = wo.item_id
          join work_order_operations op on op.id = jc.operation_id left join machines m on m.id = jc.machine_id left join tools t on t.id = jc.tool_id where jc.id = ${e.jobCardId}`,
    );
    const recipe = e.recipeId ? (await tx.select().from(mesRecipes).where(eq(mesRecipes.id, e.recipeId)))[0] : null;
    const command = e.commandId ? (await tx.select({ status: iotCommands.status, result: iotCommands.result, sentAt: iotCommands.sentAt, doneAt: iotCommands.doneAt }).from(iotCommands).where(eq(iotCommands.id, e.commandId)))[0] : null;
    const inline = await many<{ at: string; readings: { name: string; value: number; ok: boolean }[]; allOk: boolean; by: string | null }>(
      tx,
      sql`select c.at, c.readings, c.all_ok as "allOk", u.full_name as by from mes_inline_checks c left join users u on u.id = c.by where c.execution_id = ${id} order by c.at`,
    );
    const [fo] = e.firstOffBy ? await many<{ name: string }>(tx, sql`select full_name as name from users where id = ${e.firstOffBy}`) : [];
    // Process parameters measured while the job ran.
    const params = e.machineId
      ? await many<{ code: string; name: string; unit: string | null; purpose: string; n: number; min: number | null; avg: number | null; max: number | null }>(
          tx,
          sql`select s.code, s.name, s.unit, s.purpose, count(r.*)::int as n, min(r.value) as min, round(avg(r.value)::numeric, 3)::float8 as avg, max(r.value) as max
              from iot_signals s left join iot_readings r on r.signal_id = s.id and r.ts >= ${card.startedAt} and r.ts <= coalesce(${card.endedAt}::timestamptz, now())
              where s.machine_id = ${e.machineId} and s.purpose not in ('part_count', 'reject_count', 'energy_kwh', 'run_state') group by 1, 2, 3, 4 order by 1`,
        )
      : [];
    const recipeCheck = (recipe?.parameters ?? []).map((p) => {
      const measured = p.signalCode ? params.find((x) => x.code.toLowerCase() === p.signalCode!.toLowerCase()) : undefined;
      const inSpec = measured && measured.n ? (p.min == null || (measured.min ?? 0) >= p.min) && (p.max == null || (measured.max ?? 0) <= p.max) : null;
      return { name: p.name, unit: p.unit ?? null, setPoint: p.value, min: p.min ?? null, max: p.max ?? null, written: !!p.target, measured: measured ? { min: measured.min, avg: measured.avg, max: measured.max, n: measured.n } : null, inSpec };
    });
    const last = inline.length ? Date.parse(inline[inline.length - 1].at) : null;
    return {
      id: e.id,
      jobCard: { ...card, goodQty: Number(card.goodQty), rejectQty: Number(card.rejectQty) },
      operatorName: e.operatorName,
      instruction: instruction ? { id: instruction.id, version: instruction.version, title: instruction.title, steps: instruction.steps, characteristics: instruction.characteristics, firstOffRequired: instruction.firstOffRequired } : null,
      stepsAcked: e.stepsAcked,
      checks: e.checks,
      scans: e.scans,
      firstOff: { status: e.firstOff, readings: e.firstOffReadings, note: e.firstOffNote, by: fo?.name ?? null, at: e.firstOffAt },
      inlineChecks: inline,
      checksDue: card.status === 'running' && instruction ? checksDue(instruction.characteristics, Date.parse(card.startedAt), last, Date.now()) : [],
      recipe: recipe ? { id: recipe.id, version: recipe.version, notes: recipe.notes, parameters: recipeCheck, download: command } : null,
      parameters: params,
      createdAt: e.createdAt,
    };
  }

  executions(auth: AuthContext, q: { machineId?: string; workOrderId?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select e.id, e.created_at as "createdAt", e.operator_name as "operatorName", e.first_off as "firstOff", jc.status, jc.good_qty as "goodQty", jc.reject_qty as "rejectQty",
              d.number as "workOrderNumber", i.code as "itemCode", op.name as operation, m.code as "machineCode"
            from mes_executions e join job_cards jc on jc.id = e.job_card_id join work_orders wo on wo.id = jc.work_order_id join documents d on d.id = wo.id
            join items i on i.id = wo.item_id join work_order_operations op on op.id = jc.operation_id left join machines m on m.id = e.machine_id
            where true ${q.machineId ? sql`and e.machine_id = ${q.machineId}` : sql``} ${q.workOrderId ? sql`and wo.id = ${q.workOrderId}` : sql``}
            order by e.created_at desc limit 200`,
      ),
    );
  }
}
