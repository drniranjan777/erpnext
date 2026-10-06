import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import {
  billsOfEntry,
  creditNoteLines,
  creditNotes,
  debitNotes,
  documents,
  items,
  landedCosts,
  purchaseInvoiceLines,
  purchaseInvoices,
  salesInvoiceLines,
  salesInvoices,
  stockEntries,
  stockLedger,
  type DocType,
  type Transaction,
} from '@nextgen/database';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { DatabaseService } from '../../database/database.service';
import { DocumentsService, type DocumentRow } from '../documents/documents.service';
import type { SystemKey } from './chart-template';
import { LedgerService, type GlLine } from './ledger.service';

const D = Decimal.from;
const ZERO = D('0');
const neg = (d: Decimal) => ZERO.sub(d);

type Rule = (tx: Transaction, doc: DocumentRow) => Promise<GlLine[]>;

/** Documents whose posting is driven by the stock ledger only, and the account that takes the other side. */
const STOCK_ONLY: Partial<Record<DocType, SystemKey>> = {
  goods_receipt: 'grni',
  delivery_note: 'cogs',
  stock_count: 'stock_adjustment',
  job_work_challan: 'stock_adjustment',
  job_work_receipt: 'jobwork_accrued',
};

const STOCK_ENTRY_COUNTER: Record<string, SystemKey> = {
  opening_stock: 'opening_balance',
  material_receipt: 'stock_adjustment',
  material_issue: 'materials_consumed',
  transfer: 'stock_adjustment',
  adjustment: 'stock_adjustment',
};

const TAX_IN = { cgst: 'gst_in_cgst', sgst: 'gst_in_sgst', igst: 'gst_in_igst', cess: 'gst_in_cess' } as const;
const TAX_OUT = { cgst: 'gst_out_cgst', sgst: 'gst_out_sgst', igst: 'gst_out_igst', cess: 'gst_out_cess' } as const;
const TAX_RCM = { cgst: 'gst_rcm_cgst', sgst: 'gst_rcm_sgst', igst: 'gst_rcm_igst', cess: 'gst_rcm_cess' } as const;

/** Balancing differences beyond this are a bug in a rule, not rounding. */
const TOLERANCE = D('1');

/**
 * Posting rules: when an operational document is approved its accounting entries are written to
 * the general ledger (and reversed when it is cancelled). Stock values come from the stock
 * ledger, so the books and the stock valuation always agree.
 */
@Injectable()
export class PostingRulesService implements OnModuleInit {
  private readonly rules = new Map<DocType, Rule>();

  constructor(
    private readonly database: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly ledger: LedgerService,
  ) {}

  onModuleInit() {
    for (const [docType, counter] of Object.entries(STOCK_ONLY) as [DocType, SystemKey][]) {
      this.rules.set(docType, async (tx, doc) => this.stockLines(await this.stockNet(tx, doc.id), counter));
    }
    this.rules.set('stock_entry', async (tx, doc) => {
      const [e] = await tx.select({ purpose: stockEntries.purpose }).from(stockEntries).where(eq(stockEntries.id, doc.id));
      return this.stockLines(await this.stockNet(tx, doc.id), STOCK_ENTRY_COUNTER[e.purpose] ?? 'stock_adjustment');
    });
    this.rules.set('purchase_invoice', (tx, doc) => this.purchaseInvoice(tx, doc));
    this.rules.set('debit_note', (tx, doc) => this.debitNote(tx, doc));
    this.rules.set('sales_invoice', (tx, doc) => this.salesInvoice(tx, doc));
    this.rules.set('credit_note', (tx, doc) => this.creditNote(tx, doc));
    this.rules.set('landed_cost', async (tx, doc) => {
      const [lc] = await tx.select().from(landedCosts).where(eq(landedCosts.id, doc.id));
      const absorbed = await this.stockNet(tx, doc.id);
      return [
        { account: 'stock', debit: absorbed, narration: 'Charges added to stock' },
        { account: 'cogs', debit: D(lc.unabsorbed), narration: 'Charges on goods already used or sold' },
        { account: 'landed_cost_accrued', credit: absorbed.add(D(lc.unabsorbed)) },
      ];
    });
    this.rules.set('bill_of_entry', async (tx, doc) => {
      const [b] = await tx.select().from(billsOfEntry).where(eq(billsOfEntry.id, doc.id));
      const capitalised = await this.stockNet(tx, doc.id);
      const customs = D(b.bcdTotal).add(D(b.swsTotal));
      return [
        { account: 'stock', debit: capitalised, narration: 'Customs duty added to stock' },
        { account: 'cogs', debit: customs.sub(capitalised), narration: 'Customs duty on goods already used or sold' },
        { account: 'gst_in_igst', debit: D(b.igstTotal), narration: `Import IGST, BE ${b.boeNo}` },
        { account: 'gst_in_cess', debit: D(b.cessTotal) },
        { account: 'customs_payable', credit: customs.add(D(b.igstTotal)).add(D(b.cessTotal)), narration: `BE ${b.boeNo} at ${b.portCode}` },
      ];
    });

    for (const docType of this.rules.keys()) {
      this.documents.addListener(docType, {
        onApproved: (tx, auth, doc) => this.post(tx, auth, doc),
        onCancelled: (tx, auth, doc) => this.ledger.reverse(tx, auth, doc.id),
      });
    }
  }

