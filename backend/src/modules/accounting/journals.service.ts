import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { accounts, companies, costCenters, documents, journalLines, journals, parties, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { decimalSchema, optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { JobsService } from '../jobs/jobs.service';
import { GstReturnsService } from '../compliance/gst-returns.service';
import { LedgerService } from './ledger.service';

const DOC_TYPE = 'journal_entry' as const;
const RECUR_QUEUE = 'accounting.recurring_journal';
const D = Decimal.from;
const ZERO = D('0');

type Err = { path: string; message: string };
function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}

export const journalLineSchema = z.object({
  accountId: z.uuid(),
  partyId: z.uuid().nullable().optional(),
  costCenterId: z.uuid().nullable().optional(),
  debit: decimalSchema(2, 'Debit'),
  credit: decimalSchema(2, 'Credit'),
  narration: optionalText(300),
  againstVoucherId: z.uuid().nullable().optional(),
});
const journalHeader = {
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  docDate: z.iso.date().optional(),
  kind: z.enum(['journal', 'opening', 'reversing']).default('journal'),
  narration: optionalText(1000),
  reverseOn: z.iso.date().nullable().optional(),
  recurrence: z.enum(['monthly', 'quarterly', 'yearly']).nullable().optional(),
  recurUntil: z.iso.date().nullable().optional(),
  lines: z.array(journalLineSchema).min(2, 'A journal needs at least two lines').max(200),
};
export const createJournalSchema = z.object(journalHeader);
export type CreateJournalInput = z.infer<typeof createJournalSchema>;
export const updateJournalSchema = z.object({ ...journalHeader, version: z.number().int() });

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
const STEP = { monthly: 1, quarterly: 3, yearly: 12 } as const;
const SYSTEM_META: RequestMeta = { ip: null, userAgent: 'system', requestId: 'accounting' };

/** Journal vouchers: manual entries, opening balances, reversing accruals and recurring entries. */
@Injectable()
export class JournalsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly ledger: LedgerService,
    private readonly jobs: JobsService,
    private readonly gstReturns: GstReturnsService,
  ) {}

  onModuleInit() {
    this.documents.registerHooks(DOC_TYPE, {
      amendable: false,
      onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
      onCancelled: (tx, auth, doc) => this.ledger.reverse(tx, auth, doc.id),
    });
    this.gstReturns.postJournal = (auth, companyId, date, narration, lines, meta) =>
      this.database.run(auth, async (tx) => {
        const j = await this.createTx(tx, auth, { companyId, docDate: date, kind: 'journal', narration, lines: lines.map((l) => ({ ...l, partyId: null, costCenterId: null, againstVoucherId: null })) }, meta);
        await this.documents.submit(tx, auth, await this.documents.find(tx, j.id, DOC_TYPE), meta);
        const posted = await this.documents.find(tx, j.id, DOC_TYPE);
        return { id: j.id, number: posted.number };
      });
    this.jobs.register(RECUR_QUEUE, (payload, ctx) => this.recur(ctx.tenantId, String(payload.journalId), String(payload.userId)));
  }

  list(auth: AuthContext, q: { status?: string; q?: string; limit: number; cursor?: string }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q?.replace(/[%_\\]/g, '');
      const rows = await tx
        .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate, kind: journals.kind, narration: journals.narration, totalDebit: journals.totalDebit, recurrence: journals.recurrence })
        .from(documents)
        .innerJoin(journals, eq(journals.id, documents.id))
        .where(
          and(
            eq(documents.docType, DOC_TYPE),
            q.status ? eq(documents.status, q.status as 'approved') : undefined,
            term ? or(ilike(documents.number, `%${term}%`), ilike(journals.narration, `%${term}%`)) : undefined,
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

  create(auth: AuthContext, input: CreateJournalInput, meta: RequestMeta) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, input, meta));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: CreateJournalInput, meta: RequestMeta, extra: { reversalOfId?: string; recurredFromId?: string; kind?: 'closing' } = {}) {
    const companyId = input.companyId ?? (await this.defaultCompany(tx));
    const p = await this.prepare(tx, companyId, input);
    const doc = await this.documents.create(tx, auth, { docType: DOC_TYPE, companyId, branchId: input.branchId ?? null, docDate: input.docDate ?? todayIST(), title: input.narration?.slice(0, 120) ?? null, amount: p.total.toFixed(2) });
    await tx.insert(journals).values({ id: doc.id, tenantId: auth.tenantId, ...p.header, ...(extra.kind ? { kind: extra.kind } : {}), reversalOfId: extra.reversalOfId ?? null, recurredFromId: extra.recurredFromId ?? null });
    await tx.insert(journalLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, journalId: doc.id })));
    await this.documents.log(tx, auth, doc, 'document.created', meta, { lines: p.lines.length, amount: p.total.toFixed(2) });
    return this.view(tx, auth, doc);
  }

  update(auth: AuthContext, id: string, input: CreateJournalInput & { version: number }, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const doc = await this.documents.lock(tx, id, DOC_TYPE, input.version);
      this.documents.assertEditable(doc);
      const p = await this.prepare(tx, doc.companyId, input);
      await tx.update(journals).set(p.header).where(eq(journals.id, id));
      await tx.delete(journalLines).where(eq(journalLines.journalId, id));
      await tx.insert(journalLines).values(p.lines.map((l) => ({ ...l, tenantId: auth.tenantId, journalId: id })));
      const updated = await this.documents.update(tx, auth, doc, { title: input.narration?.slice(0, 120) ?? null, amount: p.total.toFixed(2), ...(input.docDate && !doc.number ? { docDate: input.docDate } : {}) });
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

  private async defaultCompany(tx: Transaction) {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)).orderBy(asc(companies.createdAt)).limit(1);
    if (!c) fail([{ path: 'companyId', message: 'No company found' }]);
    return c.id;
  }

  private async prepare(tx: Transaction, companyId: string, input: CreateJournalInput) {
    const errors: Err[] = [];
    const accRows = await tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.id, input.lines.map((l) => l.accountId))));
    const partyIds = input.lines.map((l) => l.partyId).filter((v): v is string => !!v);
    const partyRows = partyIds.length ? await tx.select({ id: parties.id }).from(parties).where(inArray(parties.id, partyIds)) : [];
    const ccIds = input.lines.map((l) => l.costCenterId).filter((v): v is string => !!v);
    const ccRows = ccIds.length ? await tx.select({ id: costCenters.id }).from(costCenters).where(and(eq(costCenters.companyId, companyId), inArray(costCenters.id, ccIds))) : [];
    let dr = ZERO;
    let cr = ZERO;
    const lines = input.lines.map((l, i) => {
      const p = `lines.${i}`;
      const acc = accRows.find((a) => a.id === l.accountId);
      if (!acc) errors.push({ path: `${p}.accountId`, message: `Line ${i + 1}: account not found in this company` });
      else {
        if (acc.isGroup) errors.push({ path: `${p}.accountId`, message: `Line ${i + 1}: ${acc.name} is a group` });
        if (!acc.isActive) errors.push({ path: `${p}.accountId`, message: `Line ${i + 1}: ${acc.name} is inactive` });
        if (!acc.allowManual) errors.push({ path: `${p}.accountId`, message: `Line ${i + 1}: ${acc.name} is posted only by documents (stock, GRNI…)` });
        if (acc.isControl && !l.partyId) errors.push({ path: `${p}.partyId`, message: `Line ${i + 1}: choose the customer / vendor for ${acc.name}` });
      }
      if (l.partyId && !partyRows.some((r) => r.id === l.partyId)) errors.push({ path: `${p}.partyId`, message: `Line ${i + 1}: party not found` });
      if (l.costCenterId && !ccRows.some((r) => r.id === l.costCenterId)) errors.push({ path: `${p}.costCenterId`, message: `Line ${i + 1}: cost centre not found` });
      const d = D(l.debit ?? '0');
      const c = D(l.credit ?? '0');
      if (d.isZero() === c.isZero()) errors.push({ path: `${p}.debit`, message: `Line ${i + 1}: enter either a debit or a credit` });
      dr = dr.add(d);
      cr = cr.add(c);
      return { lineNo: i + 1, accountId: l.accountId, partyId: l.partyId ?? null, costCenterId: l.costCenterId ?? null, debit: d.toFixed(2), credit: c.toFixed(2), narration: l.narration, againstVoucherId: l.againstVoucherId ?? null };
    });
    if (dr.cmp(cr) !== 0) errors.push({ path: 'lines', message: `Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) must be equal` });
    if (input.kind === 'reversing' && !input.reverseOn) errors.push({ path: 'reverseOn', message: 'Give the date the entry reverses on' });
    if (input.kind === 'reversing' && input.reverseOn && input.reverseOn <= (input.docDate ?? todayIST())) errors.push({ path: 'reverseOn', message: 'The reversal date must be after the journal date' });
    if (errors.length) fail(errors);
    return {
      total: dr,
      header: {
        kind: input.kind,
        narration: input.narration,
        reverseOn: input.kind === 'reversing' ? (input.reverseOn ?? null) : null,
        recurrence: input.recurrence ?? null,
        recurUntil: input.recurrence ? (input.recurUntil ?? null) : null,
        totalDebit: dr.toFixed(2),
      },
      lines,
    };
  }

  private async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const [j] = await tx.select().from(journals).where(eq(journals.id, doc.id));
    const lines = await tx.select().from(journalLines).where(eq(journalLines.journalId, doc.id)).orderBy(asc(journalLines.lineNo));
    await this.ledger.post(
      tx,
      auth,
      { id: doc.id, type: DOC_TYPE, number: doc.number, companyId: doc.companyId, branchId: doc.branchId, postingDate: doc.docDate },
      lines.map((l) => ({ account: { id: l.accountId }, debit: l.debit, credit: l.credit, partyId: l.partyId, costCenterId: l.costCenterId, narration: l.narration ?? j.narration, againstVoucherId: l.againstVoucherId })),
    );
    // Reversing journal: the mirror entry is a journal of its own, dated on the reversal date.
    if (j.kind === 'reversing' && j.reverseOn) {
      const mirror = await this.createTx(
        tx,
        auth,
        {
          companyId: doc.companyId,
          branchId: doc.branchId,
          docDate: j.reverseOn,
          kind: 'journal',
          narration: `Reversal of ${doc.number}${j.narration ? `: ${j.narration}` : ''}`,
          lines: lines.map((l) => ({ accountId: l.accountId, partyId: l.partyId, costCenterId: l.costCenterId, debit: l.credit, credit: l.debit, narration: l.narration, againstVoucherId: l.againstVoucherId })),
        },
        SYSTEM_META,
        { reversalOfId: doc.id },
      );
      await this.documents.submit(tx, auth, await this.documents.find(tx, mirror.id, DOC_TYPE), SYSTEM_META);
    }
    if (j.recurrence) {
      const next = addMonths(doc.docDate, STEP[j.recurrence as keyof typeof STEP]);
      if (!j.recurUntil || next <= j.recurUntil) {
        await this.jobs.enqueue(tx, auth.tenantId, RECUR_QUEUE, { journalId: doc.id, userId: auth.userId }, { runAt: new Date(`${next}T06:00:00+05:30`), dedupeKey: `jv-recur:${doc.id}`, maxAttempts: 3 });
      }
    }
  }

  /** Recurring journal: posts the next copy and schedules the one after. */
  private async recur(tenantId: string, journalId: string, userId: string) {
    const auth = { tenantId, userId, membershipId: '', sessionId: '' } as AuthContext;
    await this.database.run({ tenantId, userId }, async (tx) => {
      const [doc] = await tx.select().from(documents).where(eq(documents.id, journalId));
      if (!doc || doc.status !== 'approved') return;
      const [j] = await tx.select().from(journals).where(eq(journals.id, journalId));
      const lines = await tx.select().from(journalLines).where(eq(journalLines.journalId, journalId)).orderBy(asc(journalLines.lineNo));
      const copy = await this.createTx(
        tx,
        auth,
        {
          companyId: doc.companyId,
          branchId: doc.branchId,
          docDate: addMonths(doc.docDate, STEP[j.recurrence as keyof typeof STEP]),
          kind: 'journal',
          narration: j.narration,
          recurrence: j.recurrence as keyof typeof STEP,
          recurUntil: j.recurUntil,
          lines: lines.map((l) => ({ accountId: l.accountId, partyId: l.partyId, costCenterId: l.costCenterId, debit: l.debit, credit: l.credit, narration: l.narration, againstVoucherId: null })),
        },
        SYSTEM_META,
        { recurredFromId: journalId },
      );
      await this.documents.submit(tx, auth, await this.documents.find(tx, copy.id, DOC_TYPE), SYSTEM_META);
    });
  }

  async view(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const header = await this.documents.view(tx, auth, doc, { manage: perms.has('accounting.journals.manage'), cancel: perms.has('accounting.journals.cancel') });
    const [j] = await tx.select().from(journals).where(eq(journals.id, doc.id));
    const rows = await tx
      .select({ l: journalLines, accountCode: accounts.code, accountName: accounts.name, partyName: parties.name, costCenter: costCenters.code })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .leftJoin(parties, eq(parties.id, journalLines.partyId))
      .leftJoin(costCenters, eq(costCenters.id, journalLines.costCenterId))
      .where(eq(journalLines.journalId, doc.id))
      .orderBy(asc(journalLines.lineNo));
    const related = await tx
      .select({ id: documents.id, number: documents.number, status: documents.status, docDate: documents.docDate })
      .from(journals)
      .innerJoin(documents, eq(documents.id, journals.id))
      .where(or(eq(journals.reversalOfId, doc.id), eq(journals.recurredFromId, doc.id)));
    const { tenantId: _t, id: _i, ...rest } = j;
    return { ...header, ...rest, lines: rows.map(({ l: { tenantId: _lt, journalId: _j, ...l }, ...more }) => ({ ...l, ...more })), related };
  }
}
