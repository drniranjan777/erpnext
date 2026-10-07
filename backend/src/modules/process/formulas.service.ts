import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { companies, documents, formulaLines, formulas, formulaStages, items, uoms, workCenters, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { decimalSchema, optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { WorkOrdersService } from '../manufacturing/work-orders.service';
import { formulaCost, scale, type FormulaData } from './formula-math';

const DOC_TYPE = 'formula' as const;
const D = Decimal.from;

type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}
const positive = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,6})?$/.test(v) && Number(v) > 0, `${label} must be more than zero`);

const body = {
  itemId: z.uuid(),
  kind: z.enum(['bulk', 'packing']).default('bulk'),
  batchSize: positive('Batch size'),
  batchMultiple: decimalSchema(4, 'Batch multiple'),
  yieldPct: decimalSchema(2, 'Yield %').transform((v) => v ?? '100'),
  isDefault: z.boolean().default(true),
  effectiveFrom: z.iso.date().nullable().optional(),
  declaration: optionalText(4000),
  notes: optionalText(2000),
  lines: z
    .array(
      z.object({
        kind: z.enum(['ingredient', 'coproduct', 'byproduct']).default('ingredient'),
        itemId: z.uuid(),
        basis: z.enum(['percent', 'fixed', 'potency']).default('fixed'),
        qty: positive('Quantity'),
        stdPotency: decimalSchema(2, 'Standard potency'),
        tolerancePct: decimalSchema(2, 'Tolerance %'),
        costSharePct: decimalSchema(2, 'Cost share %'),
        recoveryRate: decimalSchema(4, 'Recovery rate'),
        stageSeq: z.number().int().min(1).max(9999).nullable().optional(),
        remarks: optionalText(300),
      }),
    )
    .min(1, 'Add at least one ingredient')
    .max(300),
  stages: z
    .array(
      z.object({
        seq: z.number().int().min(1).max(9999),
        name: z.string().trim().min(2).max(120),
        workCenterId: z.uuid(),
        minutes: decimalSchema(2, 'Minutes').transform((v) => v ?? '0'),
        parameters: z.array(z.object({ name: z.string().trim().min(1).max(80), unit: optionalText(20), min: decimalSchema(4, 'Minimum'), max: decimalSchema(4, 'Maximum') })).max(30).default([]),
        instructions: optionalText(2000),
      }),
    )
    .max(50)
    .default([]),
};
export const createFormulaSchema = z.object(body);
export type CreateFormulaInput = z.infer<typeof createFormulaSchema>;
export const updateFormulaSchema = z.object({ ...body, version: z.number().int() });

/**
 * Master formulas (recipes) for process manufacturing: ingredients by percent of the batch,
 * fixed quantity or potency, co-products with a cost share, by-products, stages with
 * in-process parameters. Approved like a BOM; the default version is used for batches.
 */
