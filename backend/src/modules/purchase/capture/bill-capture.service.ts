import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { branches, companies, documents, gstinError, items, itemVendors, parties, purchaseInvoices } from '@nextgen/database';
import { and, eq, ilike, isNotNull, ne } from 'drizzle-orm';
import type { AuthContext } from '../../../common/auth-context';
import { Decimal } from '../../../common/decimal';
import { todayIST } from '../../../common/fiscal-year';
import type { Env } from '../../../config/env';
import { DatabaseService } from '../../../database/database.service';
import { InvoicesService } from '../invoices.service';
import { extractWithAi } from './ai-extractor';
import { extractFromText, type ExtractedBill } from './text-extractor';

const D = Decimal.from;

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1 && !['pvt', 'ltd', 'private', 'limited', 'the', 'and', 'co', 'llp', 'm/s', 'ms'].includes(w)),
  );
/** Token overlap (Jaccard) between two names. */
export function similarity(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface CapturedLine {
  description: string;
  itemId: string | null;
  item: { id: string; code: string; name: string } | null;
  matchedBy: 'grn' | 'po' | 'vendor_code' | 'item_code' | 'name' | null;
  confidence: number;
  grnLineId: string | null;
  poLineId: string | null;
  qty: string;
  rate: string;
  discountPct: string | null;
  hsnCode: string | null;
  gstRate: string | null;
}

/**
 * Bill capture: reads a supplier's bill (AI for scans / PDFs when configured, the text parser
 * otherwise), matches the vendor by GSTIN or name and each row to an open GRN / PO line or an
 * item, reconciles the totals, and returns a draft purchase invoice for review.
 */
@Injectable()
export class BillCaptureService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly invoices: InvoicesService,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model = config.get('AI_MODEL', { infer: true });
  }

  get aiEnabled() {
    return !!this.apiKey;
  }

  async capture(auth: AuthContext, file: { buffer: Buffer; fileName: string; mimeType: string }) {
    const ownGstins = await this.database.run(auth, async (tx) => {
      const c = await tx.select({ g: companies.gstin }).from(companies).where(isNotNull(companies.gstin));
      const b = await tx.select({ g: branches.gstin }).from(branches).where(isNotNull(branches.gstin));
      return [...c, ...b].map((r) => r.g!);
    });
    const isText = file.mimeType.startsWith('text/') || /\.(txt|csv)$/i.test(file.fileName);
    let extracted: ExtractedBill;
    let extractor: 'ai' | 'text';
    if (this.aiEnabled && !isText) {
      extracted = await extractWithAi(this.apiKey, this.model, file).catch((e: Error) => {
        throw new UnprocessableEntityException(`Could not read the bill: ${e.message}`);
      });
      extractor = 'ai';
    } else if (isText) {
      extracted = extractFromText(file.buffer.toString('utf8'), ownGstins);
      extractor = 'text';
    } else {
      throw new UnprocessableEntityException('Reading scanned or PDF bills needs AI capture (set ANTHROPIC_API_KEY). Upload the bill as text, or enter it by hand.');
    }
    return { fileName: file.fileName, extractor, extracted, ...(await this.match(auth, extracted, ownGstins)) };
  }

  /** Vendor, line and total matching; also used for AI output. */
  async match(auth: AuthContext, x: ExtractedBill, ownGstins: string[]) {
    const warnings: string[] = [];
    const vendor = await this.database.run(auth, async (tx) => {
      if (x.supplierGstin && !gstinError(x.supplierGstin)) {
        const [v] = await tx.select({ id: parties.id, code: parties.code, name: parties.name, gstin: parties.gstin, isVendor: parties.isVendor }).from(parties).where(eq(parties.gstin, x.supplierGstin));
        if (v) return { ...v, matchedBy: 'gstin' as const };
      }
      if (x.supplierName) {
        const first = x.supplierName.split(' ').find((w) => w.length > 2) ?? x.supplierName;
        const candidates = await tx.select({ id: parties.id, code: parties.code, name: parties.name, gstin: parties.gstin, isVendor: parties.isVendor }).from(parties).where(and(eq(parties.isVendor, true), ilike(parties.name, `%${first.replace(/[%_\\]/g, '')}%`))).limit(50);
        const best = candidates.map((c) => ({ c, s: similarity(c.name, x.supplierName!) })).sort((a, b) => b.s - a.s)[0];
        if (best && best.s >= 0.5) return { ...best.c, matchedBy: 'name' as const };
      }
      return null;
    });
    if (!vendor) warnings.push(x.supplierGstin ? `No vendor with GSTIN ${x.supplierGstin}: add the vendor first` : 'Could not identify the vendor');
    else if (!vendor.isVendor) warnings.push(`${vendor.name} is not set up as a vendor`);
    if (x.supplierGstin && gstinError(x.supplierGstin)) warnings.push(`Supplier GSTIN ${x.supplierGstin} fails the check digit: re-check it`);
    if (x.buyerGstin && ownGstins.length && !ownGstins.includes(x.buyerGstin)) warnings.push(`The bill is addressed to GSTIN ${x.buyerGstin}, which is not one of ours`);
    if (x.invoiceDate && x.invoiceDate > todayIST()) warnings.push('The bill date is in the future');
    if (!x.invoiceNo) warnings.push('Bill number not found');
    if (!x.invoiceDate) warnings.push('Bill date not found');

    // Duplicate bill?
    if (vendor && x.invoiceNo) {
      const [dup] = await this.database.run(auth, (tx) =>
        tx
          .select({ number: documents.number })
          .from(purchaseInvoices)
          .innerJoin(documents, eq(documents.id, purchaseInvoices.id))
          .where(and(eq(purchaseInvoices.vendorId, vendor.id), eq(purchaseInvoices.supplierInvoiceNo, x.invoiceNo!), ne(documents.status, 'cancelled'))),
      );
      if (dup) warnings.push(`Bill ${x.invoiceNo} from this vendor is already entered${dup.number ? ` (${dup.number})` : ''}`);
    }

    const lines: CapturedLine[] = [];
    if (vendor) {
      const open = await this.invoices.billable(auth, vendor.id);
      const usedGrn = new Map<string, Decimal>();
      const catalogue = await this.database.run(auth, async (tx) => {
        const its = await tx.select({ id: items.id, code: items.code, name: items.name, hsnCode: items.hsnCode, isStockItem: items.isStockItem }).from(items).where(eq(items.isActive, true)).limit(5000);
        const vcodes = await tx.select({ itemId: itemVendors.itemId, code: itemVendors.vendorItemCode }).from(itemVendors).where(and(eq(itemVendors.vendorId, vendor.id), isNotNull(itemVendors.vendorItemCode)));
        return { its, vcodes };
      });
      for (const l of x.lines) {
        const desc = l.description;
        const descUp = desc.toUpperCase();
        let item: (typeof catalogue.its)[number] | null = null;
        let matchedBy: CapturedLine['matchedBy'] = null;
        let confidence = 0;
        const vc = catalogue.vcodes.find((v) => v.code && descUp.includes(v.code.toUpperCase()));
        if (vc) {
          item = catalogue.its.find((i) => i.id === vc.itemId) ?? null;
          matchedBy = 'vendor_code';
          confidence = 0.95;
        }
        if (!item) {
          const ic = catalogue.its.find((i) => i.code.length >= 4 && new RegExp(`\\b${i.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(desc));
          if (ic) {
            item = ic;
            matchedBy = 'item_code';
            confidence = 0.9;
          }
        }
        // Prefer items with open receipts / orders from this vendor.
        const pool = [...open.grnLines.map((g) => ({ itemId: g.itemId, name: g.itemName })), ...open.poLines.map((p) => ({ itemId: p.itemId, name: p.itemName }))];
        if (!item) {
          const best = pool.map((p) => ({ p, s: similarity(p.name, desc) })).sort((a, b) => b.s - a.s)[0];
          if (best && best.s >= 0.34) {
            item = catalogue.its.find((i) => i.id === best.p.itemId) ?? null;
            matchedBy = 'name';
            confidence = Math.min(0.85, 0.5 + best.s / 2);
          }
        }
        if (!item) {
          const best = catalogue.its
            .map((i) => ({ i, s: similarity(i.name, desc) + (l.hsnCode && i.hsnCode === l.hsnCode ? 0.2 : 0) }))
            .sort((a, b) => b.s - a.s)[0];
          if (best && best.s >= 0.5) {
            item = best.i;
            matchedBy = 'name';
            confidence = Math.min(0.8, best.s);
          }
        }
        let qty = l.qty && Number(l.qty) > 0 ? l.qty : '1';
        const rate = l.rate ?? (l.taxableValue && Number(qty) ? D(l.taxableValue).div(D(qty)).toFixed(4) : '0');
        let grnLineId: string | null = null;
        let poLineId: string | null = null;
        if (item) {
          const g = open.grnLines.find((x2) => x2.itemId === item!.id && D(x2.pendingQty).sub(usedGrn.get(x2.grnLineId) ?? D('0')).cmp(D('0')) > 0);
          if (g) {
            grnLineId = g.grnLineId;
            matchedBy = matchedBy === 'name' ? 'grn' : matchedBy;
            const left = D(g.pendingQty).sub(usedGrn.get(g.grnLineId) ?? D('0'));
            if (D(qty).cmp(left) > 0) {
              warnings.push(`${desc}: billed ${qty} but only ${left.toFixed(2)} received and not yet billed`);
              qty = left.toFixed(4);
            }
            usedGrn.set(g.grnLineId, (usedGrn.get(g.grnLineId) ?? D('0')).add(D(qty)));
          } else {
            const p = open.poLines.find((x2) => x2.itemId === item!.id);
            if (p) {
              poLineId = p.poLineId;
              if (matchedBy === 'name') matchedBy = 'po';
            } else if (item.isStockItem) warnings.push(`${desc}: ${item.code} is a stock item with no open goods receipt from this vendor; receive it first`);
          }
        } else warnings.push(`Could not match "${desc}" to an item`);
        lines.push({
          description: desc,
          itemId: item?.id ?? null,
          item: item ? { id: item.id, code: item.code, name: item.name } : null,
          matchedBy,
          confidence,
          grnLineId,
          poLineId,
          qty,
          rate,
          discountPct: l.discountPct,
          hsnCode: l.hsnCode,
          gstRate: l.gstRate,
        });
      }
    }

    // Totals reconciliation.
    const sumLines = x.lines.reduce((s, l) => s.add(D(l.taxableValue ?? '0')), D('0'));
    if (x.taxableTotal && sumLines.sub(D(x.taxableTotal)).abs().cmp(D('1')) > 0) warnings.push(`Rows add up to ₹${sumLines.toFixed(2)} but the bill's taxable value is ₹${D(x.taxableTotal).toFixed(2)}: some rows may be missing`);
    if (x.grandTotal && x.taxableTotal) {
      const computed = D(x.taxableTotal).add(D(x.cgst ?? '0')).add(D(x.sgst ?? '0')).add(D(x.igst ?? '0')).add(D(x.cess ?? '0'));
      if (computed.sub(D(x.grandTotal)).abs().cmp(D('1')) > 0) warnings.push(`Taxable value + GST (₹${computed.toFixed(2)}) differs from the bill total (₹${D(x.grandTotal).toFixed(2)}) by more than rounding`);
    }

    const fields = [!!vendor, !!x.invoiceNo, !!x.invoiceDate, !!x.grandTotal, x.lines.length > 0];
    const lineScore = lines.length ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length : 0;
    const confidence = Math.round(((fields.filter(Boolean).length / fields.length) * 0.6 + lineScore * 0.4) * 100) / 100;
    return {
      vendor,
      confidence,
      warnings,
      draft: vendor
        ? {
            vendorId: vendor.id,
            supplierInvoiceNo: x.invoiceNo?.slice(0, 16) ?? '',
            supplierInvoiceDate: x.invoiceDate ?? todayIST(),
            reverseCharge: x.reverseCharge,
            lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId!, grnLineId: l.grnLineId, poLineId: l.poLineId, qty: l.qty, rate: D(l.rate).toFixed(4), discountPct: l.discountPct, description: l.description })),
          }
        : null,
      lines,
    };
  }
}
