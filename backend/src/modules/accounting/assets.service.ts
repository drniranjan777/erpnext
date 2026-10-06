import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { accounts, assetCategories, assetDepreciation, documents, fixedAssets, warehouses, type Transaction } from '@nextgen/database';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { decimalSchema, optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { AccountsService } from './accounts.service';
import { bookDepreciation, itBlockSchedule } from './depreciation';
import { JournalsService } from './journals.service';
import { LedgerService } from './ledger.service';

const D = Decimal.from;
const ZERO = D('0');

const positive = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,14}(\.\d{1,2})?$/.test(v) && Number(v) > 0, `${label} must be more than zero`);

export const categorySchema = z.object({
  companyId: z.uuid().optional(),
  name: z.string().trim().min(2).max(80),
  assetAccountId: z.uuid(),
  method: z.enum(['slm', 'wdv']).default('slm'),
  usefulLifeYears: positive('Useful life'),
  residualPct: decimalSchema(2, 'Residual %').transform((v) => v ?? '5'),
  itRatePct: decimalSchema(2, 'Income-tax rate').transform((v) => v ?? '15'),
});
export const assetSchema = z.object({
  companyId: z.uuid().optional(),
  branchId: z.uuid().nullable().optional(),
  name: z.string().trim().min(2).max(160),
  categoryId: z.uuid(),
  locationId: z.uuid().nullable().optional(),
  custodian: optionalText(120),
  serialNo: optionalText(80),
  purchaseDate: z.iso.date(),
  capitalisedOn: z.iso.date(),
  cost: positive('Cost'),
  residualValue: decimalSchema(2, 'Residual value'),
  sourceInvoiceId: z.uuid().nullable().optional(),
  /** Account the cost moves out of (CWIP, or where the bill was booked). Blank = already in the asset account. */
  capitaliseFromAccountId: z.uuid().nullable().optional(),
  notes: optionalText(1000),
});
export const depreciationRunSchema = z.object({ companyId: z.uuid().optional(), to: z.iso.date() });
export const disposeSchema = z.object({ date: z.iso.date(), amount: decimalSchema(2, 'Sale amount'), accountId: z.uuid().nullable().optional(), reason: z.string().trim().min(3).max(300) });
export const transferSchema = z.object({ locationId: z.uuid().nullable().optional(), custodian: optionalText(120) });

/** Default categories: Schedule II lives and Income-tax block rates. */
const DEFAULT_CATEGORIES = [
  { name: 'Plant and machinery', code: '4110', life: '15', it: '15' },
  { name: 'Furniture and fixtures', code: '4120', life: '10', it: '10' },
  { name: 'Vehicles', code: '4130', life: '8', it: '15' },
  { name: 'Computers', code: '4140', life: '3', it: '40' },
];

/**
 * Fixed asset register: capitalisation, Companies Act depreciation (SLM / WDV, day-based)
 * posted by journal, Income-tax block depreciation schedule, transfers and disposal.
 */
