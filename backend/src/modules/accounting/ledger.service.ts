import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { accountingSettings, accounts, companies, glEntries, type Transaction } from '@nextgen/database';
import { and, eq, inArray } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { fiscalYearOf, todayIST } from '../../common/fiscal-year';
import { CHART_TEMPLATE, type SystemKey, type TemplateAccount } from './chart-template';

const D = Decimal.from;
const ZERO = D('0');

export interface GlVoucher {
  id: string;
  type: string;
  number: string | null;
  companyId: string;
  branchId: string | null;
  postingDate: string;
}

export interface GlLine {
  /** A system key ("receivable") or an account id. */
  account: SystemKey | { id: string } | { code: string };
  debit?: string | Decimal;
  credit?: string | Decimal;
  partyId?: string | null;
  costCenterId?: string | null;
  narration?: string | null;
  againstVoucherId?: string | null;
}

/**
 * The general ledger: sets up a company's books, posts balanced vouchers and reverses them.
 * Every posting checks the period lock and that debits equal credits to the paisa.
 */
@Injectable()
export class LedgerService {
  /** Creates the default chart and book settings for a company the first time it posts. */
  async ensureBooks(tx: Transaction, tenantId: string, companyId: string, userId?: string) {
    const [s] = await tx.select().from(accountingSettings).where(eq(accountingSettings.companyId, companyId));
    if (s) return s;
    const [company] = await tx.select({ fyStartMonth: companies.fyStartMonth }).from(companies).where(eq(companies.id, companyId));
    const insert = async (list: TemplateAccount[], parentId: string | null, line: string | null) => {
      for (const t of list) {
        const [row] = await tx
          .insert(accounts)
          .values({
            tenantId,
            companyId,
            code: t.code,
            name: t.name,
            parentId,
            isGroup: !!t.group,
            nature: t.nature,
            systemKey: t.key ?? null,
            reportLine: t.reportLine ?? line,
            isControl: !!t.control,
            accountType: t.type ?? null,
            allowManual: t.manual !== false,
            createdBy: userId ?? null,
            updatedBy: userId ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: accounts.id });
        if (row && t.children) await insert(t.children, row.id, t.reportLine ?? line);
      }
    };
    await insert(CHART_TEMPLATE, null, null);
    const [row] = await tx
      .insert(accountingSettings)
      .values({ companyId, tenantId, booksFrom: fiscalYearOf(todayIST(), company?.fyStartMonth ?? 4).start, updatedBy: userId ?? null })
      .onConflictDoNothing()
      .returning();
    return row ?? (await tx.select().from(accountingSettings).where(eq(accountingSettings.companyId, companyId)))[0];
  }

  /** Adds template accounts a company's chart is missing (system accounts added in later releases). */
  async addMissingTemplateAccounts(tx: Transaction, tenantId: string, companyId: string) {
    const rows = await tx.select({ id: accounts.id, code: accounts.code, key: accounts.systemKey }).from(accounts).where(eq(accounts.companyId, companyId));
    const keys = new Set(rows.map((r) => r.key).filter(Boolean));
    const byCode = new Map(rows.map((r) => [r.code, r.id]));
    let added = 0;
    const walk = async (list: TemplateAccount[], parentCode: string | null, line: string | null) => {
      for (const t of list) {
        if (t.key && !keys.has(t.key) && !byCode.has(t.code) && parentCode && byCode.has(parentCode)) {
          const [row] = await tx
            .insert(accounts)
            .values({ tenantId, companyId, code: t.code, name: t.name, parentId: byCode.get(parentCode)!, isGroup: !!t.group, nature: t.nature, systemKey: t.key, reportLine: t.reportLine ?? line, isControl: !!t.control, accountType: t.type ?? null, allowManual: t.manual !== false })
            .onConflictDoNothing()
            .returning({ id: accounts.id });
          if (row) {
            byCode.set(t.code, row.id);
            added++;
          }
        }
        if (t.children) await walk(t.children, t.code, t.reportLine ?? line);
      }
    };
    await walk(CHART_TEMPLATE, null, null);
    return added;
  }

