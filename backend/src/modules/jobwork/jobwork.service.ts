import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  companies,
  documents,
  ewayBills,
  items,
  jobWorkChallanLines,
  jobWorkChallans,
  jobWorkReceiptLines,
  jobWorkReceipts,
  parties,
  partyAddresses,
  uoms,
  users,
  warehouses,
  type Transaction,
} from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { PrintService } from '../customization/print.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { StockService, type StockMove } from '../inventory/stock.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { fail, trim, unitCosts, type Err } from '../sales/common';
import type { CreateChallanInput, CreateReceiptInput, JobworkListQuery } from './jobwork.schemas';

const CHALLAN = 'job_work_challan' as const;
const RECEIPT = 'job_work_receipt' as const;
const DEADLINE_QUEUE = 'jobwork.deadline';
const D = Decimal.from;
const ZERO = D('0');

/** s.143: inputs back within 1 year, capital goods within 3 years of being sent. */
export function returnDeadline(challanDate: string, goodsType: string) {
  const [y, m, d] = challanDate.split('-').map(Number);
  const years = goodsType === 'capital_goods' ? 3 : 1;
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

const pendingOf = (l: { qty: string; consumedQty: string; returnedQty: string; lossQty: string }) => D(l.qty).sub(D(l.consumedQty)).sub(D(l.returnedQty)).sub(D(l.lossQty));

/**
 * Job work (sub-contracting). A challan moves material, still ours, to the job worker's
 * virtual warehouse; a receipt brings processed goods back (valued at the material consumed
 * plus job charges), returns unprocessed material and writes off process loss.
 */
@Injectable()
export class JobWorkService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly stock: StockService,
    private readonly print: PrintService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(CHALLAN, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.postChallan(tx, auth, doc),
      onCancelled: (tx, auth, doc) => this.unpostChallan(tx, auth, doc),
    });
    this.documents.registerHooks(RECEIPT, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.postReceipt(tx, auth, doc),
      onCancelled: (tx, auth, doc) => this.unpostReceipt(tx, auth, doc),
    });
    this.print.registerContext(CHALLAN, async (tx, auth, id) => {
      const doc = await this.documents.find(tx, id, CHALLAN);
      const view = await this.challanView(tx, auth, doc);
      const [company] = await tx.select({ name: companies.name, legalName: companies.legalName, gstin: companies.gstin, address: companies.address }).from(companies).where(eq(companies.id, doc.companyId));
      const [printer] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, auth.userId));
      return { company, doc: view, lines: view.lines, printedBy: printer?.name ?? '', printedAt: new Date().toISOString() };
    });
    this.jobs.register(DEADLINE_QUEUE, (payload, ctx) => this.deadlineCheck(ctx.tenantId, String(payload.challanId), String(payload.stage)));
  }

  // ---- Challans --------------------------------------------------------------------

  listChallans(auth: AuthContext, q: JobworkListQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const pendingQty = sql<string>`(select coalesce(sum(l.qty - l.consumed_qty - l.returned_qty - l.loss_qty), 0)::numeric(18,4)::text from ${jobWorkChallanLines} l where l.challan_id = ${documents.id})`;
      const dueBy = sql<string | null>`(select min(case when l.goods_type = 'capital_goods' then ${documents.docDate} + interval '3 years' else ${documents.docDate} + interval '1 year' end)::date::text from ${jobWorkChallanLines} l where l.challan_id = ${documents.id} and l.qty > l.consumed_qty + l.returned_qty + l.loss_qty)`;
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          jobWorker: { id: parties.id, name: parties.name },
          process: jobWorkChallans.process,
          totalValue: jobWorkChallans.totalValue,
          expectedReturnDate: jobWorkChallans.expectedReturnDate,
          ewayBillNo: jobWorkChallans.ewayBillNo,
          pendingQty,
          dueBy,
        })
        .from(documents)
        .innerJoin(jobWorkChallans, eq(jobWorkChallans.id, documents.id))
        .innerJoin(parties, eq(parties.id, jobWorkChallans.jobWorkerId))
        .where(
          and(
            eq(documents.docType, CHALLAN),
            q.status ? eq(documents.status, q.status) : undefined,
            q.jobWorkerId ? eq(jobWorkChallans.jobWorkerId, q.jobWorkerId) : undefined,
            q.pending === 'true' ? and(eq(documents.status, 'approved'), sql`${pendingQty}::numeric > 0`) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(jobWorkChallans.process, `%${term}%`)) : undefined,
            q.cursor ? lt(documents.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(documents.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const today = todayIST();
      return { items: page.map((r) => ({ ...r, daysToDue: r.dueBy && Number(r.pendingQty) > 0 ? Math.round((Date.parse(r.dueBy) - Date.parse(today)) / 86_400_000) : null })), nextCursor: hasMore ? page[page.length - 1].id : null };
    });
  }

  getChallan(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.challanView(tx, auth, await this.documents.find(tx, id, CHALLAN)));
  }

  createChallan(auth: AuthContext, input: CreateChallanInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const p = await this.prepareChallan(tx, auth, input);
      const doc = await this.documents.create(tx, auth, { docType: CHALLAN, companyId: p.companyId, branchId: p.branchId, docDate: input.docDate ?? todayIST(), title: p.title, amount: p.total.toFixed(2) });
      await tx.insert(jobWorkChallans).values({ id: doc.id, tenantId: auth.tenantId, ...p.header });
      await this.writeChallanLines(tx, auth, doc.id, p.lines);
      await this.documents.log(tx, auth, doc, 'document.created', meta, { jobWorker: p.title, lines: p.lines.length });
      return this.challanView(tx, auth, doc);
    });
  }

  updateChallan(auth: AuthContext, id: string, input: CreateChallanInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, CHALLAN, input.version);
      this.documents.assertEditable(doc);
      const p = await this.prepareChallan(tx, auth, input);
      if (p.companyId !== doc.companyId) fail([{ path: 'warehouseId', message: 'The warehouse must belong to the same company' }]);
      await tx.update(jobWorkChallans).set(p.header).where(eq(jobWorkChallans.id, id));
      await tx.delete(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, id));
      await this.writeChallanLines(tx, auth, id, p.lines);
      const updated = await this.documents.update(tx, auth, doc, { title: p.title, amount: p.total.toFixed(2), ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.challanView(tx, auth, updated);
    });
  }

  private async prepareChallan(tx: Transaction, auth: AuthContext, input: CreateChallanInput) {
    const errors: Err[] = [];
    const [worker] = await tx.select().from(parties).where(eq(parties.id, input.jobWorkerId));
    if (!worker) fail([{ path: 'jobWorkerId', message: 'Job worker not found' }]);
    if (!worker.isVendor) fail([{ path: 'jobWorkerId', message: `${worker.name} is not set up as a vendor` }]);
    if (!worker.isActive) fail([{ path: 'jobWorkerId', message: `${worker.name} is inactive` }]);
    const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, input.warehouseId));
    if (!wh) fail([{ path: 'warehouseId', message: 'Warehouse not found' }]);
    if (wh.type === 'job_work') fail([{ path: 'warehouseId', message: 'Send from one of your own warehouses' }]);
    const jwWarehouseId = await this.jobWorkWarehouse(tx, auth, wh.companyId, worker);
    const itemRows = await tx.select({ id: items.id, code: items.code, name: items.name, isStockItem: items.isStockItem, baseUomId: items.baseUomId, hsnCode: items.hsnCode, gstRate: items.gstRate }).from(items).where(inArray(items.id, input.lines.map((l) => l.itemId)));
    const costs = await unitCosts(tx, input.lines.map((l) => l.itemId));
    let total = ZERO;
    const lines = input.lines.map((l, i) => {
      const it = itemRows.find((x) => x.id === l.itemId);
      if (!it) {
        errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: item not found` });
        return null;
      }
      if (!it.isStockItem) errors.push({ path: `lines.${i}.itemId`, message: `Line ${i + 1}: ${it.code} is not a stock item` });
      const rate = l.rate ?? costs.get(it.id) ?? null;
      if (!rate) errors.push({ path: `lines.${i}.rate`, message: `Line ${i + 1}: no stock cost for ${it.code}; enter the value per unit` });
      const value = D(l.qty).mul(D(rate ?? '0')).round(2);
      total = total.add(value);
      return {
        lineNo: i + 1,
        itemId: it.id,
        description: l.description || it.name,
        uomId: it.baseUomId,
        qty: l.qty,
        rate: D(rate ?? '0').toFixed(4),
        value: value.toFixed(2),
        hsnCode: it.hsnCode,
        gstRate: it.gstRate ?? '0',
        goodsType: l.goodsType,
        batchNo: l.batchNo,
      };
    });
    if (errors.length) fail(errors);
    const [addr] = await tx.select().from(partyAddresses).where(eq(partyAddresses.partyId, worker.id)).orderBy(desc(partyAddresses.isDefault)).limit(1);
    return {
      companyId: wh.companyId,
      branchId: wh.branchId,
      title: worker.name,
      total,
      header: {
        jobWorkerId: worker.id,
        jobWorkerGstin: worker.gstin,
        jobWorkerStateCode: worker.stateCode ?? addr?.stateCode ?? null,
        jobWorkerAddress: addr ? { line1: addr.line1, line2: addr.line2 ?? undefined, city: addr.city, stateCode: addr.stateCode, pincode: addr.pincode ?? undefined } : {},
        warehouseId: wh.id,
        jobWorkWarehouseId: jwWarehouseId,
        process: input.process,
        expectedReturnDate: input.expectedReturnDate ?? null,
        transporter: input.transporter,
        vehicleNo: input.vehicleNo ? input.vehicleNo.replace(/[\s-]/g, '').toUpperCase() : null,
        totalValue: total.toFixed(2),
        notes: input.notes,
      },
      lines: lines.filter((l): l is NonNullable<typeof l> => !!l),
    };
  }

  /** The job worker's virtual warehouse (type job_work, not nettable), created on first use. */
  private async jobWorkWarehouse(tx: Transaction, auth: AuthContext, companyId: string, worker: typeof parties.$inferSelect) {
    const code = `JW-${worker.code}`;
    const [existing] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, code));
    if (existing) return existing.id;
    const [row] = await tx
      .insert(warehouses)
      .values({ tenantId: auth.tenantId, companyId, code, name: `${worker.name} (job work)`.slice(0, 120), type: 'job_work', isNettable: false, createdBy: auth.userId, updatedBy: auth.userId })
      .returning({ id: warehouses.id });
    return row.id;
  }

  private async writeChallanLines(tx: Transaction, auth: AuthContext, challanId: string, lines: Awaited<ReturnType<JobWorkService['prepareChallan']>>['lines']) {
    await tx.insert(jobWorkChallanLines).values(lines.map((l) => ({ ...l, tenantId: auth.tenantId, challanId })));
  }

  private async postChallan(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [jw] = await tx.select().from(jobWorkChallans).where(eq(jobWorkChallans.id, doc.id));
    const lines = await tx.select().from(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, doc.id)).orderBy(asc(jobWorkChallanLines.lineNo));
    const voucher = { id: doc.id, type: CHALLAN, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };
    // Out of our store at cost, then into the job worker's warehouse at the same cost.
    const out = await this.stock.post(tx, auth, voucher, lines.map((l) => ({ itemId: l.itemId, warehouseId: jw.warehouseId, qty: D('0').sub(D(l.qty)).toFixed(4), batchNo: l.batchNo, line: l.lineNo })));
    const ins: StockMove[] = lines.map((l, i) => ({ itemId: l.itemId, warehouseId: jw.jobWorkWarehouseId, qty: l.qty, rate: D(out[i].value).abs().div(D(l.qty)).toFixed(6), batchNo: l.batchNo, line: l.lineNo, allowExpired: true }));
    await this.stock.post(tx, auth, voucher, ins);
    for (const [i, l] of lines.entries()) await tx.update(jobWorkChallanLines).set({ costValue: D(out[i].value).abs().toFixed(2) }).where(eq(jobWorkChallanLines.id, l.id));
    // Deadline reminders: 30 days before the earliest deadline, then on it.
    const due = lines.map((l) => returnDeadline(doc.docDate, l.goodsType)).sort()[0];
    const warnAt = new Date(Date.parse(`${due}T09:00:00+05:30`) - 30 * 86_400_000);
    await this.jobs.enqueue(tx, auth.tenantId, DEADLINE_QUEUE, { challanId: doc.id, stage: 'warn' }, { runAt: warnAt, dedupeKey: `jw-due:${doc.id}:warn`, maxAttempts: 3 });
  }

  private async unpostChallan(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(jobWorkReceipts)
      .innerJoin(documents, eq(documents.id, jobWorkReceipts.id))
      .where(and(eq(jobWorkReceipts.challanId, doc.id), ne(documents.status, 'cancelled')));
    if (r.n) throw new ConflictException('Goods were received against this challan. Cancel the receipts first.');
    const [ewb] = await tx.select({ ewbNo: ewayBills.ewbNo }).from(ewayBills).where(and(eq(ewayBills.documentId, doc.id), eq(ewayBills.status, 'active')));
    if (ewb) throw new ConflictException(`Cancel e-way bill ${ewb.ewbNo} first`);
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: CHALLAN, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
  }

  async challanView(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('jobwork.challans.manage'), cancel: perms.has('jobwork.challans.cancel') });
    const [jw] = await tx.select().from(jobWorkChallans).where(eq(jobWorkChallans.id, doc.id));
    const [worker] = await tx.select({ id: parties.id, code: parties.code, name: parties.name }).from(parties).where(eq(parties.id, jw.jobWorkerId));
    const whs = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, [jw.warehouseId, jw.jobWorkWarehouseId]));
    const rows = await tx
      .select({ l: jobWorkChallanLines, itemCode: items.code, uomCode: uoms.code, uqc: uoms.uqc })
      .from(jobWorkChallanLines)
      .innerJoin(items, eq(items.id, jobWorkChallanLines.itemId))
      .innerJoin(uoms, eq(uoms.id, jobWorkChallanLines.uomId))
      .where(eq(jobWorkChallanLines.challanId, doc.id))
      .orderBy(asc(jobWorkChallanLines.lineNo));
    const receipts = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, jwChallanNo: jobWorkReceipts.jwChallanNo, jobCharges: jobWorkReceipts.jobCharges })
      .from(jobWorkReceipts)
      .innerJoin(documents, eq(documents.id, jobWorkReceipts.id))
      .where(eq(jobWorkReceipts.challanId, doc.id))
      .orderBy(desc(documents.id));
    const today = todayIST();
    const { tenantId: _t, id: _i, jobWorkerId: _j, warehouseId: _w, jobWorkWarehouseId: _jw, ...rest } = jw;
    const lines = rows.map(({ l: { tenantId: _lt, challanId: _c, ...l }, ...more }) => {
      const pending = pendingOf(l);
      const dueBy = returnDeadline(doc.docDate, l.goodsType);
      return { ...l, ...more, pendingQty: pending.toFixed(4), dueBy, daysToDue: pending.cmp(ZERO) > 0 ? Math.round((Date.parse(dueBy) - Date.parse(today)) / 86_400_000) : null };
    });
    return {
      ...header,
      ...rest,
      jobWorker: { ...worker, gstin: jw.jobWorkerGstin, stateCode: jw.jobWorkerStateCode },
      warehouse: whs.find((w) => w.id === jw.warehouseId) ?? null,
      jobWorkWarehouse: whs.find((w) => w.id === jw.jobWorkWarehouseId) ?? null,
      lines,
      receipts,
      pendingQty: lines.reduce((s, l) => s.add(D(l.pendingQty)), ZERO).toFixed(4),
      canReceive: doc.status === 'approved' && perms.has('jobwork.challans.manage') && lines.some((l) => D(l.pendingQty).cmp(ZERO) > 0),
    };
  }

  /** Reminder job: warns 30 days ahead, then on the deadline (deemed supply). */
  private async deadlineCheck(tenantId: string, challanId: string, stage: string) {
    await this.database.run({ tenantId }, async (tx) => {
      const [doc] = await tx.select().from(documents).where(eq(documents.id, challanId));
      if (!doc || doc.status !== 'approved') return;
      const [jw] = await tx.select({ workerId: jobWorkChallans.jobWorkerId }).from(jobWorkChallans).where(eq(jobWorkChallans.id, challanId));
      const [worker] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, jw.workerId));
      const lines = await tx.select().from(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, challanId));
      const open = lines.filter((l) => pendingOf(l).cmp(ZERO) > 0);
      if (!open.length) return;
      const due = open.map((l) => returnDeadline(doc.docDate, l.goodsType)).sort()[0];
      const pending = open.map((l) => `${trim(pendingOf(l))} × ${l.description}`).join(', ');
      const recipients = [doc.createdBy, doc.submittedBy].filter((v): v is string => !!v);
      await this.notifications.notify(tx, tenantId, 'jobwork.return_due', [...new Set(recipients)].map((userId) => ({ userId })), {
        number: doc.number ?? '',
        jobWorker: worker.name,
        dueDate: due,
        pending,
        overdue: stage === 'due' ? 'yes' : 'no',
        link: `/job-work/challans/${challanId}`,
      });
      if (stage === 'warn') await this.jobs.enqueue(tx, tenantId, DEADLINE_QUEUE, { challanId, stage: 'due' }, { runAt: new Date(Date.parse(`${due}T09:00:00+05:30`) + 86_400_000), dedupeKey: `jw-due:${challanId}:due`, maxAttempts: 3 });
    });
  }

  // ---- Workflow (shared by challans and receipts) ------------------------------------

  remove(auth: AuthContext, docType: typeof CHALLAN | typeof RECEIPT, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, docType, version);
      await this.documents.deleteDraft(tx, auth, doc, meta);
    });
  }

  submit(auth: AuthContext, docType: typeof CHALLAN | typeof RECEIPT, id: string, version: number, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, docType, version);
      await this.documents.submit(tx, auth, doc, meta);
      const fresh = await this.documents.find(tx, id, docType);
      return docType === CHALLAN ? this.challanView(tx, auth, fresh) : this.receiptView(tx, auth, fresh);
    });
  }

  cancel(auth: AuthContext, docType: typeof CHALLAN | typeof RECEIPT, id: string, version: number, reason: string, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, docType, version);
      const done = await this.documents.cancel(tx, auth, doc, reason, meta);
      return docType === CHALLAN ? this.challanView(tx, auth, done) : this.receiptView(tx, auth, done);
    });
  }

  // ---- Receipts --------------------------------------------------------------------

  listReceipts(auth: AuthContext, q: JobworkListQuery) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({
          id: documents.id,
          number: documents.number,
          status: documents.status,
          docDate: documents.docDate,
          jobWorker: { id: parties.id, name: parties.name },
          challanId: jobWorkReceipts.challanId,
          challanNumber: sql<string | null>`(select d.number from ${documents} d where d.id = ${jobWorkReceipts.challanId})`,
          jwChallanNo: jobWorkReceipts.jwChallanNo,
          jobCharges: jobWorkReceipts.jobCharges,
          amount: documents.amount,
        })
        .from(documents)
        .innerJoin(jobWorkReceipts, eq(jobWorkReceipts.id, documents.id))
        .innerJoin(parties, eq(parties.id, jobWorkReceipts.jobWorkerId))
        .where(
          and(
            eq(documents.docType, RECEIPT),
            q.status ? eq(documents.status, q.status) : undefined,
            q.jobWorkerId ? eq(jobWorkReceipts.jobWorkerId, q.jobWorkerId) : undefined,
            q.challanId ? eq(jobWorkReceipts.challanId, q.challanId) : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(parties.name, `%${term}%`), ilike(jobWorkReceipts.jwChallanNo, `%${term}%`)) : undefined,
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

  getReceipt(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => this.receiptView(tx, auth, await this.documents.find(tx, id, RECEIPT)));
  }

  createReceipt(auth: AuthContext, input: CreateReceiptInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const p = await this.prepareReceipt(tx, input, null);
      const doc = await this.documents.create(tx, auth, { docType: RECEIPT, companyId: p.challanDoc.companyId, branchId: p.challanDoc.branchId, docDate: input.docDate ?? todayIST(), title: p.title, amount: null });
      await tx.insert(jobWorkReceipts).values({ id: doc.id, tenantId: auth.tenantId, ...p.header });
      await tx.insert(jobWorkReceiptLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, receiptId: doc.id })));
      await this.documents.log(tx, auth, doc, 'document.created', meta, { challan: p.challanDoc.number });
      return this.receiptView(tx, auth, doc);
    });
  }

  updateReceipt(auth: AuthContext, id: string, input: CreateReceiptInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, RECEIPT, input.version);
      this.documents.assertEditable(doc);
      const [current] = await tx.select().from(jobWorkReceipts).where(eq(jobWorkReceipts.id, id));
      if (current.challanId !== input.challanId) fail([{ path: 'challanId', message: 'A receipt stays on its challan' }]);
      const p = await this.prepareReceipt(tx, input, id);
      await tx.update(jobWorkReceipts).set(p.header).where(eq(jobWorkReceipts.id, id));
      await tx.delete(jobWorkReceiptLines).where(eq(jobWorkReceiptLines.receiptId, id));
      await tx.insert(jobWorkReceiptLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, receiptId: id })));
      const updated = await this.documents.update(tx, auth, doc, { title: p.title, ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
      await this.documents.log(tx, auth, updated, 'document.updated', meta);
      return this.receiptView(tx, auth, updated);
    });
  }

  private async prepareReceipt(tx: Transaction, input: CreateReceiptInput, receiptId: string | null) {
    const [challanDoc] = await tx.select().from(documents).where(and(eq(documents.id, input.challanId), eq(documents.docType, CHALLAN)));
    if (!challanDoc) fail([{ path: 'challanId', message: 'Job-work challan not found' }]);
    if (challanDoc.status !== 'approved') fail([{ path: 'challanId', message: `Challan ${challanDoc.number ?? ''} is ${challanDoc.status.replace('_', ' ')}: receive only against an open, approved challan` }]);
    const [jw] = await tx.select().from(jobWorkChallans).where(eq(jobWorkChallans.id, challanDoc.id));
    const [wh] = await tx.select().from(warehouses).where(eq(warehouses.id, input.warehouseId));
    if (!wh || wh.companyId !== challanDoc.companyId) fail([{ path: 'warehouseId', message: 'Unknown warehouse for this company' }]);
    if (wh.type === 'job_work') fail([{ path: 'warehouseId', message: 'Receive into one of your own warehouses' }]);
    const cLines = await tx.select().from(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, challanDoc.id));
    const errors: Err[] = [];
    if (!input.outputs.length && !input.materials.some((m) => Number(m.returnedQty) > 0 || Number(m.lossQty) > 0 || Number(m.consumedQty) > 0)) errors.push({ path: 'outputs', message: 'Record what came back: processed goods, or material returned / lost' });
    const consumed = input.materials.some((m) => Number(m.consumedQty) > 0);
    if (consumed && !input.outputs.length) errors.push({ path: 'outputs', message: 'Material was consumed: add the processed goods received' });
    if (!consumed && input.outputs.length) errors.push({ path: 'materials', message: 'Say how much of the material sent was consumed to make these goods' });
    const lines: Omit<typeof jobWorkReceiptLines.$inferInsert, 'tenantId' | 'receiptId'>[] = [];
    let n = 0;
    for (const [i, m] of input.materials.entries()) {
      const cl = cLines.find((c) => c.id === m.challanLineId);
      if (!cl) {
        errors.push({ path: `materials.${i}.challanLineId`, message: `Material ${i + 1}: not a line of this challan` });
        continue;
      }
      const settle = D(m.consumedQty).add(D(m.returnedQty)).add(D(m.lossQty));
      if (settle.isZero()) continue;
      const pending = pendingOf(cl);
      if (settle.cmp(pending) > 0) errors.push({ path: `materials.${i}.consumedQty`, message: `${cl.description}: only ${trim(pending)} is still at the job worker` });
      lines.push({ lineNo: ++n, kind: 'material', challanLineId: cl.id, itemId: cl.itemId, uomId: cl.uomId, qty: '0', consumedQty: m.consumedQty, returnedQty: m.returnedQty, lossQty: m.lossQty, batchNo: cl.batchNo, value: '0' });
    }
    if (input.outputs.length) {
      const its = await tx.select({ id: items.id, code: items.code, isStockItem: items.isStockItem, baseUomId: items.baseUomId }).from(items).where(inArray(items.id, input.outputs.map((o) => o.itemId)));
      for (const [i, o] of input.outputs.entries()) {
        const it = its.find((x) => x.id === o.itemId);
        if (!it) errors.push({ path: `outputs.${i}.itemId`, message: `Output ${i + 1}: item not found` });
        else if (!it.isStockItem) errors.push({ path: `outputs.${i}.itemId`, message: `Output ${i + 1}: ${it.code} is not a stock item` });
        else lines.push({ lineNo: ++n, kind: 'output', challanLineId: null, itemId: it.id, uomId: it.baseUomId, qty: o.qty, consumedQty: '0', returnedQty: '0', lossQty: '0', batchNo: o.batchNo, value: '0' });
      }
    }
    if (errors.length) fail(errors);
    void receiptId;
    const [worker] = await tx.select({ name: parties.name }).from(parties).where(eq(parties.id, jw.jobWorkerId));
    return {
      challanDoc,
      title: `${worker.name} · ${challanDoc.number ?? ''}`,
      header: {
        challanId: challanDoc.id,
        jobWorkerId: jw.jobWorkerId,
        jwChallanNo: input.jwChallanNo,
        jwChallanDate: input.jwChallanDate ?? null,
        warehouseId: wh.id,
        natureOfJob: input.natureOfJob ?? jw.process,
        jobCharges: D(input.jobCharges).toFixed(2),
        notes: input.notes,
      },
      lines,
    };
  }

  private async postReceipt(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [r] = await tx.select().from(jobWorkReceipts).where(eq(jobWorkReceipts.id, doc.id));
    const challanDoc = await this.documents.lock(tx, r.challanId, CHALLAN);
    if (challanDoc.status !== 'approved') throw new ConflictException(`Challan ${challanDoc.number} is ${challanDoc.status}: nothing more can be received`);
    const [jw] = await tx.select().from(jobWorkChallans).where(eq(jobWorkChallans.id, r.challanId));
    const lines = await tx.select().from(jobWorkReceiptLines).where(eq(jobWorkReceiptLines.receiptId, doc.id)).orderBy(asc(jobWorkReceiptLines.lineNo));
    const cLines = await tx.select().from(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, r.challanId)).for('update');
    const errors: Err[] = [];
    const materials = lines.filter((l) => l.kind === 'material');
    for (const [i, m] of materials.entries()) {
      const cl = cLines.find((c) => c.id === m.challanLineId)!;
      const settle = D(m.consumedQty).add(D(m.returnedQty)).add(D(m.lossQty));
      if (settle.cmp(pendingOf(cl)) > 0) errors.push({ path: `materials.${i}.consumedQty`, message: `${cl.description}: only ${trim(pendingOf(cl))} is still at the job worker` });
    }
    if (errors.length) fail(errors);
    const voucher = { id: doc.id, type: RECEIPT, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate };
    // 1. Material leaves the job worker's warehouse: consumed + lost (written off into the product), returned (comes back as is).
    const outs: StockMove[] = [];
    const outIdx: { line: (typeof materials)[number]; kind: 'used' | 'returned' }[] = [];
    for (const m of materials) {
      const used = D(m.consumedQty).add(D(m.lossQty));
      if (used.cmp(ZERO) > 0) {
        outs.push({ itemId: m.itemId, warehouseId: jw.jobWorkWarehouseId, qty: ZERO.sub(used).toFixed(4), batchNo: m.batchNo, line: m.lineNo, allowExpired: true });
        outIdx.push({ line: m, kind: 'used' });
      }
      if (D(m.returnedQty).cmp(ZERO) > 0) {
        outs.push({ itemId: m.itemId, warehouseId: jw.jobWorkWarehouseId, qty: ZERO.sub(D(m.returnedQty)).toFixed(4), batchNo: m.batchNo, line: m.lineNo, allowExpired: true });
        outIdx.push({ line: m, kind: 'returned' });
      }
    }
    const posted = await this.stock.post(tx, auth, voucher, outs);
    let usedCost = ZERO;
    const ins: StockMove[] = [];
    for (const [i, o] of outIdx.entries()) {
      const value = D(posted[i].value).abs();
      if (o.kind === 'used') usedCost = usedCost.add(value);
      else ins.push({ itemId: o.line.itemId, warehouseId: r.warehouseId, qty: o.line.returnedQty, rate: value.div(D(o.line.returnedQty)).toFixed(6), batchNo: o.line.batchNo, line: o.line.lineNo, allowExpired: true });
    }
    // 2. Processed goods come in at material cost + job charges, shared by quantity.
    const outputs = lines.filter((l) => l.kind === 'output');
    const productValue = usedCost.add(D(r.jobCharges));
    const totalOut = outputs.reduce((s, l) => s.add(D(l.qty)), ZERO);
    let remaining = productValue;
    for (const [i, o] of outputs.entries()) {
      const value = i === outputs.length - 1 ? remaining : productValue.mul(D(o.qty)).div(totalOut).round(2);
      remaining = remaining.sub(value);
      ins.push({ itemId: o.itemId, warehouseId: r.warehouseId, qty: o.qty, rate: value.div(D(o.qty)).toFixed(6), batchNo: o.batchNo, line: o.lineNo });
      await tx.update(jobWorkReceiptLines).set({ value: value.toFixed(2) }).where(eq(jobWorkReceiptLines.id, o.id));
    }
    await this.stock.post(tx, auth, voucher, ins);
    for (const m of materials) {
      await tx
        .update(jobWorkChallanLines)
        .set({ consumedQty: sql`${jobWorkChallanLines.consumedQty} + ${m.consumedQty}::numeric`, returnedQty: sql`${jobWorkChallanLines.returnedQty} + ${m.returnedQty}::numeric`, lossQty: sql`${jobWorkChallanLines.lossQty} + ${m.lossQty}::numeric` })
        .where(eq(jobWorkChallanLines.id, m.challanLineId!));
    }
    await tx.update(documents).set({ amount: productValue.toFixed(2) }).where(eq(documents.id, doc.id));
    await this.syncChallan(tx, auth, r.challanId);
  }

  private async unpostReceipt(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [r] = await tx.select().from(jobWorkReceipts).where(eq(jobWorkReceipts.id, doc.id));
    const lines = await tx.select().from(jobWorkReceiptLines).where(and(eq(jobWorkReceiptLines.receiptId, doc.id), eq(jobWorkReceiptLines.kind, 'material')));
    await this.stock.reverseVoucher(tx, auth, { id: doc.id, type: RECEIPT, number: doc.number, companyId: doc.companyId, postingDate: doc.docDate });
    for (const m of lines) {
      await tx
        .update(jobWorkChallanLines)
        .set({ consumedQty: sql`${jobWorkChallanLines.consumedQty} - ${m.consumedQty}::numeric`, returnedQty: sql`${jobWorkChallanLines.returnedQty} - ${m.returnedQty}::numeric`, lossQty: sql`${jobWorkChallanLines.lossQty} - ${m.lossQty}::numeric` })
        .where(eq(jobWorkChallanLines.id, m.challanLineId!));
    }
    await this.syncChallan(tx, auth, r.challanId);
  }

  /** Completes the challan when everything sent is accounted for; reopens it otherwise. */
  private async syncChallan(tx: Transaction, auth: AuthContext, challanId: string) {
    const doc = await this.documents.lock(tx, challanId, CHALLAN);
    const lines = await tx.select().from(jobWorkChallanLines).where(eq(jobWorkChallanLines.challanId, challanId));
    const open = lines.some((l) => pendingOf(l).cmp(ZERO) > 0);
    if (!open && doc.status === 'approved') {
      await this.documents.update(tx, auth, doc, { status: 'completed' });
      await tx.update(jobWorkChallans).set({ closedAt: new Date() }).where(eq(jobWorkChallans.id, challanId));
      await this.documents.activity(tx, auth, challanId, 'status', 'All material accounted for');
    } else if (open && doc.status === 'completed') {
      await this.documents.update(tx, auth, doc, { status: 'approved' });
      await tx.update(jobWorkChallans).set({ closedAt: null }).where(eq(jobWorkChallans.id, challanId));
      await this.documents.activity(tx, auth, challanId, 'status', 'Reopened');
    }
  }

  async receiptView(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('jobwork.challans.manage'), cancel: perms.has('jobwork.challans.cancel') });
    const [r] = await tx.select().from(jobWorkReceipts).where(eq(jobWorkReceipts.id, doc.id));
    const [challan] = await tx.select({ id: documents.id, number: documents.number, docDate: documents.docDate }).from(documents).where(eq(documents.id, r.challanId));
    const [worker] = await tx.select({ id: parties.id, name: parties.name, gstin: parties.gstin }).from(parties).where(eq(parties.id, r.jobWorkerId));
    const [wh] = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, r.warehouseId));
    const rows = await tx
      .select({ l: jobWorkReceiptLines, itemCode: items.code, itemName: items.name, uomCode: uoms.code })
      .from(jobWorkReceiptLines)
      .innerJoin(items, eq(items.id, jobWorkReceiptLines.itemId))
      .innerJoin(uoms, eq(uoms.id, jobWorkReceiptLines.uomId))
      .where(eq(jobWorkReceiptLines.receiptId, doc.id))
      .orderBy(asc(jobWorkReceiptLines.lineNo));
    const { tenantId: _t, id: _i, challanId: _c, jobWorkerId: _j, warehouseId: _w, ...rest } = r;
    return {
      ...header,
      ...rest,
      challan,
      jobWorker: worker,
      warehouse: wh,
      lines: rows.map(({ l: { tenantId: _lt, receiptId: _r, ...l }, ...more }) => ({ ...l, ...more })),
    };
  }
}