  get docTypes() {
    return [...this.rules.keys()];
  }

  /** Writes the entries of one approved document. */
  async post(tx: Transaction, auth: AuthContext, doc: DocumentRow) {
    const rule = this.rules.get(doc.docType as DocType);
    if (!rule) return;
    const lines = await rule(tx, doc);
    await this.ledger.post(tx, auth, { id: doc.id, type: doc.docType, number: doc.number, companyId: doc.companyId, branchId: doc.branchId, postingDate: doc.docDate }, lines);
  }

  /**
   * Brings documents approved before the books existed (or since `from`) into the ledger,
   * oldest first. Idempotent: documents with entries are skipped.
   */
  async backPost(tx: Transaction, auth: AuthContext, companyId: string, from: string) {
    const docs = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.companyId, companyId), inArray(documents.docType, this.docTypes), inArray(documents.status, ['approved', 'completed']), gte(documents.docDate, from)))
      .orderBy(asc(documents.docDate), asc(documents.id));
    const posted = await this.ledger.isPosted(tx, docs.map((d) => d.id));
    let count = 0;
    for (const d of docs) {
      if (posted.has(d.id)) continue;
      await this.post(tx, auth, d);
      count++;
    }
    return { posted: count, skipped: docs.length - count };
  }

  // ---- rules -----------------------------------------------------------------------

  /** Net value of non-reversal stock movements of a voucher. */
  private async stockNet(tx: Transaction, voucherId: string) {
    const [r] = await tx
      .select({ v: sql<string>`coalesce(sum(${stockLedger.value}), 0)::numeric(18,2)::text` })
      .from(stockLedger)
      .where(and(eq(stockLedger.voucherId, voucherId), eq(stockLedger.isReversal, false)));
    return D(r.v);
  }

  private stockLines(net: Decimal, counter: SystemKey): GlLine[] {
    return [
      { account: 'stock', debit: net },
      { account: counter, credit: net },
    ];
  }

  private async itemMap(tx: Transaction, ids: string[]) {
    const rows = ids.length ? await tx.select({ id: items.id, type: items.type, income: items.incomeAccountCode, expense: items.expenseAccountCode }).from(items).where(inArray(items.id, ids)) : [];
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Adds `amount` to the balancing account so the voucher closes, refusing anything beyond rounding. */
  private balance(lines: GlLine[], account: SystemKey, label: string, expected?: Decimal): GlLine[] {
    const net = lines.reduce((s, l) => s.add(D(l.debit ?? '0')).sub(D(l.credit ?? '0')), ZERO);
    const diff = neg(net);
    const allowed = expected ? diff.sub(expected).abs() : diff.abs();
    if (allowed.cmp(TOLERANCE) > 0) throw new BadRequestException(`${label}: the accounting entries are off by ₹${diff.toFixed(2)}`);
    return [...lines, { account, debit: diff }];
  }

  private taxLines(map: typeof TAX_IN | typeof TAX_OUT | typeof TAX_RCM, side: 'debit' | 'credit', t: { cgst: Decimal; sgst: Decimal; igst: Decimal; cess: Decimal }): GlLine[] {
    return (['cgst', 'sgst', 'igst', 'cess'] as const).map((k) => ({ account: map[k], [side]: t[k] }));
  }

  private async salesInvoice(tx: Transaction, doc: DocumentRow): Promise<GlLine[]> {
    const [inv] = await tx.select().from(salesInvoices).where(eq(salesInvoices.id, doc.id));
    const lines = await tx.select().from(salesInvoiceLines).where(eq(salesInvoiceLines.invoiceId, doc.id));
    const its = await this.itemMap(tx, lines.map((l) => l.itemId));
    const byAccount = new Map<string, { account: GlLine['account']; amount: Decimal }>();
    for (const l of lines) {
      const it = its.get(l.itemId);
      const account: GlLine['account'] = it?.income ? { code: it.income } : inv.taxKind === 'export' || inv.taxKind === 'sez' ? 'sales_export' : it?.type === 'service' ? 'sales_services' : 'sales';
      const k = JSON.stringify(account);
      byAccount.set(k, { account, amount: (byAccount.get(k)?.amount ?? ZERO).add(D(l.taxableValue)) });
    }
    const cost = await this.stockNet(tx, doc.id);
    const out: GlLine[] = [
      { account: 'receivable', debit: D(inv.grandTotal), partyId: inv.customerId, againstVoucherId: doc.id },
      ...[...byAccount.values()].map((b) => ({ account: b.account, credit: b.amount })),
      ...(inv.reverseCharge ? [] : this.taxLines(TAX_OUT, 'credit', { cgst: D(inv.cgstTotal), sgst: D(inv.sgstTotal), igst: D(inv.igstTotal), cess: D(inv.cessTotal) })),
      // Goods dispatched with the invoice (invoice-cum-challan).
      { account: 'cogs', debit: neg(cost) },
      { account: 'stock', credit: neg(cost) },
    ];
    return this.balance(out, 'round_off', `Invoice ${doc.number}`, neg(D(inv.roundOff)));
  }

  private async creditNote(tx: Transaction, doc: DocumentRow): Promise<GlLine[]> {
    const [cn] = await tx.select().from(creditNotes).where(eq(creditNotes.id, doc.id));
    const lines = await tx.select({ taxable: creditNoteLines.taxableValue }).from(creditNoteLines).where(eq(creditNoteLines.creditNoteId, doc.id));
    const back = await this.stockNet(tx, doc.id);
    const out: GlLine[] = [
      { account: 'sales_returns', debit: lines.reduce((s, l) => s.add(D(l.taxable)), ZERO), narration: cn.reason },
      ...(cn.reverseCharge ? [] : this.taxLines(TAX_OUT, 'debit', { cgst: D(cn.cgstTotal), sgst: D(cn.sgstTotal), igst: D(cn.igstTotal), cess: D(cn.cessTotal) })),
      { account: 'receivable', credit: D(cn.grandTotal), partyId: cn.customerId, againstVoucherId: cn.invoiceId },
      { account: 'stock', debit: back, narration: 'Goods returned' },
      { account: 'cogs', credit: back },
    ];
    return this.balance(out, 'round_off', `Credit note ${doc.number}`, D(cn.roundOff));
  }

  private async purchaseInvoice(tx: Transaction, doc: DocumentRow): Promise<GlLine[]> {
    const [pi] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, doc.id));
    const lines = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.piId, doc.id));
    const its = await this.itemMap(tx, lines.map((l) => l.itemId));
    const out: GlLine[] = [];
    const eligible = { cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO };
    const all = { cgst: ZERO, sgst: ZERO, igst: ZERO, cess: ZERO };
    let ineligible = ZERO;
    for (const l of lines) {
      const taxable = D(l.taxableValue);
      if (l.grnLineId) {
        const variance = D(l.rateVariance);
        out.push({ account: 'grni', debit: taxable.sub(variance) }, { account: 'ppv', debit: variance });
      } else {
        const it = its.get(l.itemId);
        out.push({ account: it?.expense ? { code: it.expense } : it?.type === 'service' ? 'purchase_services' : 'purchase_expenses', debit: taxable, narration: l.description });
      }
      const t = { cgst: D(l.cgstAmount), sgst: D(l.sgstAmount), igst: D(l.igstAmount), cess: D(l.cessAmount) };
      for (const k of ['cgst', 'sgst', 'igst', 'cess'] as const) {
        all[k] = all[k].add(t[k]);
        if (l.itcEligible) eligible[k] = eligible[k].add(t[k]);
        else ineligible = ineligible.add(t[k]);
      }
    }
    out.push(...this.taxLines(TAX_IN, 'debit', eligible), { account: 'itc_ineligible', debit: ineligible });
    // Reverse charge: we owe the tax to the government, not the vendor.
    if (pi.reverseCharge) out.push(...this.taxLines(TAX_RCM, 'credit', all));
    out.push(
      { account: 'payable', credit: D(pi.grandTotal), partyId: pi.vendorId, againstVoucherId: doc.id, narration: `Bill ${pi.supplierInvoiceNo}` },
      { account: 'payable', debit: D(pi.tdsAmount), partyId: pi.vendorId, againstVoucherId: doc.id, narration: `TDS ${pi.tdsSection ?? ''}`.trim() },
      { account: 'tds_payable', credit: D(pi.tdsAmount), narration: pi.tdsSection ? `Section ${pi.tdsSection}` : null },
    );
    return this.balance(out, 'round_off', `Bill ${pi.supplierInvoiceNo}`, D(pi.roundOff));
  }

  private async debitNote(tx: Transaction, doc: DocumentRow): Promise<GlLine[]> {
    const [dn] = await tx.select().from(debitNotes).where(eq(debitNotes.id, doc.id));
    const stockOut = neg(await this.stockNet(tx, doc.id));
    const out: GlLine[] = [
      { account: 'payable', debit: D(dn.grandTotal), partyId: dn.vendorId, againstVoucherId: dn.piId, narration: dn.reason },
      ...(dn.reverseCharge ? [] : this.taxLines(TAX_IN, 'credit', { cgst: D(dn.cgstTotal), sgst: D(dn.sgstTotal), igst: D(dn.igstTotal), cess: D(dn.cessTotal) })),
      { account: 'stock', credit: stockOut, narration: dn.kind === 'return' ? 'Goods returned' : 'Price reduction on stock' },
    ];
    // What the stock did not absorb (goods already used, or price differences) goes to price variance.
    const net = out.reduce((s, l) => s.add(D(l.debit ?? '0')).sub(D(l.credit ?? '0')), ZERO);
    return [...out, { account: 'ppv', credit: net }];
  }
}
