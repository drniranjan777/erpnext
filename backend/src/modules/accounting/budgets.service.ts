import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { accounts, budgetLines, budgets, documents, glEntries, items, purchaseOrderLines, purchaseOrders, type Transaction } from '@nextgen/database';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { fiscalYearOf } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import { AccountsService } from './accounts.service';

const D = Decimal.from;
const ZERO = D('0');

export const budgetSchema = z.object({
  companyId: z.uuid().optional(),
  fy: z.coerce.number().int().min(2000).max(2100),
  name: z.string().trim().min(2).max(80),
  control: z.enum(['none', 'warn', 'block']).default('warn'),
  lines: z
    .array(
      z.object({
        accountId: z.uuid(),
        costCenterId: z.uuid().nullable().optional(),
        /** 12 monthly amounts from the first month of the financial year; or give `annual` to spread evenly. */
        months: z.array(z.union([z.string(), z.number()]).transform((v) => String(v))).length(12).optional(),
        annual: z.union([z.string(), z.number()]).transform((v) => String(v)).optional(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Budgets by account (and cost centre) and month, budget-vs-actual, and budget control on
 * purchase orders: committed orders + actuals against the year's budget, warn or block.
 */
@Injectable()
export class BudgetsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly accountsSvc: AccountsService,
  ) {}

  onModuleInit() {
    this.documents.addValidator('purchase_order', (tx, _auth, doc) => this.checkOrder(tx, doc));
  }

  list(auth: AuthContext, companyId?: string) {
    return this.database.run(auth, async (tx) => {
      const id = await this.accountsSvc.company(tx, companyId);
      return tx.select().from(budgets).where(eq(budgets.companyId, id)).orderBy(asc(budgets.fy), asc(budgets.name));
    });
  }

  save(auth: AuthContext, id: string | null, input: z.infer<typeof budgetSchema>) {
    return this.database.run(auth, async (tx) => {
      const companyId = await this.accountsSvc.company(tx, input.companyId);
      const accs = await tx.select({ id: accounts.id, isGroup: accounts.isGroup, nature: accounts.nature, name: accounts.name }).from(accounts).where(and(eq(accounts.companyId, companyId), inArray(accounts.id, input.lines.map((l) => l.accountId))));
      for (const [i, l] of input.lines.entries()) {
        const a = accs.find((x) => x.id === l.accountId);
        if (!a || a.isGroup) throw new BadRequestException({ message: `Line ${i + 1}: choose an account (not a group)`, errors: [{ path: `lines.${i}.accountId`, message: 'Choose an account' }] });
        if (!l.months && !l.annual) throw new BadRequestException({ message: `Line ${i + 1}: give the monthly amounts or the annual budget`, errors: [{ path: `lines.${i}.annual`, message: 'Required' }] });
      }
      let budgetId = id;
      if (id) {
        const [row] = await tx.update(budgets).set({ name: input.name, fy: input.fy, control: input.control, updatedBy: auth.userId }).where(eq(budgets.id, id)).returning();
        if (!row) throw new NotFoundException('Budget not found');
        await tx.delete(budgetLines).where(eq(budgetLines.budgetId, id));
      } else {
        const [dup] = await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.companyId, companyId), eq(budgets.fy, input.fy), eq(budgets.name, input.name)));
        if (dup) throw new ConflictException({ message: 'A budget with this name exists for the year', errors: [{ path: 'name', message: 'Already used' }] });
        const [row] = await tx.insert(budgets).values({ tenantId: auth.tenantId, companyId, fy: input.fy, name: input.name, control: input.control, createdBy: auth.userId, updatedBy: auth.userId }).returning();
        budgetId = row.id;
      }
      const rows = input.lines.flatMap((l) => {
        const months = l.months ?? spread(l.annual!);
        return months.map((amount, i) => ({ tenantId: auth.tenantId, budgetId: budgetId!, accountId: l.accountId, costCenterId: l.costCenterId ?? null, month: i + 1, amount: D(amount).toFixed(2) }));
      });
      await tx.insert(budgetLines).values(rows);
      return this.report(tx, budgetId!);
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.report(tx, id));
  }

  /** Budget vs actual per account and month. */
  private async report(tx: Transaction, id: string) {
    const [b] = await tx.select().from(budgets).where(eq(budgets.id, id));
    if (!b) throw new NotFoundException('Budget not found');
    const lines = await tx.select({ l: budgetLines, code: accounts.code, name: accounts.name, nature: accounts.nature }).from(budgetLines).innerJoin(accounts, eq(accounts.id, budgetLines.accountId)).where(eq(budgetLines.budgetId, id)).orderBy(asc(accounts.code), asc(budgetLines.month));
    const fy = { start: `${b.fy}-04-01`, end: `${b.fy + 1}-03-31` };
    const accountIds = [...new Set(lines.map((x) => x.l.accountId))];
    const actual = accountIds.length
      ? await tx
          .select({ accountId: glEntries.accountId, month: sql<number>`((extract(year from ${glEntries.postingDate})::int - ${b.fy}) * 12 + extract(month from ${glEntries.postingDate})::int - 3)::int`, v: sql<string>`sum(${glEntries.debit} - ${glEntries.credit})::text` })
          .from(glEntries)
          .where(and(inArray(glEntries.accountId, accountIds), gte(glEntries.postingDate, fy.start), lte(glEntries.postingDate, fy.end)))
          .groupBy(glEntries.accountId, sql`2`)
      : [];
    const byAccount = new Map<string, { accountId: string; code: string; name: string; budget: Decimal[]; actual: Decimal[] }>();
    const natures = new Map(lines.map((x) => [x.l.accountId, x.nature]));
    for (const x of lines) {
      const e = byAccount.get(x.l.accountId) ?? { accountId: x.l.accountId, code: x.code, name: x.name, budget: Array(12).fill(ZERO), actual: Array(12).fill(ZERO) };
      e.budget[x.l.month - 1] = e.budget[x.l.month - 1].add(D(x.l.amount));
      byAccount.set(x.l.accountId, e);
    }
    for (const a of actual) {
      const e = byAccount.get(a.accountId);
      if (!e || a.month < 1 || a.month > 12) continue;
      e.actual[a.month - 1] = natures.get(a.accountId) === 'income' ? ZERO.sub(D(a.v)) : D(a.v);
    }
    const rows = [...byAccount.values()].map((e) => {
      const budget = e.budget.reduce((s, v) => s.add(v), ZERO);
      const act = e.actual.reduce((s, v) => s.add(v), ZERO);
      return { accountId: e.accountId, code: e.code, name: e.name, months: e.budget.map((v, i) => ({ budget: v.toFixed(2), actual: e.actual[i].toFixed(2) })), budget: budget.toFixed(2), actual: act.toFixed(2), variance: budget.sub(act).toFixed(2), usedPct: budget.isZero() ? null : Number(act.mul(D('100')).div(budget).toFixed(1)) };
    });
    const { tenantId: _t, ...rest } = b;
    return { ...rest, rows };
  }

  /** Purchase order submission: committed + actual spend against the annual budget of each expense account. */
  private async checkOrder(tx: Transaction, doc: DocumentRow) {
    const fy = fiscalYearOf(doc.docDate);
    const fyStart = Number(fy.start.slice(0, 4));
    const active = await tx.select().from(budgets).where(and(eq(budgets.companyId, doc.companyId), eq(budgets.fy, fyStart), eq(budgets.isActive, true), sql`${budgets.control} <> 'none'`));
    if (!active.length) return;
    // Which expense account each line will post to (services / non-stock items with an expense account).
    const lines = await tx
      .select({ taxable: purchaseOrderLines.taxableValue, type: items.type, isStock: items.isStockItem, expense: items.expenseAccountCode })
      .from(purchaseOrderLines)
      .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
      .where(eq(purchaseOrderLines.poId, doc.id));
    const accs = await tx.select({ id: accounts.id, code: accounts.code, key: accounts.systemKey }).from(accounts).where(eq(accounts.companyId, doc.companyId));
    const byAccount = new Map<string, Decimal>();
    for (const l of lines) {
      if (l.isStock) continue;
      const acc = l.expense ? accs.find((a) => a.code === l.expense) : accs.find((a) => a.key === (l.type === 'service' ? 'purchase_services' : 'purchase_expenses'));
      if (acc) byAccount.set(acc.id, (byAccount.get(acc.id) ?? ZERO).add(D(l.taxable)));
    }
    if (!byAccount.size) return;
    const problems: string[] = [];
    let block = false;
    for (const b of active) {
      const bl = await tx
        .select({ accountId: budgetLines.accountId, total: sql<string>`sum(${budgetLines.amount})::text` })
        .from(budgetLines)
        .where(and(eq(budgetLines.budgetId, b.id), inArray(budgetLines.accountId, [...byAccount.keys()])))
        .groupBy(budgetLines.accountId);
      for (const line of bl) {
        const [act] = await tx.select({ v: sql<string>`coalesce(sum(${glEntries.debit} - ${glEntries.credit}), 0)::text` }).from(glEntries).where(and(eq(glEntries.accountId, line.accountId), gte(glEntries.postingDate, fy.start), lte(glEntries.postingDate, fy.end)));
        // Open orders already committed against the account (approved, not yet billed), other than this one.
        const committed = await this.committed(tx, doc, line.accountId, accs, fy);
        const want = byAccount.get(line.accountId)!;
        const total = D(act.v).add(committed).add(want);
        if (total.cmp(D(line.total)) > 0) {
          const acc = accs.find((a) => a.id === line.accountId)!;
          problems.push(`${acc.code}: spent ₹${D(act.v).toFixed(2)} + ordered ₹${committed.toFixed(2)} + this order ₹${want.toFixed(2)} exceeds the ${b.name} budget of ₹${D(line.total).toFixed(2)}`);
          if (b.control === 'block') block = true;
        }
      }
    }
    if (!problems.length) return;
    if (block) throw new ConflictException(`Over budget: ${problems.join('; ')}`);
    await this.documents.activity(tx, { tenantId: doc.tenantId, userId: doc.createdBy ?? '', membershipId: '', sessionId: '' }, doc.id, 'comment', `Budget warning: ${problems.join('; ')}`);
  }

  private async committed(tx: Transaction, doc: DocumentRow, accountId: string, accs: { id: string; code: string; key: string | null }[], fy: { start: string; end: string }) {
    const rows = await tx
      .select({ open: sql<string>`(${purchaseOrderLines.qty} - ${purchaseOrderLines.billedQty}) * ${purchaseOrderLines.taxableValue} / nullif(${purchaseOrderLines.qty}, 0)`, type: items.type, isStock: items.isStockItem, expense: items.expenseAccountCode })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId))
      .innerJoin(documents, eq(documents.id, purchaseOrders.id))
      .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
      .where(and(eq(documents.companyId, doc.companyId), eq(documents.status, 'approved'), sql`${documents.id} <> ${doc.id}`, gte(documents.docDate, fy.start), lte(documents.docDate, fy.end), sql`${purchaseOrderLines.qty} > ${purchaseOrderLines.billedQty}`));
    let total = ZERO;
    for (const r of rows) {
      if (r.isStock) continue;
      const acc = r.expense ? accs.find((a) => a.code === r.expense) : accs.find((a) => a.key === (r.type === 'service' ? 'purchase_services' : 'purchase_expenses'));
      if (acc?.id === accountId) total = total.add(D(r.open ?? '0'));
    }
    return total;
  }
}

/** Annual amount spread over 12 months, the rounding difference in the last month. */
export function spread(annual: string) {
  const per = D(annual).div(D('12')).round(2);
  const months = Array(11).fill(per.toFixed(2));
  months.push(D(annual).sub(per.mul(D('11'))).toFixed(2));
  return months as string[];
}

