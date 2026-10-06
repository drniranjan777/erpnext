import { BadRequestException, ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { companies, documents, items, itemUomConversions, purchaseOrderLines, purchaseOrders, purchaseRequisitionLines, purchaseRequisitions, stockValuation, type Transaction, uoms, users, warehouses } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { CustomFieldsService } from '../customization/custom-fields.service';
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import type {
  CreateRequisitionInput,
  ListRequisitionsQuery,
  RequisitionLineInput,
  UpdateRequisitionInput,
} from './requisitions.schemas';

const DOC_TYPE = 'purchase_requisition' as const;

@Injectable()
export class RequisitionsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly customFields: CustomFieldsService,
    private readonly print: PrintService,
  ) {}

  onModuleInit() {
    this.print.registerContext(DOC_TYPE, (tx, auth, id) => this.printContext(tx, auth, id));
  }

  list(auth: AuthContext, q: ListRequisitionsQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          revision: documents.revision,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          amount: documents.amount,
          priority: purchaseRequisitions.priority,
          requiredBy: purchaseRequisitions.requiredBy,
          department: purchaseRequisitions.department,
          createdBy: users.fullName,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .innerJoin(purchaseRequisitions, eq(purchaseRequisitions.id, documents.id))
        .leftJoin(users, eq(users.id, documents.createdBy))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.mine === 'true' ? eq(documents.createdBy, auth.userId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(documents.title, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  /**
   * Draft requisition for every stock item at or below its reorder level.
   * Shortfall = reorder level − (available in nettable warehouses + still to receive on approved POs);
   * the line asks for at least the item's reorder quantity, in its purchase unit.
   */
  async fromReorder(auth: AuthContext, input: { warehouseId?: string | null; department?: string | null }, meta: RequestMeta) {
    const lines = await this.database.run(auth, async (tx) => {
      const available = tx
        .select({ itemId: stockValuation.itemId, qty: sql<string>`sum(${stockValuation.qty})`.as('available_qty') })
        .from(stockValuation)
        .innerJoin(warehouses, eq(warehouses.id, stockValuation.warehouseId))
        .where(and(eq(warehouses.isNettable, true), input.warehouseId ? eq(warehouses.id, input.warehouseId) : undefined))
        .groupBy(stockValuation.itemId)
        .as('available');
      const onOrder = tx
        .select({
          itemId: purchaseOrderLines.itemId,
          qty: sql<string>`sum(greatest(${purchaseOrderLines.qty} - ${purchaseOrderLines.receivedQty}, 0) * ${purchaseOrderLines.conversionFactor})`.as('on_order_qty'),
        })
        .from(purchaseOrderLines)
        .innerJoin(documents, eq(documents.id, purchaseOrderLines.poId))
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
        .where(and(eq(documents.status, 'approved'), isNull(purchaseOrders.closedAt)))
        .groupBy(purchaseOrderLines.itemId)
        .as('on_order');
      const rows = await tx
        .select({
          id: items.id,
          code: items.code,
          name: items.name,
          baseUomId: items.baseUomId,
          purchaseUomId: items.purchaseUomId,
          reorderLevel: items.reorderLevel,
          reorderQty: items.reorderQty,
          minOrderQty: items.minOrderQty,
          lastPurchaseRate: items.lastPurchaseRate,
          standardCost: items.standardCost,
          available: sql<string>`coalesce(${available.qty}, 0)::text`,
          onOrder: sql<string>`coalesce(${onOrder.qty}, 0)::text`,
        })
        .from(items)
        .leftJoin(available, eq(available.itemId, items.id))
        .leftJoin(onOrder, eq(onOrder.itemId, items.id))
        .where(
          and(
            eq(items.isStockItem, true),
            eq(items.isActive, true),
            isNull(items.deletedAt),
            sql`${items.reorderLevel} is not null`,
            sql`coalesce(${available.qty}, 0) + coalesce(${onOrder.qty}, 0) <= ${items.reorderLevel}`,
          ),
        )
        .orderBy(asc(items.code))
        .limit(200);
      if (!rows.length) return [];
      const convs = await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, rows.map((r) => r.id)));
      const unitRows = await tx.select({ id: uoms.id, code: uoms.code, decimals: uoms.decimals }).from(uoms);
      return rows.map((r) => {
        const D = Decimal.from;
        const shortfall = D(r.reorderLevel).sub(D(r.available)).sub(D(r.onOrder));
        let base = r.reorderQty && D(r.reorderQty).cmp(shortfall) > 0 ? D(r.reorderQty) : shortfall;
        if (r.minOrderQty && D(r.minOrderQty).cmp(base) > 0) base = D(r.minOrderQty);
        if (base.cmp(D('0')) <= 0) base = D(r.reorderQty ?? r.reorderLevel ?? '1');
        const uomId = r.purchaseUomId ?? r.baseUomId;
        const factor = uomId === r.baseUomId ? '1' : (convs.find((c) => c.itemId === r.id && c.uomId === uomId)?.factor ?? '1');
        const unit = unitRows.find((u) => u.id === uomId);
        let qty = base.div(D(factor));
        // Whole units (bags, boxes) round up.
        if (unit?.decimals === 0) qty = D(String(Math.ceil(Number(qty.toFixed(6)))));
        const baseRate = r.lastPurchaseRate ?? r.standardCost;
        const fmt = (d: string) => D(d).toFixed(4).replace(/\.?0+$/, '') || '0';
        return {
          itemId: r.id,
          uomId,
          itemCode: r.code,
          description: r.name,
          uom: unit?.code ?? 'NOS',
          quantity: qty.toFixed(4),
          estimatedRate: baseRate ? D(baseRate).mul(D(factor)).toFixed(4) : null,
          requiredBy: null,
          remarks: `Reorder: available ${fmt(r.available)}, on order ${fmt(r.onOrder)}, reorder level ${fmt(r.reorderLevel!)}`.slice(0, 300),
        };
      });
    });
    if (!lines.length) throw new ConflictException('No items are at or below their reorder level (counting stock already on order)');
    return this.create(
      auth,
      { priority: 'normal', department: input.department ?? null, purpose: `Replenishment: ${lines.length} item${lines.length === 1 ? '' : 's'} at reorder level`, notes: null, requiredBy: null, lines },
      meta,
    );
  }

  create(auth: AuthContext, input: CreateRequisitionInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const lines = this.priceLines(await this.linkItems(tx, input.lines));
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
      const doc = await this.documents.create(tx, auth, {
        customFields,
        docType: DOC_TYPE,
        companyId: input.companyId,
        branchId: input.branchId,
        docDate: input.docDate ?? todayIST(),
        title: this.title(input),
        amount: this.total(lines),
      });
      await tx.insert(purchaseRequisitions).values({
        id: doc.id,
        tenantId: auth.tenantId,
        requiredBy: input.requiredBy ?? null,
        department: input.department,
        purpose: input.purpose,
        priority: input.priority,
        notes: input.notes,
      });
      await this.writeLines(tx, auth, doc.id, lines);
      await this.documents.log(tx, auth, doc, 'document.created', meta, { lines: lines.length, amount: doc.amount });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: UpdateRequisitionInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const lines = this.priceLines(await this.linkItems(tx, input.lines));
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const updated = await this.documents.update(tx, auth, doc, {
        customFields,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}),
        title: this.title(input),
        amount: this.total(lines),
      });
      await tx
        .update(purchaseRequisitions)
        .set({
          requiredBy: input.requiredBy ?? null,
          department: input.department,
          purpose: input.purpose,
          priority: input.priority,
          notes: input.notes,
        })
        .where(eq(purchaseRequisitions.id, id));
      await tx.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.requisitionId, id));
      await this.writeLines(tx, auth, id, lines);
      await this.documents.activity(tx, auth, id, 'edited', 'Edited the requisition');
      await this.documents.log(tx, auth, updated, 'document.updated', meta, {
        lines: lines.length,
        amount: { from: doc.amount, to: updated.amount },
      });
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
      return this.view(tx, auth, await this.documents.submit(tx, auth, doc, meta));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  amend(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      const snapshot = await this.snapshot(tx, doc);
      return this.view(tx, auth, await this.documents.amend(tx, auth, doc, snapshot, reason, meta));
    });
  }

  // ---- helpers -----------------------------------------------------------------

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, {
      manage: perms.has('purchase.requisitions.manage'),
      cancel: perms.has('purchase.requisitions.cancel'),
    });
    const [pr] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, doc.id));
    const lines = await tx
      .select()
      .from(purchaseRequisitionLines)
      .where(eq(purchaseRequisitionLines.requisitionId, doc.id))
      .orderBy(asc(purchaseRequisitionLines.lineNo));
    return {
      ...header,
      requiredBy: pr?.requiredBy ?? null,
      department: pr?.department ?? null,
      purpose: pr?.purpose ?? null,
      priority: pr?.priority ?? 'normal',
      notes: pr?.notes ?? null,
      lines: lines.map(({ tenantId: _t, requisitionId: _r, ...l }) => l),
    };
  }

  /** Template context for print formats (see customization/default-templates.ts). */
  private async printContext(tx: Transaction, auth: AuthContext, id: string) {
    const doc = await this.documents.find(tx, id, DOC_TYPE);
    const view = await this.view(tx, auth, doc);
    const [company] = await tx.select({ gstin: companies.gstin, legalName: companies.legalName, address: companies.address }).from(companies).where(eq(companies.id, doc.companyId));
    const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
    const defs = await this.customFields.definitions(tx, DOC_TYPE, true);
    const STATUS: Record<string, string> = { draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed' };
    return {
      company: { ...view.company, ...company },
      branch: view.branch,
      doc: { ...view, statusLabel: STATUS[view.status] ?? view.status },
      requiredBy: view.requiredBy,
      priority: view.priority,
      department: view.department,
      purpose: view.purpose,
      notes: view.notes,
      lines: view.lines,
      customFields: defs
        .filter((f) => f.showInPrint)
        .map((f) => {
          const v = view.customFields[f.key];
          return { key: f.key, label: f.label, value: f.type === 'checkbox' ? (v ? 'Yes' : 'No') : v === null || v === undefined || v === '' ? '—' : String(v) };
        }),
      approvals: view.approvals.filter((s) => s.status === 'approved'),
      printedBy: printer?.name ?? '',
      printedAt: new Date().toISOString(),
    };
  }

  private async snapshot(tx: Transaction, doc: DocumentRow) {
    const [pr] = await tx.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, doc.id));
    const lines = await tx
      .select()
      .from(purchaseRequisitionLines)
      .where(eq(purchaseRequisitionLines.requisitionId, doc.id))
      .orderBy(asc(purchaseRequisitionLines.lineNo));
    return { header: doc, requisition: pr, lines } as unknown as Record<string, unknown>;
  }

  /**
   * Lines picked from the item master get the item's code and the unit's code filled in,
   * and the unit must be the item's base unit or one it has a conversion for.
   */
  private async linkItems(tx: Transaction, lines: RequisitionLineInput[]): Promise<RequisitionLineInput[]> {
    const itemIds = [...new Set(lines.map((l) => l.itemId).filter((v): v is string => !!v))];
    const uomIds = [...new Set(lines.map((l) => l.uomId).filter((v): v is string => !!v))];
    const itemRows = itemIds.length ? await tx.select({ id: items.id, code: items.code, isActive: items.isActive, baseUomId: items.baseUomId, purchaseUomId: items.purchaseUomId }).from(items).where(inArray(items.id, itemIds)) : [];
    const uomRows = uomIds.length || itemRows.length ? await tx.select({ id: uoms.id, code: uoms.code }).from(uoms).where(inArray(uoms.id, [...uomIds, ...itemRows.map((i) => i.purchaseUomId ?? i.baseUomId)])) : [];
    const convs = itemIds.length ? await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, itemIds)) : [];
    const errors: { path: string; message: string }[] = [];
    const out = lines.map((l, i) => {
      if (!l.itemId) {
        if (l.uomId) {
          const u = uomRows.find((x) => x.id === l.uomId);
          if (!u) errors.push({ path: `lines.${i}.uomId`, message: 'Unknown unit' });
          return { ...l, uom: u?.code ?? l.uom };
        }
        return l;
      }
      const item = itemRows.find((x) => x.id === l.itemId);
      if (!item) {
        errors.push({ path: `lines.${i}.itemId`, message: 'Unknown item' });
        return l;
      }
      if (!item.isActive) errors.push({ path: `lines.${i}.itemId`, message: `${item.code} is inactive` });
      const uomId = l.uomId ?? item.purchaseUomId ?? item.baseUomId;
      if (uomId !== item.baseUomId && !convs.some((c) => c.itemId === item.id && c.uomId === uomId)) {
        errors.push({ path: `lines.${i}.uomId`, message: `${item.code} has no conversion for this unit` });
      }
      return { ...l, uomId, itemCode: item.code, uom: uomRows.find((u) => u.id === uomId)?.code ?? l.uom };
    });
    if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
    return out;
  }

  private priceLines(lines: RequisitionLineInput[]) {
    return lines.map((l, i) => ({
      ...l,
      lineNo: i + 1,
      estimatedAmount: l.estimatedRate ? Decimal.from(l.quantity).mul(Decimal.from(l.estimatedRate)).toFixed(2) : null,
    }));
  }

  private total(lines: { estimatedAmount: string | null }[]) {
    return lines.some((l) => l.estimatedAmount) ? Decimal.sum(lines.map((l) => l.estimatedAmount)).toFixed(2) : null;
  }

  private title(input: { purpose?: string | null; lines: { description: string }[] }) {
    if (input.purpose) return input.purpose.slice(0, 200);
    const [first, ...rest] = input.lines;
    return `${first.description.slice(0, 120)}${rest.length ? ` + ${rest.length} more` : ''}`;
  }

  private async writeLines(tx: Transaction, auth: AuthContext, requisitionId: string, lines: ReturnType<RequisitionsService['priceLines']>) {
    await tx.insert(purchaseRequisitionLines).values(
      lines.map((l) => ({
        tenantId: auth.tenantId,
        requisitionId,
        lineNo: l.lineNo,
        itemId: l.itemId ?? null,
        uomId: l.uomId ?? null,
        itemCode: l.itemCode,
        description: l.description,
        uom: l.uom,
        quantity: l.quantity,
        estimatedRate: l.estimatedRate ?? null,
        estimatedAmount: l.estimatedAmount,
        requiredBy: l.requiredBy ?? null,
        remarks: l.remarks,
      })),
    );
  }
}