  async resolveAccounts(tx: Transaction, companyId: string, lines: GlLine[], retried = false): Promise<{ id: string; code: string; key: string | null; isGroup: boolean; isActive: boolean; isControl: boolean; name: string; companyId: string }[]> {
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code, key: accounts.systemKey, isGroup: accounts.isGroup, isActive: accounts.isActive, isControl: accounts.isControl, name: accounts.name, companyId: accounts.companyId })
      .from(accounts)
      .where(eq(accounts.companyId, companyId));
    const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const byCode = new Map(rows.map((r) => [r.code.toLowerCase(), r]));
    const find = (l: GlLine) => (typeof l.account === 'string' ? byKey.get(l.account) : 'id' in l.account ? byId.get(l.account.id) : byCode.get(l.account.code.toLowerCase()));
    // A system account added in a later release: create it in this company's chart, then retry.
    if (!retried && lines.some((l) => typeof l.account === 'string' && !find(l))) {
      const tenantId = rows[0] ? (await tx.select({ t: accounts.tenantId }).from(accounts).where(eq(accounts.id, rows[0].id)))[0].t : null;
      if (tenantId && (await this.addMissingTemplateAccounts(tx, tenantId, companyId))) return this.resolveAccounts(tx, companyId, lines, true);
    }
    return lines.map((l) => {
      const acc = find(l);
      if (!acc) {
        const what = typeof l.account === 'string' ? `the ${l.account.replace(/_/g, ' ')} account` : 'id' in l.account ? 'an account of another company' : `account ${l.account.code}`;
        throw new BadRequestException(`The chart of accounts has no ${what}. Add it under Accounting → Chart of accounts.`);
      }
      if (acc.isGroup) throw new BadRequestException(`${acc.code} ${acc.name} is a group: post to an account under it`);
      return acc;
    });
  }

  async settings(tx: Transaction, companyId: string) {
    const [s] = await tx.select().from(accountingSettings).where(eq(accountingSettings.companyId, companyId));
    return s ?? null;
  }

  async assertOpen(tx: Transaction, companyId: string, date: string) {
    const s = await this.settings(tx, companyId);
    if (s?.lockedUntil && date <= s.lockedUntil) throw new ConflictException(`The books are locked up to ${s.lockedUntil}. Use a later date, or ask an accountant to reopen the period.`);
  }

  /** Posts a voucher. Lines with zero amounts are dropped; debits must equal credits. */
  async post(tx: Transaction, auth: AuthContext, v: GlVoucher, lines: GlLine[], opts: { reversal?: boolean } = {}) {
    await this.ensureBooks(tx, auth.tenantId, v.companyId, auth.userId);
    const clean = lines
      .map((l) => ({ ...l, dr: D(l.debit ?? '0').round(2), cr: D(l.credit ?? '0').round(2) }))
      .map((l) => {
        // A negative debit is a credit (and vice versa).
        const net = l.dr.sub(l.cr);
        return { ...l, dr: net.isNegative() ? ZERO : net, cr: net.isNegative() ? ZERO.sub(net) : ZERO };
      })
      .filter((l) => !l.dr.isZero() || !l.cr.isZero());
    if (!clean.length) return [];
    const dr = clean.reduce((s, l) => s.add(l.dr), ZERO);
    const cr = clean.reduce((s, l) => s.add(l.cr), ZERO);
    if (dr.cmp(cr) !== 0) throw new BadRequestException(`Voucher ${v.number ?? ''} does not balance: debits ${dr.toFixed(2)}, credits ${cr.toFixed(2)}`);
    if (!opts.reversal) await this.assertOpen(tx, v.companyId, v.postingDate);
    const accs = await this.resolveAccounts(tx, v.companyId, clean);
    clean.forEach((l, i) => {
      if (accs[i].isControl && !l.partyId) throw new BadRequestException(`${accs[i].name} needs the customer / vendor on the line`);
    });
    return tx
      .insert(glEntries)
      .values(
        clean.map((l, i) => ({
          tenantId: auth.tenantId,
          companyId: v.companyId,
          branchId: v.branchId,
          postingDate: v.postingDate,
          voucherType: v.type,
          voucherId: v.id,
          voucherNumber: v.number,
          accountId: accs[i].id,
          partyId: l.partyId ?? null,
          costCenterId: l.costCenterId ?? null,
          debit: l.dr.toFixed(2),
          credit: l.cr.toFixed(2),
          narration: l.narration ?? null,
          againstVoucherId: l.againstVoucherId ?? null,
          isReversal: !!opts.reversal,
          createdBy: auth.userId || null,
        })),
      )
      .returning();
  }

  /** Mirrors a voucher's entries (debit ↔ credit), dated as posted, or today if that period is locked. */
  async reverse(tx: Transaction, auth: AuthContext, voucherId: string) {
    const rows = await tx.select().from(glEntries).where(and(eq(glEntries.voucherId, voucherId), eq(glEntries.isReversal, false)));
    if (!rows.length) return;
    const s = await this.settings(tx, rows[0].companyId);
    const today = todayIST();
    await tx.insert(glEntries).values(
      rows.map((r) => ({
        tenantId: r.tenantId,
        companyId: r.companyId,
        branchId: r.branchId,
        postingDate: s?.lockedUntil && r.postingDate <= s.lockedUntil ? today : r.postingDate,
        voucherType: r.voucherType,
        voucherId: r.voucherId,
        voucherNumber: r.voucherNumber,
        accountId: r.accountId,
        partyId: r.partyId,
        costCenterId: r.costCenterId,
        debit: r.credit,
        credit: r.debit,
        narration: 'Cancelled',
        againstVoucherId: r.againstVoucherId,
        isReversal: true,
        createdBy: auth.userId || null,
      })),
    );
  }

  /** Whether a voucher already has ledger entries (for idempotent back-posting). */
  async isPosted(tx: Transaction, voucherIds: string[]) {
    if (!voucherIds.length) return new Set<string>();
    const rows = await tx.selectDistinct({ id: glEntries.voucherId }).from(glEntries).where(inArray(glEntries.voucherId, voucherIds));
    return new Set(rows.map((r) => r.id));
  }
}
