import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { batches, blendLines, blends, documents, items, uoms, warehouses, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService, type Voucher } from '../inventory/stock.service';

const DOC_TYPE = 'blend' as const;
const D = Decimal.from;
const ZERO = D('0');

const qty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero (up to 4 decimals)');

export const blendSchema = z.object({
  itemId: z.uuid(),
  warehouseId: z.uuid(),
  newBatchNo: z.string().trim().min(1).max(40).transform((v) => v.toUpperCase()),
  expiryDate: z.iso.date().nullable().optional(),
  docDate: z.iso.date().optional(),
  notes: optionalText(1000),
  lots: z.array(z.object({ batchNo: z.string().trim().min(1).max(40), qty })).min(2, 'A blend needs at least two lots').max(50),
});
export type BlendInput = z.infer<typeof blendSchema>;

/**
 * Blending lots of one item into a new lot. The new lot is valued at the cost of what went in,
 * so the books do not move; traceability links the new lot to every lot blended.
 */
@Injectable()
export class BlendsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, { amendable: false, onApproved: (tx, auth, doc) => this.post(tx, auth, doc) });
  }

  list(auth: AuthContext, q: { limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, item: { code: items.code, name: items.name }, newBatchNo: blends.newBatchNo, totalQty: blends.totalQty, value: blends.value, warehouse: warehouses.code })
        .from(documents)
        .innerJoin(blends, eq(blends.id, documents.id))
        .innerJoin(items, eq(items.id, blends.itemId))
        .innerJoin(warehouses, eq(warehouses.id, blends.warehouseId))
        .where(and(eq(documents.docType, DOC_TYPE), q.cursor ? lt(documents.id, q.cursor) : undefined))
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

  /** Creates and posts the blend in one go. */
  create(auth: AuthContext, input: BlendInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ code: items.code, trackBatch: items.trackBatch }).from(items).where(eq(items.id, input.itemId));
      const errors: { path: string; message: string }[] = [];
      if (!it) errors.push({ path: 'itemId', message: 'Item not found' });
      else if (!it.trackBatch) errors.push({ path: 'itemId', message: `${it.code} is not batch-tracked` });
      const lotNos = input.lots.map((l) => l.batchNo.toUpperCase());
      if (new Set(lotNos).size !== lotNos.length) errors.push({ path: 'lots', message: 'Each lot once' });
      if (lotNos.includes(input.newBatchNo)) errors.push({ path: 'newBatchNo', message: 'The new lot must have a new number' });
      const [exists] = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.itemId, input.itemId), sql`${batches.batchNo} = ${input.newBatchNo}`));
      if (exists) errors.push({ path: 'newBatchNo', message: `Lot ${input.newBatchNo} already exists` });
      if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
      const total = input.lots.reduce((s, l) => s.add(D(l.qty)), ZERO);
      const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, docDate: input.docDate ?? todayIST(), title: `${it!.code} → ${input.newBatchNo}`, amount: null });
      await tx.insert(blends).values({ id: doc.id, tenantId: auth.tenantId, itemId: input.itemId, warehouseId: input.warehouseId, newBatchNo: input.newBatchNo, expiryDate: input.expiryDate ?? null, totalQty: total.toFixed(4), notes: input.notes });
      await tx.insert(blendLines).values(input.lots.map((l, i) => ({ tenantId: auth.tenantId, blendId: doc.id, lineNo: i + 1, batchNo: l.batchNo.toUpperCase(), qty: l.qty })));
      await this.documents.log(tx, auth, doc, 'document.created', meta, { lots: input.lots.length });
      await this.documents.submit(tx, auth, doc, meta);
      return this.view(tx, auth, await this.documents.find(tx, doc.id, DOC_TYPE));
    });
  }

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [b] = await tx.select().from(blends).where(eq(blends.id, doc.id));
    const lines = await tx.select().from(blendLines).where(eq(blendLines.blendId, doc.id)).orderBy(asc(blendLines.lineNo));
    const voucher: Voucher = { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };
    // Expiry: the earliest of the lots blended unless given.
    const exp = b.expiryDate ?? (await tx.select({ e: sql<string | null>`min(${batches.expiryDate})::text` }).from(batches).where(and(eq(batches.itemId, b.itemId), sql`${batches.batchNo} in ${lines.map((l) => l.batchNo)}`)))[0]?.e ?? null;
    const out = await this.stock.post(tx, auth, voucher, lines.map((l) => ({ itemId: b.itemId, warehouseId: b.warehouseId, qty: ZERO.sub(D(l.qty)).toFixed(4), batchNo: l.batchNo, line: l.lineNo, allowExpired: true })));
    const value = out.reduce((s, m) => s.sub(D(m.value)), ZERO);
    for (const [i, l] of lines.entries()) await tx.update(blendLines).set({ value: ZERO.sub(D(out[i].value)).toFixed(2) }).where(eq(blendLines.id, l.id));
    const total = D(b.totalQty);
    await this.stock.post(tx, auth, voucher, [{ itemId: b.itemId, warehouseId: b.warehouseId, qty: total.toFixed(4), rate: value.div(total).toFixed(6), batchNo: b.newBatchNo, expiryDate: exp, line: lines.length + 1 }]);
    await tx.update(blends).set({ value: value.toFixed(2), expiryDate: exp }).where(eq(blends.id, doc.id));
    await tx.update(documents).set({ amount: value.toFixed(2) }).where(eq(documents.id, doc.id));
  }

  private async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const header = await this.documents.view(tx, auth, doc, { manage: false, cancel: false });
    const [b] = await tx.select({ b: blends, code: items.code, name: items.name, uom: uoms.code, warehouse: warehouses.code }).from(blends).innerJoin(items, eq(items.id, blends.itemId)).innerJoin(uoms, eq(uoms.id, items.baseUomId)).innerJoin(warehouses, eq(warehouses.id, blends.warehouseId)).where(eq(blends.id, doc.id));
    const lines = await tx.select().from(blendLines).where(eq(blendLines.blendId, doc.id)).orderBy(asc(blendLines.lineNo));
    const { tenantId: _t, id: _i, ...rest } = b.b;
    return { ...header, ...rest, item: { code: b.code, name: b.name, uom: b.uom }, warehouse: b.warehouse, lots: lines.map(({ tenantId: _lt, blendId: _bl, ...l }) => l) };
  }
}
