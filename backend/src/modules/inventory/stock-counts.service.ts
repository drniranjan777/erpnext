import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  batches,
  documents,
  itemGroups,
  items,
  stockBalances,
  stockCountLines,
  stockCounts,
  stockValuation,
  type Transaction,
  uoms,
  users,
  warehouses,
} from '@nextgen/database';
import { and, asc, desc, eq, inArray, lt, max, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { CustomFieldsService } from '../customization/custom-fields.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import type { AddCountLineInput, CreateStockCountInput, ListStockCountsQuery, RecordCountsInput, UpdateStockCountInput } from './inventory.schemas';
import { NO_BATCH, StockService, type StockMove } from './stock.service';

const DOC_TYPE = 'stock_count' as const;
const MAX_LINES = 5000;
const EDITABLE = ['draft', 'rejected'];

@Injectable()
export class StockCountsService implements OnModuleInit {
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
      onCancelled: (tx, auth, doc) => this.stock.reverseVoucher(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }),
    });
  }

  list(auth: AuthContext, q: ListStockCountsQuery) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          title: documents.title,
          amount: documents.amount,
          warehouse: { id: warehouses.id, code: warehouses.code, name: warehouses.name },
          group: itemGroups.name,
          lines: sql<number>`(select count(*)::int from ${stockCountLines} l where l.count_id = ${documents.id})`,
          counted: sql<number>`(select count(*)::int from ${stockCountLines} l where l.count_id = ${documents.id} and l.counted_qty is not null)`,
          createdBy: users.fullName,
        })
        .from(documents)
        .innerJoin(stockCounts, eq(stockCounts.id, documents.id))
        .innerJoin(warehouses, eq(warehouses.id, stockCounts.warehouseId))
        .leftJoin(itemGroups, eq(itemGroups.id, stockCounts.itemGroupId))
        .leftJoin(users, eq(users.id, documents.createdBy))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status) : undefined,
            q.warehouseId ? eq(stockCounts.warehouseId, q.warehouseId) : undefined,
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

  /** Creates the count and snapshots the book quantities of the warehouse (or item group). */
  create(auth: AuthContext, input: CreateStockCountInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, input.warehouseId));
      if (!wh) throw new BadRequestException({ message: 'Unknown warehouse', errors: [{ path: 'warehouseId', message: 'Unknown warehouse' }] });
      if (!wh.isActive) throw new BadRequestException({ message: 'Warehouse is inactive', errors: [{ path: 'warehouseId', message: 'Warehouse is inactive' }] });
      let groupName: string | null = null;
      if (input.itemGroupId) {
        const [g] = await tx.select({ name: itemGroups.name }).from(itemGroups).where(eq(itemGroups.id, input.itemGroupId));
        if (!g) throw new BadRequestException({ message: 'Unknown item group', errors: [{ path: 'itemGroupId', message: 'Unknown item group' }] });
        groupName = g.name;
      }
      const lines = await this.snapshot(tx, input.warehouseId, input.itemGroupId ?? null, input.includeZeroStock);
      if (!lines.length) throw new BadRequestException('Nothing to count: no stock items match. Tick "include items with no stock" to count them anyway.');
      if (lines.length > MAX_LINES) throw new BadRequestException(`That's ${lines.length} lines. Count up to ${MAX_LINES} at a time: pick an item group.`);

      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields);
      const doc = await this.documents.create(tx, auth, {
        customFields,
        docType: DOC_TYPE,
        companyId: input.companyId ?? wh.companyId,
        branchId: input.branchId ?? wh.branchId ?? undefined,
        docDate: input.docDate ?? todayIST(),
        title: `Count of ${wh.code}${groupName ? ` · ${groupName}` : ''} (${lines.length} lines)`,
        amount: null,
      });
      if (doc.companyId !== wh.companyId) throw new BadRequestException(`Warehouse ${wh.code} belongs to another company`);
      await tx.insert(stockCounts).values({ id: doc.id, tenantId: auth.tenantId, warehouseId: wh.id, itemGroupId: input.itemGroupId ?? null, blind: input.blind, notes: input.notes });
      for (let i = 0; i < lines.length; i += 1000) {
        await tx.insert(stockCountLines).values(lines.slice(i, i + 1000).map((l, j) => ({ ...l, tenantId: auth.tenantId, countId: doc.id, lineNo: i + j + 1 })));
      }
      await this.documents.log(tx, auth, doc, 'document.created', meta, { warehouse: wh.code, lines: lines.length });
      return this.view(tx, auth, doc);
    });
  }

  update(auth: AuthContext, id: string, input: UpdateStockCountInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const customFields = await this.customFields.validate(tx, DOC_TYPE, input.customFields, doc.customFields);
      const updated = await this.documents.update(tx, auth, doc, { customFields, ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
      await tx
        .update(stockCounts)
        .set({ notes: input.notes, ...(input.blind !== undefined ? { blind: input.blind } : {}) })
        .where(eq(stockCounts.id, id));
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.view(tx, auth, updated);
    });
  }

  /** Records counted quantities. Several counters can work on different lines at the same time. */
  recordCounts(auth: AuthContext, id: string, input: RecordCountsInput) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.find(tx, id, DOC_TYPE);
      if (!EDITABLE.includes(doc.status)) throw new ConflictException('Counts can only be entered while the count is a draft (or after it was sent back)');
      const ids = input.lines.map((l) => l.id);
      const rows = await tx
        .select({ id: stockCountLines.id, lineNo: stockCountLines.lineNo, decimals: uoms.decimals, code: items.code })
        .from(stockCountLines)
        .innerJoin(items, eq(items.id, stockCountLines.itemId))
        .innerJoin(uoms, eq(uoms.id, items.baseUomId))
        .where(and(eq(stockCountLines.countId, id), inArray(stockCountLines.id, ids)));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const errors = input.lines.flatMap((l, i) => {
        const r = byId.get(l.id);
        if (!r) return [{ path: `lines.${i}.id`, message: 'Line not found on this count' }];
        if (l.countedQty && r.decimals === 0 && !/^\d+(\.0+)?$/.test(l.countedQty)) return [{ path: `lines.${i}.countedQty`, message: `${r.code} is counted in whole units` }];
        return [];
      });
      if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
      for (const l of input.lines) {
        await tx
          .update(stockCountLines)
          .set({ countedQty: l.countedQty, ...(l.remarks !== undefined ? { remarks: l.remarks || null } : {}) })
          .where(eq(stockCountLines.id, l.id));
      }
      await tx.update(documents).set({ updatedAt: new Date(), updatedBy: auth.userId }).where(eq(documents.id, id));
      return { updated: input.lines.length };
    });
  }

  /** Adds stock that was found but isn't on the sheet (another batch, an item not in the book). */
  addLine(auth: AuthContext, id: string, input: AddCountLineInput) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE);
      if (!EDITABLE.includes(doc.status)) throw new ConflictException('Lines can only be added while the count is a draft');
      const [count] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id));
      const [item] = await tx.select().from(items).where(eq(items.id, input.itemId));
      const fail = (path: string, message: string) => {
        throw new BadRequestException({ message, errors: [{ path, message }] });
      };
      if (!item) fail('itemId', 'Unknown item');
      if (!item.isStockItem) fail('itemId', `${item.code} is not a stock item`);
      if (item.trackSerial) fail('itemId', 'Serialised items are not counted here yet: use a stock entry with the serial numbers');
      if (item.trackBatch && !input.batchNo) fail('batchNo', `${item.code} needs a batch number`);
      if (!item.trackBatch && input.batchNo) fail('batchNo', `${item.code} does not track batches`);
      const existing = await tx
        .select({ lineNo: stockCountLines.lineNo })
        .from(stockCountLines)
        .where(and(eq(stockCountLines.countId, id), eq(stockCountLines.itemId, item.id), input.batchNo ? sql`upper(${stockCountLines.batchNo}) = ${input.batchNo}` : sql`${stockCountLines.batchNo} is null`));
      if (existing.length) fail('itemId', `Already on the sheet as line ${existing[0].lineNo}`);
      const book = await this.bookQty(tx, item.id, count.warehouseId, input.batchNo);
      const [{ last }] = await tx.select({ last: max(stockCountLines.lineNo) }).from(stockCountLines).where(eq(stockCountLines.countId, id));
      const [batch] = input.batchNo ? await tx.select().from(batches).where(and(eq(batches.itemId, item.id), sql`${batches.batchNo} = ${input.batchNo}`)) : [];
      const [line] = await tx
        .insert(stockCountLines)
        .values({
          tenantId: auth.tenantId,
          countId: id,
          lineNo: (last ?? 0) + 1,
          itemId: item.id,
          batchNo: input.batchNo,
          mfgDate: input.mfgDate ?? batch?.mfgDate ?? null,
          expiryDate: input.expiryDate ?? batch?.expiryDate ?? null,
          systemQty: book,
          countedQty: input.countedQty,
          remarks: input.remarks ?? 'Found during count',
        })
        .returning({ id: stockCountLines.id, lineNo: stockCountLines.lineNo });
      await this.documents.activity(tx, auth, id, 'edited', `Added line ${line.lineNo}: ${item.code}${input.batchNo ? ` batch ${input.batchNo}` : ''}`);
      return line;
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
      const [{ counted }] = await tx
        .select({ counted: sql<number>`count(*) filter (where ${stockCountLines.countedQty} is not null)::int` })
        .from(stockCountLines)
        .where(eq(stockCountLines.countId, id));
      if (!counted) throw new BadRequestException('Enter at least one counted quantity before submitting');
      // Show the expected variance to approvers.
      // Approval rules can use the expected variance value (e.g. a manager approves large differences).
      const { absolute } = await this.estimate(tx, id);
      await tx.update(documents).set({ amount: absolute }).where(eq(documents.id, id));
      await this.documents.submit(tx, auth, { ...doc, amount: absolute }, meta);
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

  /** On approval: bring book stock to the counted quantity, line by line. */
  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [count] = await tx.select().from(stockCounts).where(eq(stockCounts.id, doc.id));
    const lines = await tx
      .select()
      .from(stockCountLines)
      .where(and(eq(stockCountLines.countId, doc.id), sql`${stockCountLines.countedQty} is not null`))
      .orderBy(asc(stockCountLines.lineNo));
    const moves: StockMove[] = [];
    const moved: { lineId: string; book: string; diff: string }[] = [];
    for (const l of lines) {
      const book = await this.bookQty(tx, l.itemId, count.warehouseId, l.batchNo);
      const diff = Decimal.from(l.countedQty).sub(Decimal.from(book));
      await tx.update(stockCountLines).set({ bookQtyAtPosting: book, difference: diff.toFixed(4), rate: null, varianceValue: '0.00' }).where(eq(stockCountLines.id, l.id));
      if (diff.isZero()) continue;
      moves.push({
        itemId: l.itemId,
        warehouseId: count.warehouseId,
        qty: diff.toFixed(4),
        rate: null,
        batchNo: l.batchNo,
        mfgDate: l.mfgDate,
        expiryDate: l.expiryDate,
        line: l.lineNo,
        allowExpired: true,
      });
      moved.push({ lineId: l.id, book, diff: diff.toFixed(4) });
    }
    const posted = await this.stock.post(tx, auth, { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate }, moves);
    let absolute = Decimal.from('0');
    for (const [i, m] of moved.entries()) {
      absolute = absolute.add(Decimal.from(posted[i].value.replace('-', '')));
      await tx.update(stockCountLines).set({ rate: posted[i].rate, varianceValue: posted[i].value }).where(eq(stockCountLines.id, m.lineId));
    }
    await tx.update(documents).set({ amount: absolute.toFixed(2) }).where(eq(documents.id, doc.id));
  }

  // ---- helpers -----------------------------------------------------------------------

  private async bookQty(tx: Transaction, itemId: string, warehouseId: string, batchNo: string | null): Promise<string> {
    let key = NO_BATCH;
    if (batchNo) {
      const [b] = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.itemId, itemId), sql`${batches.batchNo} = ${batchNo}`));
      if (!b) return '0.0000';
      key = b.id;
    }
    const [bal] = await tx
      .select({ qty: stockBalances.qty })
      .from(stockBalances)
      .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.batchKey, key)));
    return Decimal.from(bal?.qty ?? '0').toFixed(4);
  }

  /** Book stock lines for the sheet: per item and batch, sorted by item code then expiry. */
  private async snapshot(tx: Transaction, warehouseId: string, groupId: string | null, includeZero: boolean) {
    const groupFilter = groupId
      ? sql`and i.group_id in (
          with recursive g as (select id from item_groups where id = ${groupId} union all select c.id from item_groups c join g on c.parent_id = g.id)
          select id from g)`
      : sql``;
    const result = await tx.execute<{ item_id: string; batch_no: string | null; mfg_date: string | null; expiry_date: string | null; qty: string }>(sql`
      select i.id as item_id, b.batch_no, b.mfg_date::text, b.expiry_date::text, sb.qty::text as qty, i.code
        from stock_balances sb
        join items i on i.id = sb.item_id
        left join batches b on b.id = sb.batch_key
       where sb.warehouse_id = ${warehouseId} and sb.qty <> 0
         and i.is_stock_item and not i.track_serial and i.deleted_at is null ${groupFilter}
      union all
      select i.id, null, null, null, '0', i.code
        from items i
       where ${includeZero} and i.is_stock_item and i.is_active and not i.track_serial and i.deleted_at is null ${groupFilter}
         and not exists (select 1 from stock_balances sb where sb.item_id = i.id and sb.warehouse_id = ${warehouseId} and sb.qty <> 0)
       order by 6, 4 nulls last, 2 nulls first`);
    return result.rows.map((r) => ({
      itemId: r.item_id,
      batchNo: r.batch_no,
      mfgDate: r.mfg_date,
      expiryDate: r.expiry_date,
      systemQty: Decimal.from(r.qty).toFixed(4),
    }));
  }

  /** Expected variance at current valuation rates (before posting). */
  private async estimate(tx: Transaction, id: string) {
    const [count] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id));
    const rows = await tx
      .select({ itemId: stockCountLines.itemId, systemQty: stockCountLines.systemQty, countedQty: stockCountLines.countedQty, value: stockValuation.value, qty: stockValuation.qty, standardCost: items.standardCost })
      .from(stockCountLines)
      .innerJoin(items, eq(items.id, stockCountLines.itemId))
      .leftJoin(stockValuation, and(eq(stockValuation.itemId, stockCountLines.itemId), eq(stockValuation.warehouseId, count.warehouseId)))
      .where(and(eq(stockCountLines.countId, id), sql`${stockCountLines.countedQty} is not null`));
    let shortage = Decimal.from('0');
    let excess = Decimal.from('0');
    for (const r of rows) {
      const diff = Decimal.from(r.countedQty).sub(Decimal.from(r.systemQty));
      if (diff.isZero()) continue;
      const rate = r.qty && Decimal.from(r.qty).cmp(Decimal.from('0')) > 0 ? Decimal.from(r.value).div(Decimal.from(r.qty)) : Decimal.from(r.standardCost ?? '0');
      const v = diff.mul(rate);
      if (diff.isNegative()) shortage = shortage.sub(v);
      else excess = excess.add(v);
    }
    return { shortage: shortage.toFixed(2), excess: excess.toFixed(2), absolute: shortage.add(excess).toFixed(2) };
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('inventory.entries.manage'), cancel: perms.has('inventory.entries.cancel') });
    const [count] = await tx
      .select({ c: stockCounts, warehouse: { id: warehouses.id, code: warehouses.code, name: warehouses.name }, group: { id: itemGroups.id, name: itemGroups.name } })
      .from(stockCounts)
      .innerJoin(warehouses, eq(warehouses.id, stockCounts.warehouseId))
      .leftJoin(itemGroups, eq(itemGroups.id, stockCounts.itemGroupId))
      .where(eq(stockCounts.id, doc.id));
    if (!count) throw new NotFoundException('Stock count not found');
    const lines = await tx
      .select({
        l: stockCountLines,
        itemCode: items.code,
        itemName: items.name,
        uom: uoms.code,
        uomDecimals: uoms.decimals,
        trackBatch: items.trackBatch,
        hasExpiry: items.hasExpiry,
        rateNow: sql<string | null>`case when ${stockValuation.qty} > 0 then (${stockValuation.value} / ${stockValuation.qty})::numeric(18,6)::text else ${items.standardCost}::text end`,
      })
      .from(stockCountLines)
      .innerJoin(items, eq(items.id, stockCountLines.itemId))
      .innerJoin(uoms, eq(uoms.id, items.baseUomId))
      .leftJoin(stockValuation, and(eq(stockValuation.itemId, stockCountLines.itemId), eq(stockValuation.warehouseId, count.c.warehouseId)))
      .where(eq(stockCountLines.countId, doc.id))
      .orderBy(asc(stockCountLines.lineNo));
    // Blind counts hide the book quantity while counting.
    const hideBook = count.c.blind && EDITABLE.includes(doc.status);
    const posted = doc.status === 'approved' || (doc.status === 'cancelled' && !!doc.approvedAt);
    let shortage = Decimal.from('0');
    let excess = Decimal.from('0');
    const out = lines.map(({ l, rateNow, ...rest }) => {
      const diff = posted ? l.difference : l.countedQty === null ? null : Decimal.from(l.countedQty).sub(Decimal.from(l.systemQty)).toFixed(4);
      const value = posted ? l.varianceValue : diff && rateNow ? Decimal.from(diff).mul(Decimal.from(rateNow)).toFixed(2) : null;
      if (value && !hideBook) {
        if (Decimal.from(value).isNegative()) shortage = shortage.sub(Decimal.from(value));
        else excess = excess.add(Decimal.from(value));
      }
      return {
        id: l.id,
        lineNo: l.lineNo,
        itemId: l.itemId,
        ...rest,
        batchNo: l.batchNo,
        mfgDate: l.mfgDate,
        expiryDate: l.expiryDate,
        systemQty: hideBook ? null : l.systemQty,
        countedQty: l.countedQty,
        difference: hideBook ? null : diff,
        bookQtyAtPosting: l.bookQtyAtPosting,
        rate: posted ? l.rate : hideBook ? null : rateNow,
        varianceValue: hideBook ? null : value,
        remarks: l.remarks,
      };
    });
    return {
      ...header,
      warehouse: count.warehouse,
      itemGroup: count.group?.id ? count.group : null,
      blind: count.c.blind,
      bookHidden: hideBook,
      snapshotAt: count.c.snapshotAt,
      notes: count.c.notes,
      stats: {
        lines: out.length,
        counted: out.filter((l) => l.countedQty !== null).length,
        withDifference: hideBook ? null : out.filter((l) => l.difference && !Decimal.from(l.difference).isZero()).length,
        shortageValue: hideBook ? null : shortage.toFixed(2),
        excessValue: hideBook ? null : excess.toFixed(2),
        estimated: !posted,
      },
      lines: out,
    };
  }
}
