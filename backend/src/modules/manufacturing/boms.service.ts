import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { bomLines, bomOperations, boms, companies, documents, items, parties, stockValuation, tools, uoms, warehouses, workCenters, type Transaction } from '@nextgen/database';
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
import { explode, rollUp, type BomData } from './bom-math';

const DOC_TYPE = 'bom' as const;
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

const bomBody = {
  itemId: z.uuid(),
  quantity: positive('BOM quantity').default('1'),
  isDefault: z.boolean().default(true),
  effectiveFrom: z.iso.date().nullable().optional(),
  drawingNo: optionalText(60),
  drawingRevision: optionalText(20),
  notes: optionalText(2000),
  lines: z
    .array(
      z.object({
        kind: z.enum(['component', 'byproduct', 'scrap']).default('component'),
        itemId: z.uuid(),
        qty: positive('Quantity'),
        scrapPct: decimalSchema(2, 'Scrap %').transform((v) => v ?? '0'),
        isPhantom: z.boolean().default(false),
        alternateGroup: optionalText(20),
        priority: z.number().int().min(1).max(99).default(1),
        operationSeq: z.number().int().min(1).max(9999).nullable().optional(),
        recoveryRate: decimalSchema(4, 'Recovery rate'),
        remarks: optionalText(300),
      }),
    )
    .min(1, 'Add at least one component')
    .max(500),
  operations: z
    .array(
      z.object({
        seq: z.number().int().min(1).max(9999),
        name: z.string().trim().min(2).max(120),
        workCenterId: z.uuid(),
        toolId: z.uuid().nullable().optional(),
        setupMinutes: decimalSchema(2, 'Setup minutes').transform((v) => v ?? '0'),
        runMinutes: decimalSchema(4, 'Run minutes').transform((v) => v ?? '0'),
        isSubcontract: z.boolean().default(false),
        vendorId: z.uuid().nullable().optional(),
        subcontractRate: decimalSchema(4, 'Sub-contract rate'),
        inspection: z.boolean().default(false),
        instructions: optionalText(2000),
      }),
    )
    .max(100)
    .default([]),
};
export const createBomSchema = z.object(bomBody);
export type CreateBomInput = z.infer<typeof createBomSchema>;
export const updateBomSchema = z.object({ ...bomBody, version: z.number().int() });

/**
 * Bills of materials with their routing. A BOM is a document: drafted, approved (optionally
 * through an approval rule), then frozen; changes go into a new version. The approved default
 * version of an item is what production and costing use.
 */
