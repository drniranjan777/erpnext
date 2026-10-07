import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  documents,
  itemUomConversions,
  items,
  stockEntries,
  stockEntryLines,
  type Transaction,
  uoms,
  users,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, or } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { CustomFieldsService } from '../customization/custom-fields.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import type { CreateStockEntryInput, ListStockEntriesQuery, Purpose, StockEntryLineInput, UpdateStockEntryInput } from './inventory.schemas';
import { StockService, type StockMove, type Voucher } from './stock.service';

const DOC_TYPE = 'stock_entry' as const;

const PURPOSE_LABEL: Record<Purpose, string> = {
  opening_stock: 'Opening stock',
  material_receipt: 'Material receipt',
  material_issue: 'Material issue',
  transfer: 'Transfer',
  adjustment: 'Stock adjustment',
};

type PreparedLine = StockEntryLineInput & {
  lineNo: number;
  uomId: string;
  conversionFactor: string;
  baseQty: string;
  amount: string | null;
};

type Err = { path: string; message: string };

@Injectable()
export class StockEntriesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly customFields: CustomFieldsService,
    private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
      onCancelled: (tx, auth, doc) => this.stock.reverseVoucher(tx, auth, this.voucher(doc)),
    });
  }

  list(auth: AuthContext, q: ListStockEntriesQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          amount: documents.amount,
          purpose: stockEntries.purpose,
          fromWarehouseId: stockEntries.fromWarehouseId,
          toWarehouseId: stockEntries.toWarehouseId,
          reference: stockEntries.reference,
          createdBy: users.fullName,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .innerJoin(stockEntries, eq(stockEntries.id, documents.id))
        .leftJoin(users, eq(users.id, documents.createdBy))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.purpose ? eq(stockEntries.purpose, q.purpose) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(documents.title, `%${term}%`), ilike(stockEntries.reference, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const whIds = [...new Set(page.flatMap((r) => [r.fromWarehouseId, r.toWarehouseId]).filter((w): w is string => !!w))];
      const whs = whIds.length ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, whIds)) : [];
      const wh = new Map(whs.map((w) => [w.id, w]));
      return {
        items: page.map((r) => ({
          ...r,
          purposeLabel: PURPOSE_LABEL[r.purpose],
          fromWarehouse: r.fromWarehouseId ? (wh.get(r.fromWarehouseId) ?? null) : null,
          toWarehouse: r.toWarehouseId ? (wh.get(r.toWarehouseId) ?? null) : null,
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE)));
  }

  create(auth: AuthContext, input: CreateStockEntryInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  /** Same as create(), inside the caller's transaction (used by imports). */
  async createTx(tx: Transaction, auth: AuthContext, input: CreateStockEntryInput, meta: RequestMeta) {
    const lines = await this.prepare(tx, input);
    const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
    const doc = await this.documents.create(tx, auth, {
      customFields,
      docType: DOC_TYPE,
      companyId: input.companyId,
      branchId: input.branchId,
      docDate: input.docDate ?? todayIST(),
      title: await this.title(tx, input, lines),
      amount: this.total(lines),
    });
    await this.checkCompany(tx, doc.companyId, input);
    await tx.insert(stockEntries).values({
      id: doc.id,
      tenantId: auth.tenantId,
      purpose: input.purpose,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      reason: input.reason,
      reference: input.reference,
      notes: input.notes,
    });
    await this.writeLines(tx, auth, doc.id, lines);
    await this.documents.log(tx, auth, doc, 'document.created', meta, { purpose: input.purpose, lines: lines.length });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: UpdateStockEntryInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const lines = await this.prepare(tx, input);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const updated = await this.documents.update(tx, auth, doc, {
        customFields,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}),
        title: await this.title(tx, input, lines),
        amount: this.total(lines),
      });
      await this.checkCompany(tx, updated.companyId, input);
      await tx
        .update(stockEntries)
        .set({
          purpose: input.purpose,
          fromWarehouseId: input.fromWarehouseId ?? null,
          toWarehouseId: input.toWarehouseId ?? null,
          reason: input.reason,
          reference: input.reference,
          notes: input.notes,
        })
        .where(eq(stockEntries.id, id));
      await tx.delete(stockEntryLines).where(eq(stockEntryLines.entryId, id));
      await this.writeLines(tx, auth, id, lines);
      await this.documents.activity(tx, auth, id, 'edited', 'Edited the stock entry');
      await this.documents.log(tx, auth, updated, 'document.updated', meta, { lines: lines.length });
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
    return this.database.run(auth, (tx) => this.submitTx(tx, auth, id, version, meta));
  }

  async submitTx(tx: Transaction, auth: AuthContext, id: string, version: number, meta: RequestMeta) {
    const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
    await this.documents.submit(tx, auth, doc, meta);
    // Posting may have updated the amount (issues are valued at posting time).
    return this.view(tx, auth, await this.documents.find(tx, id, DOC_TYPE));
  }

  cancel(auth: AuthContext, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, version);
      return this.view(tx, auth, await this.documents.cancel(tx, auth, doc, reason, meta));
    });
  }

  // ---- posting -------------------------------------------------------------------

  /** Called by DocumentsService when the entry is approved: moves the stock. */
  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [entry] = await tx.select().from(stockEntries).where(eq(stockEntries.id, doc.id));
    const lines = await tx.select().from(stockEntryLines).where(eq(stockEntryLines.entryId, doc.id)).orderBy(asc(stockEntryLines.lineNo));
    const voucher = this.voucher(doc);
    const base = (l: (typeof lines)[number]): Omit<StockMove, 'warehouseId' | 'qty'> => ({
      itemId: l.itemId,
      rate: l.rate ? Decimal.from(l.rate).div(Decimal.from(l.conversionFactor)).toFixed(6) : null,
      batchNo: l.batchNo,
      mfgDate: l.mfgDate,
      expiryDate: l.expiryDate,
      serialNos: l.serialNos,
      line: l.lineNo,
    });
    const neg = (q: string) => Decimal.from('0').sub(Decimal.from(q)).toFixed(4);

    let posted;
    switch (entry.purpose) {
      case 'opening_stock':
      case 'material_receipt':
        posted = await this.stock.post(tx, auth, voucher, lines.map((l) => ({ ...base(l), warehouseId: entry.toWarehouseId!, qty: l.baseQty })));
        break;
      case 'material_issue':
        posted = await this.stock.post(tx, auth, voucher, lines.map((l) => ({ ...base(l), rate: null, warehouseId: entry.fromWarehouseId!, qty: neg(l.baseQty) })));
        break;
      case 'adjustment': {
        const wh = (entry.toWarehouseId ?? entry.fromWarehouseId)!;
        posted = await this.stock.post(tx, auth, voucher, lines.map((l) => ({ ...base(l), warehouseId: wh, qty: l.baseQty, allowExpired: true, allowHeld: true })));
        break;
      }
      case 'transfer': {
        // Out of the source at its valuation, into the target at exactly that cost.
        const [target] = await tx.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, entry.toWarehouseId!));
        const writeOff = target?.type === 'scrap' || target?.type === 'rejected';
        const out = await this.stock.post(
          tx,
          auth,
          voucher,
          lines.map((l) => ({ ...base(l), rate: null, warehouseId: entry.fromWarehouseId!, qty: neg(l.baseQty), allowExpired: writeOff, allowHeld: true })),
        );
        await this.stock.post(
          tx,
          auth,
          voucher,
          lines.map((l, i) => ({ ...base(l), warehouseId: entry.toWarehouseId!, qty: l.baseQty, rate: out[i].rate, allowExpired: true })),
        );
        posted = out;
        break;
      }
    }

    // Record the actual values on the lines and the document.
    let total = Decimal.from('0');
    for (const [i, l] of lines.entries()) {
      const value = Decimal.from(posted[i].value);
      const abs = value.isNegative() ? Decimal.from('0').sub(value) : value;
      total = total.add(abs);
      const rate = Decimal.from(l.qty).isZero() ? '0' : abs.div(Decimal.from(l.qty.replace('-', ''))).toFixed(4);
      await tx.update(stockEntryLines).set({ rate, amount: abs.toFixed(2) }).where(eq(stockEntryLines.id, l.id));
    }
    await tx.update(documents).set({ amount: total.toFixed(2) }).where(eq(documents.id, doc.id));
  }

  private voucher(doc: DocumentRow): Voucher {
    return { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };
  }

  // ---- validation ----------------------------------------------------------------

  private async prepare(tx: Transaction, input: CreateStockEntryInput): Promise<PreparedLine[]> {
    const errors: Err[] = [];
    const { purpose, fromWarehouseId: from, toWarehouseId: to } = input;
    const needsFrom = purpose === 'material_issue' || purpose === 'transfer';
    const needsTo = purpose === 'opening_stock' || purpose === 'material_receipt' || purpose === 'transfer';
    if (needsFrom && !from) errors.push({ path: 'fromWarehouseId', message: 'Choose the source warehouse' });
    if (needsTo && !to) errors.push({ path: 'toWarehouseId', message: 'Choose the target warehouse' });
    if (purpose === 'adjustment' && !from && !to) errors.push({ path: 'toWarehouseId', message: 'Choose the warehouse to adjust' });
    if (purpose === 'transfer' && from && to && from === to) errors.push({ path: 'toWarehouseId', message: 'Source and target must be different' });
    if (purpose === 'adjustment' && !input.reason) errors.push({ path: 'reason', message: 'Enter a reason for the adjustment' });

    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const itemRows = await tx
      .select({ id: items.id, code: items.code, name: items.name, baseUomId: items.baseUomId, isStockItem: items.isStockItem, trackBatch: items.trackBatch, trackSerial: items.trackSerial, isActive: items.isActive })
      .from(items)
      .where(inArray(items.id, itemIds));
    const itemMap = new Map(itemRows.map((i) => [i.id, i]));
    const convs = await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, itemIds));

    const lines: PreparedLine[] = input.lines.map((l, i) => {
      const p = `lines.${i}`;
      const it = itemMap.get(l.itemId);
      const qty = Decimal.from(l.qty);
      if (!it) {
        errors.push({ path: `${p}.itemId`, message: 'Unknown item' });
        return { ...l, lineNo: i + 1, uomId: l.uomId ?? '', conversionFactor: '1', baseQty: l.qty, amount: null };
      }
      if (!it.isStockItem) errors.push({ path: `${p}.itemId`, message: `${it.code} is not a stock item` });
      if (!it.isActive) errors.push({ path: `${p}.itemId`, message: `${it.code} is inactive` });
      if (qty.isNegative() && purpose !== 'adjustment') errors.push({ path: `${p}.qty`, message: 'Quantity must be more than zero' });
      if (purpose === 'opening_stock' && !l.rate) errors.push({ path: `${p}.rate`, message: 'Enter the opening rate' });
      if (it.trackBatch && !l.batchNo) errors.push({ path: `${p}.batchNo`, message: `${it.code} needs a batch number` });
      if (it.trackSerial && Math.abs(Number(l.qty)) !== (l.serialNos?.length ?? 0)) {
        errors.push({ path: `${p}.serialNos`, message: `Enter ${Math.abs(Number(l.qty))} serial number(s)` });
      }
      const uomId = l.uomId ?? it.baseUomId;
      let factor = '1';
      if (uomId !== it.baseUomId) {
        const c = convs.find((c) => c.itemId === it.id && c.uomId === uomId);
        if (!c) errors.push({ path: `${p}.uomId`, message: `No conversion from this unit to ${it.code}'s base unit` });
        else factor = c.factor;
      }
      if (it.trackSerial && factor !== '1' && Decimal.from(factor).cmp(Decimal.from('1')) !== 0) {
        errors.push({ path: `${p}.uomId`, message: 'Serialised items are entered in their base unit' });
      }
      const baseQty = qty.mul(Decimal.from(factor)).toFixed(4);
      const amount = l.rate ? (qty.isNegative() ? Decimal.from('0').sub(qty) : qty).mul(Decimal.from(l.rate)).toFixed(2) : null;
      return { ...l, lineNo: i + 1, uomId, conversionFactor: factor, baseQty, amount, serialNos: l.serialNos?.map((s) => s.trim().toUpperCase()) ?? null };
    });

    const whIds = [from, to].filter((w): w is string => !!w);
    if (whIds.length) {
      const whs = await tx.select({ id: warehouses.id, isActive: warehouses.isActive }).from(warehouses).where(inArray(warehouses.id, whIds));
      if (from && !whs.some((w) => w.id === from)) errors.push({ path: 'fromWarehouseId', message: 'Unknown warehouse' });
      if (to && !whs.some((w) => w.id === to)) errors.push({ path: 'toWarehouseId', message: 'Unknown warehouse' });
      for (const w of whs) if (!w.isActive) errors.push({ path: w.id === from ? 'fromWarehouseId' : 'toWarehouseId', message: 'Warehouse is inactive' });
    }
    if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
    return lines;
  }

  private async checkCompany(tx: Transaction, companyId: string, input: CreateStockEntryInput) {
    const whIds = [input.fromWarehouseId, input.toWarehouseId].filter((w): w is string => !!w);
    if (!whIds.length) return;
    const whs = await tx.select({ id: warehouses.id, companyId: warehouses.companyId, code: warehouses.code }).from(warehouses).where(inArray(warehouses.id, whIds));
    const other = whs.find((w) => w.companyId !== companyId);
    if (other) throw new BadRequestException(`Warehouse ${other.code} belongs to another company`);
  }

  private total(lines: PreparedLine[]) {
    return lines.some((l) => l.amount) ? Decimal.sum(lines.map((l) => l.amount)).toFixed(2) : null;
  }

  private async title(tx: Transaction, input: CreateStockEntryInput, lines: PreparedLine[]) {
    const [first] = await tx.select({ name: items.name }).from(items).where(eq(items.id, lines[0].itemId));
    const rest = lines.length - 1;
    return `${PURPOSE_LABEL[input.purpose]}: ${first?.name ?? 'item'}${rest ? ` + ${rest} more` : ''}`.slice(0, 200);
  }

  private async writeLines(tx: Transaction, auth: AuthContext, entryId: string, lines: PreparedLine[]) {
    await tx.insert(stockEntryLines).values(
      lines.map((l) => ({
        tenantId: auth.tenantId,
        entryId,
        lineNo: l.lineNo,
        itemId: l.itemId,
        uomId: l.uomId,
        qty: l.qty,
        conversionFactor: l.conversionFactor,
        baseQty: l.baseQty,
        rate: l.rate ?? null,
        amount: l.amount,
        batchNo: l.batchNo ?? null,
        mfgDate: l.mfgDate ?? null,
        expiryDate: l.expiryDate ?? null,
        serialNos: l.serialNos ?? null,
        remarks: l.remarks,
      })),
    );
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, {
      manage: perms.has('inventory.entries.manage'),
      cancel: perms.has('inventory.entries.cancel'),
    });
    const [entry] = await tx.select().from(stockEntries).where(eq(stockEntries.id, doc.id));
    const lines = await tx
      .select({
        line: stockEntryLines,
        itemCode: items.code,
        itemName: items.name,
        uomCode: uoms.code,
      })
      .from(stockEntryLines)
      .innerJoin(items, eq(items.id, stockEntryLines.itemId))
      .innerJoin(uoms, eq(uoms.id, stockEntryLines.uomId))
      .where(eq(stockEntryLines.entryId, doc.id))
      .orderBy(asc(stockEntryLines.lineNo));
    const whIds = [entry?.fromWarehouseId, entry?.toWarehouseId].filter((w): w is string => !!w);
    const whs = whIds.length ? await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, whIds)) : [];
    const wh = (id: string | null | undefined) => (id ? (whs.find((w) => w.id === id) ?? null) : null);
    return {
      ...header,
      purpose: entry.purpose,
      purposeLabel: PURPOSE_LABEL[entry.purpose],
      fromWarehouse: wh(entry.fromWarehouseId),
      toWarehouse: wh(entry.toWarehouseId),
      reason: entry.reason,
      reference: entry.reference,
      notes: entry.notes,
      lines: lines.map(({ line: { tenantId: _t, entryId: _e, ...l }, itemCode, itemName, uomCode }) => ({ ...l, itemCode, itemName, uomCode })),
    };
  }
}