@Injectable()
export class AssetsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly ledger: LedgerService,
    private readonly journals: JournalsService,
    private readonly accountsSvc: AccountsService,
  ) {}

  onModuleInit() {
    // A cancelled depreciation journal takes its charge off the assets again.
    this.documents.addListener('journal_entry', {
      onCancelled: async (tx, _auth, doc) => {
        const rows = await tx.select().from(assetDepreciation).where(eq(assetDepreciation.journalId, doc.id));
        for (const r of rows) {
          await tx
            .update(fixedAssets)
            .set({ accumulatedDepreciation: sql`${fixedAssets.accumulatedDepreciation} - ${r.amount}::numeric`, depreciatedUntil: sql`(${r.fromDate}::date - 1)` })
            .where(eq(fixedAssets.id, r.assetId));
        }
        if (rows.length) await tx.delete(assetDepreciation).where(eq(assetDepreciation.journalId, doc.id));
      },
    });
  }

  // ---- Categories --------------------------------------------------------------------

  categories(auth: AuthContext, companyId?: string) {
    return this.database.run(auth, async (tx) => {
      const id = await this.accountsSvc.company(tx, companyId);
      await this.ledger.ensureBooks(tx, auth.tenantId, id, auth.userId);
      let rows = await tx.select().from(assetCategories).where(eq(assetCategories.companyId, id)).orderBy(asc(assetCategories.name));
      if (!rows.length) {
        const accs = await tx.select({ id: accounts.id, code: accounts.code }).from(accounts).where(and(eq(accounts.companyId, id), inArray(accounts.code, DEFAULT_CATEGORIES.map((c) => c.code))));
        for (const c of DEFAULT_CATEGORIES) {
          const acc = accs.find((a) => a.code === c.code);
          if (acc) await tx.insert(assetCategories).values({ tenantId: auth.tenantId, companyId: id, name: c.name, assetAccountId: acc.id, method: 'slm', usefulLifeYears: c.life, residualPct: '5', itRatePct: c.it, createdBy: auth.userId, updatedBy: auth.userId }).onConflictDoNothing();
        }
        rows = await tx.select().from(assetCategories).where(eq(assetCategories.companyId, id)).orderBy(asc(assetCategories.name));
      }
      return rows;
    });
  }

  saveCategory(auth: AuthContext, id: string | null, input: z.infer<typeof categorySchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, input.companyId);
      const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, input.assetAccountId), eq(accounts.companyId, companyId)));
      if (!acc || acc.isGroup || acc.nature !== 'asset') throw new BadRequestException({ message: 'Choose an asset account (not a group)', errors: [{ path: 'assetAccountId', message: 'Choose an asset account' }] });
      const values = { name: input.name, assetAccountId: acc.id, method: input.method, usefulLifeYears: input.usefulLifeYears, residualPct: input.residualPct, itRatePct: input.itRatePct, updatedBy: auth.userId };
      if (id) {
        const [row] = await tx.update(assetCategories).set(values).where(eq(assetCategories.id, id)).returning();
        if (!row) throw new NotFoundException('Category not found');
        return row;
      }
      const [row] = await tx.insert(assetCategories).values({ ...values, tenantId: auth.tenantId, companyId, createdBy: auth.userId }).returning();
      return row;
    });
  }

  // ---- Register ------------------------------------------------------------------------

  list(auth: AuthContext, q: { companyId?: string; status?: string }) {
    return this.database.run(auth, async (tx) => {
      const id = await this.accountsSvc.company(tx, q.companyId);
      const rows = await tx
        .select({ a: fixedAssets, category: assetCategories.name, location: warehouses.code })
        .from(fixedAssets)
        .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
        .leftJoin(warehouses, eq(warehouses.id, fixedAssets.locationId))
        .where(and(eq(fixedAssets.companyId, id), q.status ? eq(fixedAssets.status, q.status) : undefined))
        .orderBy(asc(fixedAssets.code));
      const items = rows.map(({ a, category, location }) => ({ ...this.present(a), category, location }));
      const sum = (k: 'cost' | 'accumulatedDepreciation' | 'netBookValue') => items.filter((i) => i.status === 'active').reduce((s, i) => s.add(D(i[k])), ZERO).toFixed(2);
      return { items, totals: { cost: sum('cost'), accumulated: sum('accumulatedDepreciation'), netBookValue: sum('netBookValue') } };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx
        .select({ a: fixedAssets, category: assetCategories, location: warehouses.code })
        .from(fixedAssets)
        .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
        .leftJoin(warehouses, eq(warehouses.id, fixedAssets.locationId))
        .where(eq(fixedAssets.id, id));
      if (!row) throw new NotFoundException('Asset not found');
      const history = await tx
        .select({ id: assetDepreciation.id, fromDate: assetDepreciation.fromDate, toDate: assetDepreciation.toDate, days: assetDepreciation.days, amount: assetDepreciation.amount, journalId: assetDepreciation.journalId, journalNumber: documents.number })
        .from(assetDepreciation)
        .innerJoin(documents, eq(documents.id, assetDepreciation.journalId))
        .where(eq(assetDepreciation.assetId, id))
        .orderBy(asc(assetDepreciation.fromDate));
      const refs = await tx.select({ id: documents.id, number: documents.number, docType: documents.docType }).from(documents).where(inArray(documents.id, [row.a.sourceInvoiceId, row.a.capitalisationJournalId, row.a.disposalJournalId].filter((v): v is string => !!v)));
      return { ...this.present(row.a), category: { id: row.category.id, name: row.category.name }, location: row.location, history, references: refs };
    });
  }

  private present(a: typeof fixedAssets.$inferSelect) {
    const { tenantId: _t, ...rest } = a;
    return { ...rest, netBookValue: D(a.cost).sub(D(a.accumulatedDepreciation)).toFixed(2) };
  }

  create(auth: AuthContext, input: z.infer<typeof assetSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, input.companyId);
      const [cat] = await tx.select().from(assetCategories).where(and(eq(assetCategories.id, input.categoryId), eq(assetCategories.companyId, companyId)));
      if (!cat) throw new BadRequestException({ message: 'Choose a category', errors: [{ path: 'categoryId', message: 'Choose a category' }] });
      if (input.capitalisedOn < input.purchaseDate) throw new BadRequestException({ message: 'Put to use on or after the purchase date', errors: [{ path: 'capitalisedOn', message: 'On or after the purchase date' }] });
      const residual = input.residualValue ?? D(input.cost).mul(D(cat.residualPct)).div(D('100')).toFixed(2);
      if (D(residual).cmp(D(input.cost)) >= 0) throw new BadRequestException({ message: 'Residual value must be below cost', errors: [{ path: 'residualValue', message: 'Below cost' }] });
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(fixedAssets);
      const code = `FA-${String(n + 1).padStart(5, '0')}`;
      let journalId: string | null = null;
      if (input.capitaliseFromAccountId) {
        const jv = await this.journals.createTx(
          tx,
          auth,
          {
            companyId,
            branchId: input.branchId ?? null,
            docDate: input.capitalisedOn,
            kind: 'journal',
            narration: `Capitalised ${code} ${input.name}`,
            lines: [
              { accountId: cat.assetAccountId, debit: D(input.cost).toFixed(2), credit: null, narration: `${code} ${input.name}` },
              { accountId: input.capitaliseFromAccountId, debit: null, credit: D(input.cost).toFixed(2), narration: `${code} ${input.name}` },
            ],
          },
          meta,
        );
        await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
        journalId = jv.id;
      }
      const [row] = await tx
        .insert(fixedAssets)
        .values({
          tenantId: auth.tenantId,
          companyId,
          branchId: input.branchId ?? null,
          code,
          name: input.name,
          categoryId: cat.id,
          locationId: input.locationId ?? null,
          custodian: input.custodian,
          serialNo: input.serialNo,
          purchaseDate: input.purchaseDate,
          capitalisedOn: input.capitalisedOn,
          cost: D(input.cost).toFixed(2),
          residualValue: residual,
          method: cat.method,
          usefulLifeYears: cat.usefulLifeYears,
          itRatePct: cat.itRatePct,
          sourceInvoiceId: input.sourceInvoiceId ?? null,
          capitalisationJournalId: journalId,
          notes: input.notes,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })
        .returning();
      return this.present(row);
    });
  }

  transfer(auth: AuthContext, id: string, input: z.infer<typeof transferSchema>) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx.update(fixedAssets).set({ locationId: input.locationId ?? null, custodian: input.custodian, updatedBy: auth.userId }).where(and(eq(fixedAssets.id, id), eq(fixedAssets.status, 'active'))).returning();
      if (!row) throw new NotFoundException('Active asset not found');
      return this.present(row);
    });
  }

  // ---- Depreciation ------------------------------------------------------------------

  /** Charges book depreciation up to a date for every active asset, in one journal. */
  run(auth: AuthContext, input: z.infer<typeof depreciationRunSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, input.companyId);
      const assets = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.companyId, companyId), eq(fixedAssets.status, 'active')));
      return this.charge(tx, auth, companyId, assets, input.to, meta);
    });
  }

  private async charge(tx: Transaction, auth: AuthContext, companyId: string, assets: (typeof fixedAssets.$inferSelect)[], to: string, meta: RequestMeta) {
    const charges = assets
      .map((a) => ({ a, d: bookDepreciation({ cost: a.cost, residualValue: a.residualValue, method: a.method as 'slm' | 'wdv', usefulLifeYears: a.usefulLifeYears, capitalisedOn: a.capitalisedOn, accumulated: a.accumulatedDepreciation, depreciatedUntil: a.depreciatedUntil, disposedOn: a.disposedOn }, to) }))
      .filter((c): c is { a: typeof c.a; d: NonNullable<typeof c.d> } => !!c.d && D(c.d.amount).cmp(ZERO) > 0);
    if (!charges.length) return { journalId: null, number: null, assets: 0, amount: '0.00' };
    const total = charges.reduce((s, c) => s.add(D(c.d.amount)), ZERO);
    const keys = await tx.select({ id: accounts.id, key: accounts.systemKey }).from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.systemKey, ['depreciation', 'accumulated_depreciation'])));
    const dep = keys.find((k) => k.key === 'depreciation');
    const accum = keys.find((k) => k.key === 'accumulated_depreciation');
    if (!dep || !accum) throw new BadRequestException('The chart of accounts needs depreciation and accumulated depreciation accounts');
    const jv = await this.journals.createTx(
      tx,
      auth,
      {
        companyId,
        docDate: to,
        kind: 'journal',
        narration: `Depreciation to ${to} (${charges.length} asset${charges.length === 1 ? '' : 's'})`,
        lines: [
          { accountId: dep.id, debit: total.toFixed(2), credit: null, narration: 'Depreciation (Companies Act)' },
          { accountId: accum.id, debit: null, credit: total.toFixed(2), narration: 'Accumulated depreciation' },
        ],
      },
      meta,
    );
    for (const c of charges) {
      await tx.insert(assetDepreciation).values({ tenantId: auth.tenantId, assetId: c.a.id, journalId: jv.id, fromDate: c.d.from, toDate: c.d.to, days: c.d.days, amount: c.d.amount });
      await tx.update(fixedAssets).set({ accumulatedDepreciation: D(c.a.accumulatedDepreciation).add(D(c.d.amount)).toFixed(2), depreciatedUntil: c.d.to }).where(eq(fixedAssets.id, c.a.id));
    }
    await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
    const posted = await this.documents.find(tx, jv.id, 'journal_entry');
    return { journalId: jv.id, number: posted.number, assets: charges.length, amount: total.toFixed(2) };
  }

  /** Sale / scrapping: depreciation to the date, then cost and depreciation out, gain or loss booked. */
  dispose(auth: AuthContext, id: string, input: z.infer<typeof disposeSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id)).for('update');
      if (!a) throw new NotFoundException('Asset not found');
      if (a.status !== 'active') throw new ConflictException('This asset is already disposed of');
      if (input.date < a.capitalisedOn) throw new BadRequestException('Disposal date is before the asset was put to use');
      if (a.depreciatedUntil && input.date < a.depreciatedUntil) throw new ConflictException(`Depreciation is already charged up to ${a.depreciatedUntil}; dispose on or after that date`);
      await this.charge(tx, auth, a.companyId, [a], input.date, meta);
      const [fresh] = await tx.select().from(fixedAssets).where(eq(fixedAssets.id, id));
      const [cat] = await tx.select().from(assetCategories).where(eq(assetCategories.id, a.categoryId));
      const keys = await tx.select({ id: accounts.id, key: accounts.systemKey }).from(accounts).where(and(eq(accounts.companyId, a.companyId), inArray(accounts.systemKey, ['accumulated_depreciation', 'asset_disposal'])));
      const amount = D(input.amount ?? '0');
      if (amount.cmp(ZERO) > 0 && !input.accountId) throw new BadRequestException({ message: 'Choose the bank / cash account the sale money came into', errors: [{ path: 'accountId', message: 'Required with a sale amount' }] });
      const nbv = D(fresh.cost).sub(D(fresh.accumulatedDepreciation));
      const gain = amount.sub(nbv);
      const lines = [
        { accountId: keys.find((k) => k.key === 'accumulated_depreciation')!.id, debit: D(fresh.accumulatedDepreciation).toFixed(2), credit: null, narration: `${a.code} depreciation written back` },
        ...(amount.cmp(ZERO) > 0 ? [{ accountId: input.accountId!, debit: amount.toFixed(2), credit: null, narration: `${a.code} sale proceeds` }] : []),
        { accountId: cat.assetAccountId, debit: null, credit: D(fresh.cost).toFixed(2), narration: `${a.code} ${a.name} disposed` },
        ...(gain.isZero() ? [] : [{ accountId: keys.find((k) => k.key === 'asset_disposal')!.id, debit: gain.isNegative() ? ZERO.sub(gain).toFixed(2) : null, credit: gain.isNegative() ? null : gain.toFixed(2), narration: gain.isNegative() ? 'Loss on disposal' : 'Profit on disposal' }]),
      ].filter((l) => Number(l.debit ?? l.credit) > 0);
      const jv = await this.journals.createTx(tx, auth, { companyId: a.companyId, docDate: input.date, kind: 'journal', narration: `Disposal of ${a.code} ${a.name}: ${input.reason}`, lines }, meta);
      await this.documents.submit(tx, auth, await this.documents.find(tx, jv.id, 'journal_entry'), meta);
      const [row] = await tx.update(fixedAssets).set({ status: 'disposed', disposedOn: input.date, disposalAmount: amount.toFixed(2), disposalJournalId: jv.id, updatedBy: auth.userId }).where(eq(fixedAssets.id, id)).returning();
      return { ...this.present(row), gainOrLoss: gain.toFixed(2) };
    });
  }

  /** Income-tax depreciation by block for a financial year (report; not posted). */
  itSchedule(auth: AuthContext, q: { companyId?: string; fy: number }) {
    return this.database.run(auth, async (tx) => {
      const id = await this.accountsSvc.company(tx, q.companyId);
      const assets = await tx.select({ a: fixedAssets, block: assetCategories.itRatePct }).from(fixedAssets).innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId)).where(eq(fixedAssets.companyId, id));
      const blocks = new Map<string, typeof assets>();
      for (const r of assets) blocks.set(String(Number(r.a.itRatePct)), [...(blocks.get(String(Number(r.a.itRatePct))) ?? []), r]);
      return {
        fy: `${q.fy}-${String((q.fy + 1) % 100).padStart(2, '0')}`,
        blocks: [...blocks.entries()]
          .sort(([x], [y]) => Number(x) - Number(y))
          .map(([rate, rows]) => {
            const schedule = itBlockSchedule(rows.map((r) => ({ cost: r.a.cost, capitalisedOn: r.a.capitalisedOn, disposedOn: r.a.disposedOn, disposalAmount: r.a.disposalAmount })), rate, q.fy);
            return { ratePct: rate, assets: rows.length, year: schedule[schedule.length - 1] ?? null };
          }),
      };
    });
  }
}