@Injectable()
export class BomsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.approve(tx, auth, doc),
    });
  }

  list(auth: AuthContext, q: { status?: string; q?: string; itemId?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, item: { id: items.id, code: items.code, name: items.name }, bomVersion: boms.version, quantity: boms.quantity, isDefault: boms.isDefault, effectiveFrom: boms.effectiveFrom, effectiveTo: boms.effectiveTo, unitCost: boms.unitCost })
        .from(documents)
        .innerJoin(boms, eq(boms.id, documents.id))
        .innerJoin(items, eq(items.id, boms.itemId))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            q.itemId ? eq(boms.itemId, q.itemId) : undefined,
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

  create(auth: AuthContext, input: CreateBomInput, meta: RequestMeta, extra: { previousVersionId?: string } = {}) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta, extra));
  }

  private async createTx(tx: Transaction, auth: AuthContext, input: CreateBomInput, meta: RequestMeta, extra: { previousVersionId?: string } = {}) {
    const p = await this.prepare(tx, input);
    const [{ v }] = await tx.select({ v: sql<number>`coalesce(max(${boms.version}), 0)::int` }).from(boms).where(eq(boms.itemId, input.itemId));
    const [company] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: company.id, branchId: null, docDate: todayIST(), title: `${p.item.code} ${p.item.name} v${v + 1}`, amount: null });
    await tx.insert(boms).values({ id: doc.id, tenantId: auth.tenantId, ...p.header, version: v + 1, previousVersionId: extra.previousVersionId ?? null });
    await this.writeLines(tx, auth, doc.id, p);
    await this.documents.log(tx, auth, doc, 'document.created', meta, { item: p.item.code, version: v + 1 });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: CreateBomInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const [cur] = await tx.select().from(boms).where(eq(boms.id, id));
      if (cur.itemId !== input.itemId) fail([{ path: 'itemId', message: 'A BOM stays on its item; start a new BOM for another item' }]);
      const p = await this.prepare(tx, input);
      await tx.update(boms).set(p.header).where(eq(boms.id, id));
      await tx.delete(bomLines).where(eq(bomLines.bomId, id));
      await tx.delete(bomOperations).where(eq(bomOperations.bomId, id));
      await this.writeLines(tx, auth, id, p);
      const updated = await this.documents.update(tx, auth, doc, {});
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.view(tx, auth, updated);
    });
  }

  remove(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      await this.documents.deleteDraft(tx, auth, doc, meta);
    });
  }

  submit(auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      // Circular structures are refused before approval.
      const data = await this.data(tx, id);
      const cache = await this.defaultBoms(tx);
      cache.set(data.itemId, data);
      try {
        explode(data, data.quantity, (itemId) => cache.get(itemId) ?? null, true);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const cancelled = await this.documents.cancel(tx, auth, doc, reason, meta);
      await tx.update(boms).set({ isDefault: false }).where(eq(boms.id, id));
      return this.view(tx, auth, cancelled);
    });
  }

  /** Copies an approved BOM into a new draft version. */
  newVersion(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [b] = await tx.select().from(boms).where(eq(boms.id, id));
      if (!b) throw new NotFoundException('BOM not found');
      const lines = await tx.select().from(bomLines).where(eq(bomLines.bomId, id)).orderBy(asc(bomLines.lineNo));
      const ops = await tx.select().from(bomOperations).where(eq(bomOperations.bomId, id)).orderBy(asc(bomOperations.seq));
      return this.createTx(
        tx,
        auth,
        {
          itemId: b.itemId,
          quantity: b.quantity,
          isDefault: true,
          effectiveFrom: null,
          drawingNo: b.drawingNo,
          drawingRevision: b.drawingRevision,
          notes: b.notes,
          lines: lines.map((l) => ({ kind: l.kind as 'component', itemId: l.itemId, qty: l.qty, scrapPct: l.scrapPct, isPhantom: l.isPhantom, alternateGroup: l.alternateGroup, priority: l.priority, operationSeq: l.operationSeq, recoveryRate: l.recoveryRate, remarks: l.remarks })),
          operations: ops.map((o) => ({ seq: o.seq, name: o.name, workCenterId: o.workCenterId, toolId: o.toolId, setupMinutes: o.setupMinutes, runMinutes: o.runMinutes, isSubcontract: o.isSubcontract, vendorId: o.vendorId, subcontractRate: o.subcontractRate, inspection: o.inspection, instructions: o.instructions })),
        },
        meta,
        { previousVersionId: id },
      );
    });
  }

  private async prepare(tx: Transaction, input: CreateBomInput) {
    const errors: Err[] = [];
    const ids = [...new Set([input.itemId, ...input.lines.map((l) => l.itemId)])];
    const its = await tx.select({ id: items.id, code: items.code, name: items.name, type: items.type, baseUomId: items.baseUomId }).from(items).where(inArray(items.id, ids));
    const item = its.find((i) => i.id === input.itemId);
    if (!item) fail([{ path: 'itemId', message: 'Item not found' }]);
    if (item.type === 'service') errors.push({ path: 'itemId', message: 'A service has no bill of materials' });
    const defaults = await this.defaultBoms(tx);
    input.lines.forEach((l, i) => {
      const c = its.find((x) => x.id === l.itemId);
      if (!c) errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: item not found` });
      else if (c.id === input.itemId) errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: an item cannot be its own component` });
      if (l.isPhantom && !defaults.has(l.itemId)) errors.push({ path: `lines.${i}.isPhantom`, message: `Line ${i + 1}: a phantom needs an approved BOM of its own` });
      if (l.kind !== 'component' && l.isPhantom) errors.push({ path: `lines.${i}.isPhantom`, message: `Line ${i + 1}: only components can be phantoms` });
      if (l.operationSeq && !input.operations.some((o) => o.seq === l.operationSeq)) errors.push({ path: `lines.${i}.operationSeq`, message: `Line ${i + 1}: operation ${l.operationSeq} is not in the routing` });
    });
    const seqs = input.operations.map((o) => o.seq);
    if (new Set(seqs).size !== seqs.length) errors.push({ path: 'operations', message: 'Operation numbers must be unique' });
    const wcs = input.operations.length ? await tx.select({ id: workCenters.id }).from(workCenters).where(inArray(workCenters.id, input.operations.map((o) => o.workCenterId))) : [];
    const toolIds = input.operations.map((o) => o.toolId).filter((v): v is string => !!v);
    const tls = toolIds.length ? await tx.select({ id: tools.id }).from(tools).where(inArray(tools.id, toolIds)) : [];
    const vendorIds = input.operations.map((o) => o.vendorId).filter((v): v is string => !!v);
    const vs = vendorIds.length ? await tx.select({ id: parties.id, isVendor: parties.isVendor }).from(parties).where(inArray(parties.id, vendorIds)) : [];
    input.operations.forEach((o, i) => {
      if (!wcs.some((w) => w.id === o.workCenterId)) errors.push({ path: `operations.${i}.workCenterId`, message: `Operation ${o.seq}: work centre not found` });
      if (o.toolId && !tls.some((t) => t.id === o.toolId)) errors.push({ path: `operations.${i}.toolId`, message: `Operation ${o.seq}: tool not found` });
      if (o.isSubcontract && (!o.vendorId || !vs.find((v) => v.id === o.vendorId)?.isVendor)) errors.push({ path: `operations.${i}.vendorId`, message: `Operation ${o.seq}: choose the job worker` });
      if (o.isSubcontract && !o.subcontractRate) errors.push({ path: `operations.${i}.subcontractRate`, message: `Operation ${o.seq}: give the job-work rate per unit` });
    });
    if (errors.length) fail(errors);
    return {
      item: item!,
      header: { itemId: item!.id, quantity: input.quantity, isDefault: input.isDefault, effectiveFrom: input.effectiveFrom ?? null, drawingNo: input.drawingNo, drawingRevision: input.drawingRevision, notes: input.notes },
      lines: input.lines.map((l, i) => ({ ...l, lineNo: i + 1, uomId: its.find((x) => x.id === l.itemId)!.baseUomId, alternateGroup: l.alternateGroup, operationSeq: l.operationSeq ?? null, recoveryRate: l.recoveryRate ?? null })),
      operations: input.operations.map((o) => ({ ...o, toolId: o.toolId ?? null, vendorId: o.isSubcontract ? (o.vendorId ?? null) : null, subcontractRate: o.isSubcontract ? (o.subcontractRate ?? null) : null })),
    };
  }

  private async writeLines(tx: Transaction, auth: AuthContext, bomId: string, p: Awaited<ReturnType<BomsService['prepare']>>) {
    await tx.insert(bomLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, bomId })));
    if (p.operations.length) await tx.insert(bomOperations).values(p.operations.map((o) => ({ ...o, tenantId: auth.tenantId, bomId })));
  }

  /** Approval: becomes the item's default version (closing the previous one) and is costed. */
  private async approve(tx: Transaction, _auth: AuthContext, doc: DocumentRow) {
    const [b] = await tx.select().from(boms).where(eq(boms.id, doc.id));
    const from = b.effectiveFrom ?? todayIST();
    if (b.isDefault) {
      const prev = await tx
        .select({ id: boms.id, effectiveFrom: boms.effectiveFrom })
        .from(boms)
        .innerJoin(documents, eq(documents.id, boms.id))
        .where(and(eq(boms.itemId, b.itemId), eq(boms.isDefault, true), ne(boms.id, b.id), eq(documents.status, 'approved')));
      for (const p of prev) {
        const to = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        await tx.update(boms).set({ isDefault: false, effectiveTo: p.effectiveFrom && p.effectiveFrom > to ? p.effectiveFrom : to }).where(eq(boms.id, p.id));
      }
    }
    await tx.update(boms).set({ effectiveFrom: from }).where(eq(boms.id, b.id));
    try {
      await this.storeCost(tx, b.id);
    } catch {
      // Costing gaps do not block approval; the cost page lists what is missing.
    }
  }

  // ---- data, explosion, costing -------------------------------------------------------

  async data(tx: Transaction, bomId: string): Promise<BomData> {
    const [b] = await tx.select().from(boms).where(eq(boms.id, bomId));
    if (!b) throw new NotFoundException('BOM not found');
    const lines = await tx.select().from(bomLines).where(eq(bomLines.bomId, bomId)).orderBy(asc(bomLines.lineNo));
    const ops = await tx.select().from(bomOperations).where(eq(bomOperations.bomId, bomId)).orderBy(asc(bomOperations.seq));
    return {
      id: b.id,
      itemId: b.itemId,
      quantity: b.quantity,
      lines: lines.map((l) => ({ kind: l.kind as 'component', itemId: l.itemId, qty: l.qty, scrapPct: l.scrapPct, isPhantom: l.isPhantom, alternateGroup: l.alternateGroup, priority: l.priority, recoveryRate: l.recoveryRate })),
      operations: ops.map((o) => ({ seq: o.seq, workCenterId: o.workCenterId, setupMinutes: o.setupMinutes, runMinutes: o.runMinutes, isSubcontract: o.isSubcontract, subcontractRate: o.subcontractRate })),
    };
  }

  /** Approved default BOM of every item (for explosion and roll-up). */
  async defaultBoms(tx: Transaction) {
    const rows = await tx.select({ id: boms.id }).from(boms).innerJoin(documents, eq(documents.id, boms.id)).where(and(eq(boms.isDefault, true), eq(documents.status, 'approved')));
    const out = new Map<string, BomData>();
    for (const r of rows) {
      const d = await this.data(tx, r.id);
      out.set(d.itemId, d);
    }
    return out;
  }

  /** Default approved BOM id of an item, if any. */
  async defaultFor(tx: Transaction, itemId: string) {
    const [r] = await tx.select({ id: boms.id }).from(boms).innerJoin(documents, eq(documents.id, boms.id)).where(and(eq(boms.itemId, itemId), eq(boms.isDefault, true), eq(documents.status, 'approved')));
    return r?.id ?? null;
  }

  explode(auth: AuthContext, id: string, qty: string, multiLevel: boolean) {
    return this.database.run(auth, async (tx) => {
      const root = await this.data(tx, id);
      const cache = await this.defaultBoms(tx);
      const r = explode(root, qty, (itemId) => (itemId === root.itemId ? null : (cache.get(itemId) ?? null)), multiLevel);
      const ids = [...new Set([...r.rows.map((x) => x.itemId), ...r.requirements.map((x) => x.itemId)])];
      const its = ids.length ? await tx.select({ id: items.id, code: items.code, name: items.name, uom: uoms.code }).from(items).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(inArray(items.id, ids)) : [];
      const name = (id: string) => its.find((i) => i.id === id);
      return { qty, rows: r.rows.map((x) => ({ ...x, item: name(x.itemId) })), requirements: r.requirements.map((x) => ({ ...x, item: name(x.itemId) })) };
    });
  }

  private async costing(tx: Transaction, bomId: string) {
    const root = await this.data(tx, bomId);
    const cache = await this.defaultBoms(tx);
    const wcs = await tx.select().from(workCenters);
    const ids = new Set<string>();
    const collect = (b: BomData, seen: Set<string>) => {
      for (const l of b.lines) {
        ids.add(l.itemId);
        const c = cache.get(l.itemId);
        if (c && !seen.has(c.itemId)) collect(c, new Set([...seen, c.itemId]));
      }
    };
    collect(root, new Set([root.itemId]));
    const list = [...ids];
    const its = list.length ? await tx.select({ id: items.id, standardCost: items.standardCost, lastPurchaseRate: items.lastPurchaseRate }).from(items).where(inArray(items.id, list)) : [];
    const pools = list.length
      ? await tx
          .select({ itemId: stockValuation.itemId, qty: sql<string>`sum(${stockValuation.qty})::text`, value: sql<string>`sum(${stockValuation.value})::text` })
          .from(stockValuation)
          .innerJoin(warehouses, eq(warehouses.id, stockValuation.warehouseId))
          .where(inArray(stockValuation.itemId, list))
          .groupBy(stockValuation.itemId)
      : [];
    const itemCost = (id: string) => {
      const it = its.find((x) => x.id === id);
      if (it?.standardCost) return it.standardCost;
      const p = pools.find((x) => x.itemId === id);
      if (p && D(p.qty).cmp(D('0')) > 0) return D(p.value).div(D(p.qty)).toFixed(4);
      return it?.lastPurchaseRate ?? null;
    };
    const hourly = (wcId: string) => {
      const w = wcs.find((x) => x.id === wcId);
      return { labour: w?.labourRate ?? '0', machine: w?.machineRate ?? '0', overhead: w?.overheadRate ?? '0' };
    };
    return rollUp(root, { hourly, itemCost }, (itemId) => (itemId === root.itemId ? null : (cache.get(itemId) ?? null)));
  }

  private async storeCost(tx: Transaction, bomId: string) {
    const c = await this.costing(tx, bomId);
    await tx.update(boms).set({ materialCost: c.material, operationCost: c.operation, subcontractCost: c.subcontract, byproductCredit: c.byproductCredit, unitCost: c.unitCost }).where(eq(boms.id, bomId));
    return c;
  }

  /** Standard cost roll-up; `apply` writes it to the item's standard cost. */
  rollUp(auth: AuthContext, id: string, apply: boolean) {
    return this.database.run(auth, async (tx) => {
      const c = await this.storeCost(tx, id);
      const [b] = await tx.select({ itemId: boms.itemId }).from(boms).where(eq(boms.id, id));
      if (apply) {
        if (c.missing.length) throw new ConflictException('Some components have no cost yet; fix them before setting the standard cost');
        await tx.update(items).set({ standardCost: c.unitCost }).where(eq(items.id, b.itemId));
      }
      const ids = c.lines.map((l) => l.itemId).concat(c.missing);
      const its = ids.length ? await tx.select({ id: items.id, code: items.code, name: items.name }).from(items).where(inArray(items.id, ids)) : [];
      return { ...c, lines: c.lines.map((l) => ({ ...l, item: its.find((i) => i.id === l.itemId) })), missing: c.missing.map((m) => its.find((i) => i.id === m) ?? { id: m }), applied: apply };
    });
  }

  /** Where an item is used: BOMs listing it as a component. */
  whereUsed(auth: AuthContext, itemId: string) {
    return this.database.run(auth, async (tx) =>
      tx
        .select({ bomId: boms.id, number: documents.number, status: documents.status, version: boms.version, isDefault: boms.isDefault, parent: { id: items.id, code: items.code, name: items.name }, qty: bomLines.qty, perQty: boms.quantity })
        .from(bomLines)
        .innerJoin(boms, eq(boms.id, bomLines.bomId))
        .innerJoin(documents, eq(documents.id, boms.id))
        .innerJoin(items, eq(items.id, boms.itemId))
        .where(and(eq(bomLines.itemId, itemId), ne(documents.status, 'cancelled')))
        .orderBy(asc(items.code)),
    );
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('manufacturing.engineering.manage'), cancel: perms.has('manufacturing.engineering.manage') });
    const [b] = await tx.select().from(boms).where(eq(boms.id, doc.id));
    const [item] = await tx.select({ id: items.id, code: items.code, name: items.name, uom: uoms.code }).from(items).innerJoin(uoms, eq(uoms.id, items.baseUomId)).where(eq(items.id, b.itemId));
    const lines = await tx
      .select({ l: bomLines, code: items.code, name: items.name, uom: uoms.code })
      .from(bomLines)
      .innerJoin(items, eq(items.id, bomLines.itemId))
      .innerJoin(uoms, eq(uoms.id, bomLines.uomId))
      .where(eq(bomLines.bomId, doc.id))
      .orderBy(asc(bomLines.lineNo));
    const ops = await tx
      .select({ o: bomOperations, workCenter: workCenters.code, workCenterName: workCenters.name, tool: tools.code, vendor: parties.name })
      .from(bomOperations)
      .innerJoin(workCenters, eq(workCenters.id, bomOperations.workCenterId))
      .leftJoin(tools, eq(tools.id, bomOperations.toolId))
      .leftJoin(parties, eq(parties.id, bomOperations.vendorId))
      .where(eq(bomOperations.bomId, doc.id))
      .orderBy(asc(bomOperations.seq));
    const versions = await tx.select({ id: boms.id, version: boms.version, status: documents.status, isDefault: boms.isDefault, effectiveFrom: boms.effectiveFrom, effectiveTo: boms.effectiveTo }).from(boms).innerJoin(documents, eq(documents.id, boms.id)).where(eq(boms.itemId, b.itemId)).orderBy(desc(boms.version));
    const { tenantId: _t, id: _i, version: bomVersion, ...rest } = b;
    return {
      ...header,
      ...rest,
      bomVersion,
      item,
      lines: lines.map(({ l: { tenantId: _lt, bomId: _b, ...l }, ...more }) => ({ ...l, ...more })),
      operations: ops.map(({ o: { tenantId: _ot, bomId: _b2, ...o }, ...more }) => ({ ...o, ...more })),
      versions,
      canNewVersion: doc.status === 'approved' && perms.has('manufacturing.engineering.manage'),
    };
  }
}
