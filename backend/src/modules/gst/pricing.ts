import { BadRequestException } from '@nestjs/common';
import { branches, companies, items, itemUomConversions, uoms, type Transaction } from '@nextgen/database';
import { eq, inArray } from 'drizzle-orm';
import { Decimal } from '../../common/decimal';
import { computeTax, lineTaxable, type TaxContext, type TaxResult } from './gst-engine';

/** Our GST registration for a document: the branch's (multi-state companies) or the company's. */
export async function ownGstRegistration(tx: Transaction, companyId: string, branchId: string | null) {
  const [company] = await tx.select({ gstin: companies.gstin, stateCode: companies.stateCode, name: companies.name }).from(companies).where(eq(companies.id, companyId));
  const [branch] = branchId ? await tx.select({ gstin: branches.gstin, stateCode: branches.stateCode }).from(branches).where(eq(branches.id, branchId)) : [];
  const gstin = branch?.gstin ?? company?.gstin ?? null;
  const stateCode = branch?.stateCode ?? (branch?.gstin ? branch.gstin.slice(0, 2) : null) ?? company?.stateCode ?? (company?.gstin ? company.gstin.slice(0, 2) : null);
  return { gstin, stateCode };
}

export interface PriceLineInput {
  itemId: string;
  /** Defaults to the item's purchase (or sales) unit, else its base unit. */
  uomId?: string | null;
  qty: string;
  rate: string;
  discountPct?: string | null;
  description?: string | null;
}

export interface PricedLine extends PriceLineInput {
  lineNo: number;
  uomId: string;
  uomCode: string;
  description: string;
  conversionFactor: string;
  baseQty: string;
  hsnCode: string | null;
  gstRate: string;
  cessRate: string;
  taxability: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  cessAmount: string;
  lineTotal: string;
  item: { id: string; code: string; name: string; isStockItem: boolean; baseUomId: string; decimals: number };
}

type Err = { path: string; message: string };

/**
 * Resolves units and conversions, values each line (qty × rate − discount) and runs the GST engine.
 * Throws a 400 with per-line paths ("lines.2.uomId") when something doesn't fit.
 */
export async function priceLines(
  tx: Transaction,
  ctx: TaxContext,
  input: PriceLineInput[],
  opts: { defaultUnit: 'purchase' | 'sales'; roundOff?: boolean },
): Promise<{ lines: PricedLine[]; tax: TaxResult }> {
  const ids = [...new Set(input.map((l) => l.itemId))];
  const itemRows = ids.length ? await tx.select().from(items).where(inArray(items.id, ids)) : [];
  const convs = ids.length ? await tx.select().from(itemUomConversions).where(inArray(itemUomConversions.itemId, ids)) : [];
  const unitRows = await tx.select({ id: uoms.id, code: uoms.code, decimals: uoms.decimals }).from(uoms);
  const unit = new Map(unitRows.map((u) => [u.id, u]));
  const errors: Err[] = [];

  const resolved = input.map((l, i) => {
    const it = itemRows.find((x) => x.id === l.itemId);
    if (!it) {
      errors.push({ path: `lines.${i}.itemId`, message: 'Unknown item' });
      return null;
    }
    if (!it.isActive) errors.push({ path: `lines.${i}.itemId`, message: `${it.code} is inactive` });
    const preferred = opts.defaultUnit === 'purchase' ? it.purchaseUomId : it.salesUomId;
    const uomId = l.uomId ?? preferred ?? it.baseUomId;
    let factor = '1';
    if (uomId !== it.baseUomId) {
      const c = convs.find((x) => x.itemId === it.id && x.uomId === uomId);
      if (!c) errors.push({ path: `lines.${i}.uomId`, message: `${it.code} has no conversion for this unit` });
      else factor = c.factor;
    }
    const u = unit.get(uomId);
    if (u && u.decimals === 0 && !/^\d+(\.0+)?$/.test(l.qty)) errors.push({ path: `lines.${i}.qty`, message: `${it.code} is counted in whole ${u.code}` });
    const base = unit.get(it.baseUomId);
    return { l, it, uomId, uomCode: u?.code ?? '', factor, baseDecimals: base?.decimals ?? 3 };
  });
  if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });

  const rows = resolved as NonNullable<(typeof resolved)[number]>[];
  const taxable = rows.map((r) => lineTaxable(r.l.qty, r.l.rate, r.l.discountPct));
  const tax = computeTax(
    ctx,
    rows.map((r, i) => ({ taxableValue: taxable[i], gstRate: r.it.gstRate, cessRate: r.it.cessRate, exempt: r.it.isNilRatedOrExempt })),
    { roundOff: opts.roundOff },
  );
  const lines: PricedLine[] = rows.map((r, i) => {
    const t = tax.lines[i];
    return {
      ...r.l,
      lineNo: i + 1,
      uomId: r.uomId,
      uomCode: r.uomCode,
      description: r.l.description?.trim() || r.it.name,
      conversionFactor: r.factor,
      baseQty: Decimal.from(r.l.qty).mul(Decimal.from(r.factor)).toFixed(4),
      hsnCode: r.it.hsnCode,
      gstRate: t.gstRate,
      cessRate: t.cessRate,
      taxability: t.taxability,
      taxableValue: taxable[i],
      cgstAmount: t.cgst,
      sgstAmount: t.sgst,
      igstAmount: t.igst,
      cessAmount: t.cess,
      lineTotal: t.total,
      item: { id: r.it.id, code: r.it.code, name: r.it.name, isStockItem: r.it.isStockItem, baseUomId: r.it.baseUomId, decimals: r.baseDecimals },
    };
  });
  return { lines, tax };
}

/** Header columns for a document from a tax result (matches taxHeaderColumns in the schema). */
export function taxHeader(tax: TaxResult) {
  return {
    placeOfSupply: tax.placeOfSupply,
    interState: tax.interState,
    reverseCharge: tax.reverseCharge,
    taxKind: tax.kind,
    taxableTotal: tax.totals.taxable,
    cgstTotal: tax.totals.cgst,
    sgstTotal: tax.totals.sgst,
    igstTotal: tax.totals.igst,
    cessTotal: tax.totals.cess,
    taxTotal: tax.totals.tax,
    reverseChargeTax: tax.totals.reverseChargeTax,
    roundOff: tax.totals.roundOff,
    grandTotal: tax.totals.grandTotal,
    taxNotes: tax.notes,
  };
}
