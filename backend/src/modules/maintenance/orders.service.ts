import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { documents, items, maintAssets, maintenanceOrders, maintenanceSpares, pmSchedules, tools, uoms, warehouses, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService, type Voucher } from '../inventory/stock.service';

const DOC_TYPE = 'maintenance_order' as const;
const D = Decimal.from;
const ZERO = D('0');
const dec = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), `${label}: a number`);

export const requestSchema = z
  .object({
    kind: z.enum(['breakdown', 'preventive', 'condition', 'shutdown', 'corrective']).default('breakdown'),
    assetId: z.uuid().nullable().optional(),
    toolId: z.uuid().nullable().optional(),
    problem: z.string().trim().min(3).max(4000),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    requestedBy: optionalText(120),
    reportedAt: z.iso.datetime({ offset: true }).optional(),
    plannedDate: z.iso.date().nullable().optional(),
    machineDown: z.boolean().optional(),
    assignedTo: optionalText(120),
  })
  .refine((r) => r.assetId || r.toolId, { path: ['assetId'], message: 'Choose the asset (or the mould / die)' });
export type RequestInput = z.infer<typeof requestSchema>;

export const startSchema = z.object({ version: z.number().int(), assignedTo: optionalText(120), startedAt: z.iso.datetime({ offset: true }).optional() });
export const completeSchema = z.object({
  version: z.number().int(),
  finishedAt: z.iso.datetime({ offset: true }).optional(),
  failureCode: optionalText(80),
  actionTaken: z.string().trim().min(3).max(4000),
  checklist: z.array(z.object({ item: z.string().max(300), ok: z.boolean().nullable(), note: optionalText(300) })).max(100).default([]),
  labour: z.array(z.object({ person: z.string().trim().min(1).max(120), hours: dec('Hours'), rate: dec('Rate') })).max(50).default([]),
  spares: z.array(z.object({ itemId: z.uuid(), warehouseId: z.uuid(), qty: dec('Quantity').refine((v) => Number(v) > 0, 'Quantity must be more than zero'), batchNo: optionalText(40) })).max(100).default([]),
  meterReading: dec('Meter reading').nullable().optional(),
  otherCost: dec('Other cost').default('0'),
  /** Override when the machine was down for a different time than the job took. */
  downtimeMinutes: z.number().int().min(0).max(525_600).nullable().optional(),
});
export type CompleteInput = z.infer<typeof completeSchema>;

const MINUTE = 60_000;

/**
 * Maintenance orders. A request (draft) is started, completed with findings, checklist,
 * labour and spares, then signed off through the approval workflow: sign-off issues the spares
 * from stock, fixes the cost and downtime, puts the asset back to running, and rolls the PM
 * schedule (or the mould's shot counter) forward.
 */
