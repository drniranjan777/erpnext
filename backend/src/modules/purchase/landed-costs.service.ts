import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  documents,
  goodsReceiptLines,
  goodsReceipts,
  items,
  landedCostAllocations,
  landedCostCharges,
  landedCostReceipts,
  landedCosts,
  parties,
  type Transaction,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService } from '../inventory/stock.service';
import type { CreateLcInput } from './invoices.schemas';

const DOC_TYPE = 'landed_cost' as const;
const D = Decimal.from;
const ZERO = D('0');
type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

/**
 * Landed cost voucher: freight, customs duty, insurance, clearing... spread over the stock
 * lines of one or more goods receipts by value, quantity or weight, and added to stock value
 * when approved. Charges are before GST (their GST is claimed on the transporter's / CHA's bill).
 */
@Injectable()
export class LandedCostsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
      onCancelled: async (tx, auth, doc) => {
        await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
        await tx.update(landedCostAllocations).set({ absorbed: '0', unabsorbed: '0' }).where(eq(landedCostAllocations.landedCostId, doc.id));
        await tx.update(landedCosts).set({ unabsorbed: '0' }).where(eq(landedCosts.id, doc.id));
      },
    });
  }

  list(auth: AuthContext, q: { status?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, title: documents.title, method: landedCosts.method, totalCharges: landedCosts.totalCharges, unabsorbed: landedCosts.unabsorbed })
        .from(documents)
        .innerJoin(landedCosts, eq(landedCosts.id, documents.id))
        .where(and(eq(documents.docType, DOC_TYPE), q.status ? eq(documents.status, q.status as DocumentRow['status']) : undefined, q.cursor ? lt(documents.id, q.cursor) : undefined))
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

  create(auth: AuthContext, input: CreateLcInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const grns = await this.receipts(tx, input.grnIds);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId: grns[0].companyId, branchId: grns[0].branchId, docDate: input.docDate ?? todayIST(), title: null, amount: null });
      await this.save(tx, auth, doc, input, grns, false);
      const updated = await this.documents.update(tx, auth, doc, { title: this.title(input, grns), amount: this.total(input) });
      await this.documents.log(tx, auth, updated, 'document.created', meta, { receipts: grns.map((g) => g.number), amount: updated.amount });
      return this.view(tx, auth, updated);
    });
  }

  update(auth: AuthContext, id: string, input: CreateLcInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const grns = await this.receipts(tx, input.grnIds);
      if (grns.some((g) => g.companyId !== doc.companyId)) fail([{ path: 'grnIds', message: 'All receipts must belong to the same company' }]);
      await this.save(tx, auth, doc, input, grns, true);
      const updated = await this.documents.update(tx, auth, doc, { ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}), title: this.title(input, grns), amount: this.total(input) });
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
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
    });
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  // ---- posting -------------------------------------------------------------------

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const allocations = await tx.select().from(landedCostAllocations).where(eq(landedCostAllocations.landedCostId, doc.id));
    const grnLines = await tx.select({ id: goodsReceiptLines.id, acceptedBaseQty: goodsReceiptLines.acceptedBaseQty }).from(goodsReceiptLines).where(inArray(goodsReceiptLines.id, allocations.map((a) => a.grnLineId)));
    const result = await this.stock.revalue(
      tx,
      auth,
      { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate },
      allocations.map((a) => ({ itemId: a.itemId, warehouseId: a.warehouseId, value: a.amount, basisQty: grnLines.find((g) => g.id === a.grnLineId)?.acceptedBaseQty })),
    );
    let unabsorbed = ZERO;
    for (const [i, a] of allocations.entries()) {
      unabsorbed = unabsorbed.add(D(result[i].unabsorbed));
      await tx.update(landedCostAllocations).set({ absorbed: result[i].absorbed, unabsorbed: result[i].unabsorbed }).where(eq(landedCostAllocations.id, a.id));
    }
    await tx.update(landedCosts).set({ unabsorbed: unabsorbed.toFixed(2) }).where(eq(landedCosts.id, doc.id));
  }

  // ---- helpers -----------------------------------------------------------------------

  private async receipts(tx: Transaction, grnIds: string[]) {
    const rows = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, companyId: documents.companyId, branchId: documents.branchId, warehouseId: goodsReceipts.warehouseId })
      .from(goodsReceipts)
      .innerJoin(documents, eq(documents.id, goodsReceipts.id))
      .where(inArray(goodsReceipts.id, grnIds));
    const errors: Err[] = [];
    if (rows.length !== new Set(grnIds).size) errors.push({ path: 'grnIds', message: 'Goods receipt not found' });
    for (const r of rows) if (r.status !== 'approved') errors.push({ path: 'grnIds', message: `${r.number ?? 'Draft GRN'} is not posted` });
    if (new Set(rows.map((r) => r.companyId)).size > 1) errors.push({ path: 'grnIds', message: 'All receipts must belong to the same company' });
    if (errors.length) fail(errors);
    return rows;
  }

  /** Stores the charges and splits their total over the receipts' stock lines (paise exact). */
  private async save(tx: Transaction, auth: AuthContext, doc: DocumentRow, input: CreateLcInput, grns: Awaited<ReturnType<LandedCostsService['receipts']>>, replace: boolean) {
    const lines = await tx
      .select({ l: goodsReceiptLines, isStockItem: items.isStockItem, weight: items.netWeightKg, code: items.code })
      .from(goodsReceiptLines)
      .innerJoin(items, eq(items.id, goodsReceiptLines.itemId))
      .where(inArray(goodsReceiptLines.grnId, grns.map((g) => g.id)))
      .orderBy(asc(goodsReceiptLines.grnId), asc(goodsReceiptLines.lineNo));
    const stockLines = lines.filter((x) => x.isStockItem && D(x.l.acceptedBaseQty).cmp(ZERO) > 0);
    if (!stockLines.length) fail([{ path: 'grnIds', message: 'These receipts have no stock accepted to add costs to' }]);
    const missingWeight = input.method === 'weight' ? stockLines.filter((x) => !x.weight || D(x.weight).isZero()) : [];
    if (missingWeight.length) fail([{ path: 'method', message: `Set the net weight on ${[...new Set(missingWeight.map((x) => x.code))].join(', ')} to split by weight` }]);
    if (input.charges.some((c) => c.vendorId)) {
      const ids = input.charges.map((c) => c.vendorId).filter((v): v is string => !!v);
      const found = await tx.select({ id: parties.id }).from(parties).where(inArray(parties.id, ids));
      if (found.length !== new Set(ids).size) fail([{ path: 'charges', message: 'Unknown vendor on a charge' }]);
    }

    const basis = stockLines.map((x) => (input.method === 'value' ? D(x.l.amount) : input.method === 'qty' ? D(x.l.acceptedBaseQty) : D(x.l.acceptedBaseQty).mul(D(x.weight!))));
    const totalBasis = basis.reduce((s, b) => s.add(b), ZERO);
    if (totalBasis.isZero()) fail([{ path: 'method', message: 'Nothing to split on: the receipts have zero value' }]);
    const total = D(this.total(input));
    let given = ZERO;
    const shares = stockLines.map((_, i) => {
      if (i === stockLines.length - 1) return total.sub(given);
      const s = D(total.mul(basis[i]).div(totalBasis).toFixed(2));
      given = given.add(s);
      return s;
    });

    if (replace) {
      await tx.delete(landedCostReceipts).where(eq(landedCostReceipts.landedCostId, doc.id));
      await tx.delete(landedCostCharges).where(eq(landedCostCharges.landedCostId, doc.id));
      await tx.delete(landedCostAllocations).where(eq(landedCostAllocations.landedCostId, doc.id));
      await tx.update(landedCosts).set({ method: input.method, totalCharges: total.toFixed(2), notes: input.notes }).where(eq(landedCosts.id, doc.id));
    } else {
      await tx.insert(landedCosts).values({ id: doc.id, tenantId: auth.tenantId, method: input.method, totalCharges: total.toFixed(2), notes: input.notes });
    }
    await tx.insert(landedCostReceipts).values(grns.map((g) => ({ tenantId: auth.tenantId, landedCostId: doc.id, grnId: g.id })));
    await tx.insert(landedCostCharges).values(
      input.charges.map((c, i) => ({ tenantId: auth.tenantId, landedCostId: doc.id, lineNo: i + 1, chargeType: c.chargeType, description: c.description, vendorId: c.vendorId ?? null, billRef: c.billRef, amount: D(c.amount).toFixed(2) })),
    );
    await tx.insert(landedCostAllocations).values(
      stockLines.map((x, i) => ({
        tenantId: auth.tenantId,
        landedCostId: doc.id,
        grnLineId: x.l.id,
        itemId: x.l.itemId,
        warehouseId: grns.find((g) => g.id === x.l.grnId)!.warehouseId,
        basis: basis[i].toFixed(4),
        amount: shares[i].toFixed(2),
      })),
    );
  }

  private total(input: CreateLcInput) {
    return Decimal.sum(input.charges.map((c) => c.amount)).toFixed(2);
  }

  private title(input: CreateLcInput, grns: { number: string | null }[]) {
    const kinds = [...new Set(input.charges.map((c) => c.chargeType.replace('_', ' ')))].join(', ');
    return `${kinds} on ${grns.map((g) => g.number).join(', ')}`.slice(0, 200);
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('purchase.invoices.manage'), cancel: perms.has('purchase.invoices.cancel') });
    const [lc] = await tx.select().from(landedCosts).where(eq(landedCosts.id, doc.id));
    const receipts = await tx
      .select({ id: documents.id, number: documents.number, docDate: documents.docDate })
      .from(landedCostReceipts)
      .innerJoin(documents, eq(documents.id, landedCostReceipts.grnId))
      .where(eq(landedCostReceipts.landedCostId, doc.id));
    const charges = await tx
      .select({ id: landedCostCharges.id, lineNo: landedCostCharges.lineNo, chargeType: landedCostCharges.chargeType, description: landedCostCharges.description, billRef: landedCostCharges.billRef, amount: landedCostCharges.amount, vendor: { id: parties.id, name: parties.name } })
      .from(landedCostCharges)
      .leftJoin(parties, eq(parties.id, landedCostCharges.vendorId))
      .where(eq(landedCostCharges.landedCostId, doc.id))
      .orderBy(asc(landedCostCharges.lineNo));
    const allocations = await tx
      .select({ id: landedCostAllocations.id, grnLineId: landedCostAllocations.grnLineId, itemId: items.id, itemCode: items.code, itemName: items.name, warehouseCode: warehouses.code, basis: landedCostAllocations.basis, amount: landedCostAllocations.amount, absorbed: landedCostAllocations.absorbed, unabsorbed: landedCostAllocations.unabsorbed })
      .from(landedCostAllocations)
      .innerJoin(items, eq(items.id, landedCostAllocations.itemId))
      .innerJoin(warehouses, eq(warehouses.id, landedCostAllocations.warehouseId))
      .where(eq(landedCostAllocations.landedCostId, doc.id));
    return { ...header, method: lc.method, totalCharges: lc.totalCharges, unabsorbed: lc.unabsorbed, notes: lc.notes, receipts, charges: charges.map((c) => ({ ...c, vendor: c.vendor?.id ? c.vendor : null })), allocations };
  }
}