@Injectable()
export class FormulasService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false, onApproved: (tx, _auth, doc) => this.approve(tx, doc) });
  }

  list(auth: AuthContext, q: { status?: string; q?: string; itemId?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, item: { id: items.id, code: items.code, name: items.name }, formulaVersion: formulas.version, kind: formulas.kind, batchSize: formulas.batchSize, yieldPct: formulas.yieldPct, isDefault: formulas.isDefault, unitCost: formulas.unitCost })
        .from(documents)
        .innerJoin(formulas, eq(formulas.id, documents.id))
        .innerJoin(items, eq(items.id, formulas.itemId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            q.itemId ? eq(formulas.itemId, q.itemId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(items.code, `%${term}%`), ilike(items.name, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateFormulaInput, meta: RequestMeta, previousVersionId?: string) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta, previousVersionId));
  }

  private async createTx(tx: Transaction, auth: AuthContext, input: CreateFormulaInput, meta: RequestMeta, previousVersionId?: string) {
    const p = await this.prepare(tx, input);
    const [{ v }] = await tx.select({ v: sql<number>`coalesce(max(${formulas.version}), 0)::int` }).from(formulas).where(eq(formulas.itemId, input.itemId));
    const [company] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: company.id, docDate: todayIST(), title: `${p.item.code} ${p.item.name} v${v + 1}`, amount: null });
    await tx.insert(formulas).values({ id: doc.id, tenantId: auth.tenantId, ...p.header, version: v + 1, previousVersionId: previousVersionId ?? null });
    await this.write(tx, auth, doc.id, p);
    await this.documents.log(tx, auth, doc, 'document.created', meta, { item: p.item.code, version: v + 1 });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: CreateFormulaInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [cur] = await tx.select({ itemId: formulas.itemId }).from(formulas).where(eq(formulas.id, id));
      if (cur.itemId !== input.itemId) fail([{ path: 'itemId', message: 'A formula stays on its item; start a new one for another item' }]);
      const p = await this.prepare(tx, input);
      await tx.update(formulas).set(p.header).where(eq(formulas.id, id));
      await tx.delete(formulaLines).where(eq(formulaLines.formulaId, id));
      await tx.delete(formulaStages).where(eq(formulaStages.formulaId, id));
      await this.write(tx, auth, id, p);
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => this.documents.deleteDraft(tx, auth, await this.documents.lock(tx, id, DOC_TYPE, version), meta));
  }

  submit(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const cancelled = await this.documents.cancel(tx, auth, doc, reason, meta);
      await tx.update(formulas).set({ isDefault: false }).where(eq(formulas.id, id));
      return this.view(tx, auth, cancelled);
    });
  }

  newVersion(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [f] = await tx.select().from(formulas).where(eq(formulas.id, id));
      if (!f) throw new NotFoundException('Formula not found');
      const lines = await tx.select().from(formulaLines).where(eq(formulaLines.formulaId, id)).orderBy(asc(formulaLines.lineNo));
      const stages = await tx.select().from(formulaStages).where(eq(formulaStages.formulaId, id)).orderBy(asc(formulaStages.seq));
      return this.createTx(
        tx,
        auth,
        {
          itemId: f.itemId,
          kind: f.kind as 'bulk',
          batchSize: f.batchSize,
          batchMultiple: f.batchMultiple,
          yieldPct: f.yieldPct,
          isDefault: true,
          effectiveFrom: null,
          declaration: f.declaration,
          notes: f.notes,
          lines: lines.map((l) => ({ kind: l.kind as 'ingredient', itemId: l.itemId, basis: l.basis as 'fixed', qty: l.qty, stdPotency: l.stdPotency, tolerancePct: l.tolerancePct, costSharePct: l.costSharePct, recoveryRate: l.recoveryRate, stageSeq: l.stageSeq, remarks: l.remarks })),
          stages: stages.map((s) => ({ seq: s.seq, name: s.name, workCenterId: s.workCenterId, minutes: s.minutes, parameters: s.parameters, instructions: s.instructions })),
        },
        meta,
        id,
      );
    });
  }

  private async prepare(tx: Transaction, input: CreateFormulaInput) {
    const errors: Err[] = [];
    const ids = [...new Set([input.itemId, ...input.lines.map((l) => l.itemId)])];
    const its = await tx.select({ id: items.id, code: items.code, name: items.name, type: items.type, baseUomId: items.baseUomId }).from(items).where(inArray(items.id, ids));
    const item = its.find((i) => i.id === input.itemId);
    if (!item) fail([{ path: 'itemId', message: 'Item not found' }]);
    if (item.type === 'service') errors.push({ path: 'itemId', message: 'A service has no formula' });
    input.lines.forEach((l, i) => {
      if (!its.some((x) => x.id === l.itemId)) errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: item not found` });
      if (l.itemId === input.itemId && l.kind === 'ingredient') errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: a product cannot be its own ingredient` });
      if (l.kind !== 'ingredient' && l.basis === 'potency') errors.push({ path: `lines.${i}.basis`, message: `Line ${i + 1}: only ingredients are dosed by potency` });
      if (l.basis === 'percent' && Number(l.qty) > 100) errors.push({ path: `lines.${i}.qty`, message: `Line ${i + 1}: a percentage above 100` });
      if (l.stdPotency && (Number(l.stdPotency) <= 0 || Number(l.stdPotency) > 100)) errors.push({ path: `lines.${i}.stdPotency`, message: `Line ${i + 1}: potency is a percentage up to 100` });
      if (l.kind === 'coproduct' && !l.costSharePct) errors.push({ path: `lines.${i}.costSharePct`, message: `Line ${i + 1}: give the co-product's share of the cost` });
      if (l.stageSeq && !input.stages.some((s) => s.seq === l.stageSeq)) errors.push({ path: `lines.${i}.stageSeq`, message: `Line ${i + 1}: stage ${l.stageSeq} is not in the process` });
    });
    // A formula written fully in percent must balance to 100 %.
    const ingredients = input.lines.filter((l) => l.kind === 'ingredient');
    if (ingredients.length && ingredients.every((l) => l.basis === 'percent')) {
      const total = ingredients.reduce((s, l) => s.add(D(l.qty)), D('0'));
      if (total.sub(D('100')).abs().cmp(D('0.01')) > 0) errors.push({ path: 'lines', message: `Ingredients add up to ${Number(total.toFixed(4))}%, not 100%` });
    }
    const coShare = input.lines.filter((l) => l.kind === 'coproduct').reduce((s, l) => s.add(D(l.costSharePct ?? '0')), D('0'));
    if (coShare.cmp(D('100')) >= 0) errors.push({ path: 'lines', message: 'Co-products cannot take all of the cost' });
    const seqs = input.stages.map((s) => s.seq);
    if (new Set(seqs).size !== seqs.length) errors.push({ path: 'stages', message: 'Stage numbers must be unique' });
    const wcs = input.stages.length ? await tx.select({ id: workCenters.id }).from(workCenters).where(inArray(workCenters.id, input.stages.map((s) => s.workCenterId))) : [];
    input.stages.forEach((s, i) => {
      if (!wcs.some((w) => w.id === s.workCenterId)) errors.push({ path: `stages.${i}.workCenterId`, message: `Stage ${s.seq}: work centre not found` });
      s.parameters.forEach((p, j) => {
        if (p.min !== null && p.max !== null && Number(p.min) > Number(p.max)) errors.push({ path: `stages.${i}.parameters.${j}.max`, message: `Stage ${s.seq}: ${p.name} maximum is below the minimum` });
      });
    });
    if (input.yieldPct && (Number(input.yieldPct) <= 0 || Number(input.yieldPct) > 200)) errors.push({ path: 'yieldPct', message: 'Yield must be between 0 and 200%' });
    if (errors.length) fail(errors);
    return {
      item: item!,
      header: { itemId: input.itemId, kind: input.kind, batchSize: input.batchSize, batchMultiple: input.batchMultiple ?? null, yieldPct: input.yieldPct, isDefault: input.isDefault, effectiveFrom: input.effectiveFrom ?? null, declaration: input.declaration, notes: input.notes },
      lines: input.lines.map((l, i) => ({ ...l, lineNo: i + 1, uomId: its.find((x) => x.id === l.itemId)!.baseUomId, stdPotency: l.basis === 'potency' ? (l.stdPotency ?? '100') : null, stageSeq: l.stageSeq ?? null })),
      stages: input.stages,
    };
  }

  private async write(tx: Transaction, auth: AuthContext, id: string, p: Awaited<ReturnType<FormulasService['prepare']>>) {
    await tx.insert(formulaLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, formulaId: id })));
    if (p.stages.length) await tx.insert(formulaStages).values(p.stages.map((s) => ({ ...s, tenantId: auth.tenantId, formulaId: id })));
  }

  private async approve(tx: Transaction, doc: DocumentRow) {
    const [f] = await tx.select().from(formulas).where(eq(formulas.id, doc.id));
    const from = f.effectiveFrom ?? todayIST();
    if (f.isDefault) {
      const prev = await tx
        .select({ id: formulas.id, effectiveFrom: formulas.effectiveFrom })
        .from(formulas)
        .innerJoin(documents, eq(documents.id, formulas.id))
        .where(and(eq(formulas.itemId, f.itemId), eq(formulas.isDefault, true), ne(formulas.id, f.id), eq(documents.status, 'approved')));
      const to = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      for (const p of prev) await tx.update(formulas).set({ isDefault: false, effectiveTo: p.effectiveFrom && p.effectiveFrom > to ? p.effectiveFrom : to }).where(eq(formulas.id, p.id));
    }
    await tx.update(formulas).set({ effectiveFrom: from }).where(eq(formulas.id, f.id));
    await this.storeCost(tx, f.id);
  }

  private async data(tx: Transaction, id: string): Promise<FormulaData> {
    const [f] = await tx.select().from(formulas).where(eq(formulas.id, id));
    if (!f) throw new NotFoundException('Formula not found');
    const lines = await tx.select().from(formulaLines).where(eq(formulaLines.formulaId, id)).orderBy(asc(formulaLines.lineNo));
    const stages = await tx.select().from(formulaStages).where(eq(formulaStages.formulaId, id)).orderBy(asc(formulaStages.seq));
    return {
      itemId: f.itemId,
      batchSize: f.batchSize,
      yieldPct: f.yieldPct,
      lines: lines.map((l) => ({ kind: l.kind as 'ingredient', itemId: l.itemId, basis: l.basis as 'fixed', qty: l.qty, stdPotency: l.stdPotency, tolerancePct: l.tolerancePct, costSharePct: l.costSharePct, recoveryRate: l.recoveryRate, stageSeq: l.stageSeq })),
      stages: stages.map((s) => ({ seq: s.seq, workCenterId: s.workCenterId, minutes: s.minutes })),
    };
  }

  private async costing(tx: Transaction, id: string) {
    const d = await this.data(tx, id);
    const costs = await this.workOrders.itemCosts(tx, d.lines.map((l) => l.itemId));
    const wcs = await tx.select().from(workCenters);
    return formulaCost(
      d,
      (itemId) => costs.get(itemId) ?? null,
      (wc) => {
        const w = wcs.find((x) => x.id === wc);
        return w ? D(w.labourRate).add(D(w.machineRate)).add(D(w.overheadRate)).toFixed(4) : '0';
      },
    );
  }

  private async storeCost(tx: Transaction, id: string) {
    const c = await this.costing(tx, id);
    const [f] = await tx.select({ batchSize: formulas.batchSize, yieldPct: formulas.yieldPct }).from(formulas).where(eq(formulas.id, id));
    const output = D(f.batchSize).mul(D(f.yieldPct)).div(D('100'));
    const per = (v: string) => (output.isZero() ? '0' : D(v).div(output).toFixed(4));
    await tx.update(formulas).set({ materialCost: per(c.material), conversionCost: per(c.conversion), unitCost: c.unitCost }).where(eq(formulas.id, id));
    return c;
  }

  /** Standard cost; `apply` writes the unit cost to the item's standard cost. */
  rollUp(auth: AuthContext, id: string, apply: boolean) {
    return this.database.run(auth, async (tx) => {
      const c = await this.storeCost(tx, id);
      if (apply) {
        if (c.missing.length) throw new ConflictException('Some ingredients have no cost yet; fix them before setting the standard cost');
        const [f] = await tx.select({ itemId: formulas.itemId }).from(formulas).where(eq(formulas.id, id));
        await tx.update(items).set({ standardCost: c.unitCost }).where(eq(items.id, f.itemId));
      }
      return { ...c, applied: apply };
    });
  }

  /** Quantities for a batch of a given size (preview before making a batch order). */
  scaleTo(auth: AuthContext, id: string, qty: string) {
    return this.database.run(auth, async (tx) => {
      const d = await this.data(tx, id);
      const lines = scale(d, qty);
      const its = await tx.select({ id: items.id, code: items.code, name: items.name, uom: uoms.code }).from(items).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(inArray(items.id, lines.map((l) => l.itemId)));
      return { qty, lines: lines.map((l) => ({ ...l, item: its.find((i) => i.id === l.itemId) })) };
    });
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const manage = perms.has('manufacturing.engineering.manage');
    const header = await this.documents.view(tx, auth, doc, { manage, cancel: manage });
    const [f] = await tx.select().from(formulas).where(eq(formulas.id, doc.id));
    const [item] = await tx.select({ id: items.id, code: items.code, name: items.name, uom: uoms.code }).from(items).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(eq(items.id, f.itemId));
    const lines = await tx.select({ l: formulaLines, code: items.code, name: items.name, uom: uoms.code }).from(formulaLines).innerJoin(items, eq(items.id, formulaLines.itemId)).innerJoin(uoms, eq(uoms.id, formulaLines.uomId)).where(eq(formulaLines.formulaId, doc.id)).orderBy(asc(formulaLines.lineNo));
    const stages = await tx.select({ s: formulaStages, workCenter: workCenters.code, workCenterName: workCenters.name }).from(formulaStages).innerJoin(workCenters, eq(workCenters.id, formulaStages.workCenterId)).where(eq(formulaStages.formulaId, doc.id)).orderBy(asc(formulaStages.seq));
    const versions = await tx.select({ id: formulas.id, version: formulas.version, status: documents.status, isDefault: formulas.isDefault }).from(formulas).innerJoin(documents, eq(documents.id, formulas.id)).where(eq(formulas.itemId, f.itemId)).orderBy(desc(formulas.version));
    const { tenantId: _t, id: _i, version: formulaVersion, ...rest } = f;
    return {
      ...header,
      ...rest,
      formulaVersion,
      item,
      lines: lines.map(({ l: { tenantId: _lt, formulaId: _f, ...l }, ...more }) => ({ ...l, ...more })),
      stages: stages.map(({ s: { tenantId: _st, formulaId: _f2, ...s }, ...more }) => ({ ...s, ...more })),
      versions,
      canNewVersion: doc.status === 'approved' && manage,
    };
  }
}