@Injectable()
export class MaintenanceOrdersService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false, onApproved: (tx, auth, doc) => this.signOff(tx, auth, doc) });
  }

  list(auth: AuthContext, q: { stage?: string; kind?: string; assetId?: string; open?: string; q?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          kind: maintenanceOrders.kind,
          problem: maintenanceOrders.problem,
          priority: maintenanceOrders.priority,
          stage: maintenanceOrders.stage,
          machineDown: maintenanceOrders.machineDown,
          reportedAt: maintenanceOrders.reportedAt,
          plannedDate: maintenanceOrders.plannedDate,
          assignedTo: maintenanceOrders.assignedTo,
          downtimeMinutes: maintenanceOrders.downtimeMinutes,
          totalCost: maintenanceOrders.totalCost,
          asset: sql<{ id: string; code: string; name: string } | null>`(select json_build_object('id', a.id, 'code', a.code, 'name', a.name) from maint_assets a where a.id = ${maintenanceOrders.assetId})`,
          tool: sql<{ id: string; code: string; name: string } | null>`(select json_build_object('id', t.id, 'code', t.code, 'name', t.name) from tools t where t.id = ${maintenanceOrders.toolId})`,
        })
        .from(documents)
        .innerJoin(maintenanceOrders, eq(maintenanceOrders.id, documents.id))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.stage ? eq(maintenanceOrders.stage, q.stage) : undefined,
            q.kind ? eq(maintenanceOrders.kind, q.kind) : undefined,
            q.assetId ? eq(maintenanceOrders.assetId, q.assetId) : undefined,
            q.open === 'true' ? sql`${documents.status} in ('draft', 'pending_approval')` : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(maintenanceOrders.problem, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  create(auth: AuthContext, input: RequestInput, meta: RequestMeta, extra: { scheduleId?: string; checklist?: string[] } = {}) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta, extra));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: RequestInput, meta: RequestMeta, extra: { scheduleId?: string; checklist?: string[] } = {}) {
    const label = await this.subject(tx, input.assetId ?? null, input.toolId ?? null);
    const down = input.kind === 'breakdown' ? true : (input.machineDown ?? false);
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: todayIST(), title: `${input.kind}: ${label} · ${input.problem}`.slice(0, 200), amount: null });
    await tx.insert(maintenanceOrders).values({
      id: doc.id,
      tenantId: auth.tenantId,
      kind: input.kind,
      assetId: input.assetId ?? null,
      toolId: input.toolId ?? null,
      scheduleId: extra.scheduleId ?? null,
      problem: input.problem,
      priority: input.kind === 'breakdown' && input.priority === 'normal' ? 'high' : input.priority,
      requestedBy: input.requestedBy,
      reportedAt: input.reportedAt ? new Date(input.reportedAt) : new Date(),
      plannedDate: input.plannedDate ?? null,
      machineDown: down,
      assignedTo: input.assignedTo,
      checklist: (extra.checklist ?? []).map((item) => ({ item, ok: null, note: null })),
    });
    if (down && input.assetId) await tx.update(maintAssets).set({ status: 'down' }).where(eq(maintAssets.id, input.assetId));
    if (input.toolId) await tx.update(tools).set({ status: 'maintenance' }).where(eq(tools.id, input.toolId));
    await this.documents.log(tx, auth, doc, 'document.created', meta, { kind: input.kind });
    return this.view(tx, auth, doc);
  }

  start(auth: AuthContext, id: string, input: z.infer<typeof startSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [o] = await tx.select().from(maintenanceOrders).where(eq(maintenanceOrders.id, id));
      if (o.stage !== 'open') throw new ConflictException('The job has already started');
      const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
      if (startedAt.getTime() < o.reportedAt.getTime() - MINUTE) throw new BadRequestException('Work cannot start before the job was reported');
      await tx.update(maintenanceOrders).set({ stage: 'in_progress', startedAt, assignedTo: input.assignedTo ?? o.assignedTo }).where(eq(maintenanceOrders.id, id));
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, 'maintenance.started', meta);
      return this.view(tx, auth, updated);
    });
  }

  /** Records what was found and done; the order can then be signed off. */
  complete(auth: AuthContext, id: string, input: CompleteInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [o] = await tx.select().from(maintenanceOrders).where(eq(maintenanceOrders.id, id));
      if (o.stage === 'open') throw new ConflictException('Start the job first');
      const finishedAt = input.finishedAt ? new Date(input.finishedAt) : new Date();
      if (o.startedAt && finishedAt < o.startedAt) throw new BadRequestException('The job cannot finish before it started');
      if (o.checklist.length && input.checklist.length !== o.checklist.length) throw new BadRequestException('Answer every checklist point');
      const its = input.spares.length ? await tx.select({ id: items.id, isStock: items.isStockItem }).from(items).where(inArray(items.id, input.spares.map((s) => s.itemId))) : [];
      for (const [i, s] of input.spares.entries()) if (!its.find((x) => x.id === s.itemId)?.isStock) throw new BadRequestException({ message: `Spare line ${i + 1}: not a stock item`, errors: [{ path: `spares.${i}.itemId`, message: 'Not a stock item' }] });
      const labourCost = input.labour.reduce((s, l) => s.add(D(l.hours).mul(D(l.rate))), ZERO);
      // Downtime: from the breakdown report (or the start of work) to the end, if the machine was down.
      const from = o.kind === 'breakdown' ? o.reportedAt : (o.startedAt ?? o.reportedAt);
      const downtime = input.downtimeMinutes ?? (o.machineDown ? Math.max(0, Math.round((finishedAt.getTime() - from.getTime()) / MINUTE)) : 0);
      await tx
        .update(maintenanceOrders)
        .set({ stage: 'done', finishedAt, failureCode: input.failureCode, actionTaken: input.actionTaken, checklist: input.checklist, labour: input.labour, meterReading: input.meterReading ?? null, labourCost: labourCost.toFixed(2), otherCost: input.otherCost, downtimeMinutes: downtime })
        .where(eq(maintenanceOrders.id, id));
      await tx.delete(maintenanceSpares).where(eq(maintenanceSpares.orderId, id));
      if (input.spares.length) await tx.insert(maintenanceSpares).values(input.spares.map((s, i) => ({ tenantId: auth.tenantId, orderId: id, lineNo: i + 1, itemId: s.itemId, warehouseId: s.warehouseId, qty: s.qty, batchNo: s.batchNo ? s.batchNo.toUpperCase() : null })));
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, 'maintenance.completed', meta, { downtime });
      return this.view(tx, auth, updated);
    });
  }

  submit(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [o] = await tx.select({ stage: maintenanceOrders.stage }).from(maintenanceOrders).where(eq(maintenanceOrders.id, id));
      if (o.stage !== 'done') throw new ConflictException('Complete the job before signing it off');
      return this.view(tx, auth, await this.documents.submit(tx, auth, doc, meta));
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const [o] = await tx.select().from(maintenanceOrders).where(eq(maintenanceOrders.id, id));
      await this.documents.deleteDraft(tx, auth, doc, meta);
      await this.release(tx, o.assetId, o.toolId);
    });
  }

  /** Back to running / available unless another job still has it down. */
  private async release(tx: Transaction, assetId: string | null, toolId: string | null) {
    if (assetId) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(maintenanceOrders).innerJoin(documents, eq(documents.id, maintenanceOrders.id)).where(and(eq(maintenanceOrders.assetId, assetId), eq(maintenanceOrders.machineDown, true), sql`${documents.status} in ('draft', 'pending_approval')`));
      if (!n) await tx.update(maintAssets).set({ status: 'running' }).where(and(eq(maintAssets.id, assetId), eq(maintAssets.status, 'down')));
    }
    if (toolId) await tx.update(tools).set({ status: 'available' }).where(and(eq(tools.id, toolId), eq(tools.status, 'maintenance')));
  }

  private async signOff(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [o] = await tx.select().from(maintenanceOrders).where(eq(maintenanceOrders.id, doc.id));
    const spares = await tx.select().from(maintenanceSpares).where(eq(maintenanceSpares.orderId, doc.id)).orderBy(asc(maintenanceSpares.lineNo));
    let sparesCost = ZERO;
    if (spares.length) {
      const voucher: Voucher = { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };
      const posted = await this.stock.post(tx, auth, voucher, spares.map((s) => ({ itemId: s.itemId, warehouseId: s.warehouseId, qty: ZERO.sub(D(s.qty)).toFixed(4), batchNo: s.batchNo, line: s.lineNo })));
      for (const [i, s] of spares.entries()) {
        const v = ZERO.sub(D(posted[i].value));
        sparesCost = sparesCost.add(v);
        await tx.update(maintenanceSpares).set({ value: v.toFixed(2) }).where(eq(maintenanceSpares.id, s.id));
      }
    }
    const total = sparesCost.add(D(o.labourCost)).add(D(o.otherCost));
    await tx.update(maintenanceOrders).set({ sparesCost: sparesCost.toFixed(2), totalCost: total.toFixed(2) }).where(eq(maintenanceOrders.id, doc.id));
    await tx.update(documents).set({ amount: total.toFixed(2) }).where(eq(documents.id, doc.id));
    if (o.meterReading && o.assetId) await tx.update(maintAssets).set({ meterReading: o.meterReading }).where(eq(maintAssets.id, o.assetId));
    // Roll the PM schedule forward from when the job was done.
    if (o.scheduleId) {
      const [s] = await tx.select().from(pmSchedules).where(eq(pmSchedules.id, o.scheduleId));
      if (s) {
        const doneOn = new Date((o.finishedAt ?? new Date()).getTime() + 330 * MINUTE).toISOString().slice(0, 10);
        const next = s.intervalDays ? new Date(Date.parse(`${doneOn}T00:00:00Z`) + s.intervalDays * 86_400_000).toISOString().slice(0, 10) : null;
        const meter = o.meterReading ?? (o.assetId ? (await tx.select({ m: maintAssets.meterReading }).from(maintAssets).where(eq(maintAssets.id, o.assetId)))[0]?.m : null) ?? null;
        await tx
          .update(pmSchedules)
          .set({ lastDoneOn: doneOn, nextDue: s.trigger === 'time' ? next : null, lastMeter: meter, nextMeter: s.trigger === 'meter' && meter && s.intervalMeter ? D(meter).add(D(s.intervalMeter)).toFixed(4) : s.nextMeter })
          .where(eq(pmSchedules.id, s.id));
      }
    }
    // A mould or die: its shot counter restarts from now.
    if (o.toolId) await tx.update(tools).set({ lastMaintenanceAt: sql`${tools.shotsUsed}` }).where(eq(tools.id, o.toolId));
    await this.release(tx, o.assetId, o.toolId);
  }

  private async subject(tx: Transaction, assetId: string | null, toolId: string | null) {
    if (assetId) {
      const [a] = await tx.select({ code: maintAssets.code, status: maintAssets.status }).from(maintAssets).where(eq(maintAssets.id, assetId));
      if (!a) throw new NotFoundException('Asset not found');
      if (a.status === 'retired') throw new ConflictException('The asset is retired');
      return a.code;
    }
    const [t] = await tx.select({ code: tools.code }).from(tools).where(eq(tools.id, toolId!));
    if (!t) throw new NotFoundException('Tool not found');
    return t.code;
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('maintenance.orders.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: false });
    const [o] = await tx.select().from(maintenanceOrders).where(eq(maintenanceOrders.id, doc.id));
    const asset = o.assetId ? (await tx.select({ id: maintAssets.id, code: maintAssets.code, name: maintAssets.name, status: maintAssets.status, meterUnit: maintAssets.meterUnit }).from(maintAssets).where(eq(maintAssets.id, o.assetId)))[0] : null;
    const tool = o.toolId ? (await tx.select({ id: tools.id, code: tools.code, name: tools.name, shotsUsed: tools.shotsUsed }).from(tools).where(eq(tools.id, o.toolId)))[0] : null;
    const spares = await tx
      .select({ id: maintenanceSpares.id, lineNo: maintenanceSpares.lineNo, itemId: maintenanceSpares.itemId, code: items.code, name: items.name, uom: uoms.code, warehouseId: maintenanceSpares.warehouseId, warehouse: warehouses.code, qty: maintenanceSpares.qty, batchNo: maintenanceSpares.batchNo, value: maintenanceSpares.value })
      .from(maintenanceSpares)
      .innerJoin(items, eq(items.id, maintenanceSpares.itemId))
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .innerJoin(warehouses, eq(warehouses.id, maintenanceSpares.warehouseId))
      .where(eq(maintenanceSpares.orderId, doc.id))
      .orderBy(asc(maintenanceSpares.lineNo));
    const schedule = o.scheduleId ? (await tx.select({ id: pmSchedules.id, title: pmSchedules.title }).from(pmSchedules).where(eq(pmSchedules.id, o.scheduleId)))[0] : null;
    const { tenantId: _t, id: _i, ...rest } = o;
    const editable = manage && (doc.status === 'draft' || doc.status === 'rejected');
    return { ...header, ...rest, asset: asset ?? null, tool: tool ?? null, schedule: schedule ?? null, spares, canStart: editable && o.stage === 'open', canComplete: editable && o.stage !== 'open', canSignOff: editable && o.stage === 'done' };
  }
}
