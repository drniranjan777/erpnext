import { BadRequestException } from '@nestjs/common';
import {
  documents,
  items,
  parties,
  partyAddresses,
  priceListItems,
  priceLists,
  salesInvoices,
  salesOrderLines,
  salesOrders,
  stockValuation,
  type Transaction,
  warehouses,
} from '@nextgen/database';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { Decimal } from '../../common/decimal';
import { todayIST } from '../../common/fiscal-year';
import type { DocumentRow } from '../documents/documents.service';
import type { RegistrationType } from '../gst/gst-engine';
import { ownGstRegistration, priceLines, taxHeader, type PricedLine } from '../gst/pricing';

const D = Decimal.from;
const ZERO = D('0');
export type Err = { path: string; message: string };
export function fail(errors: Err[]): never {
  throw new BadRequestException({ message: errors[0].message, errors });
}
export const trim = (d: Decimal) => d.toFixed(4).replace(/\.?0+$/, '') || '0';

export type CustomerSnapshot = Awaited<ReturnType<typeof loadCustomer>>;

/** Customer with GST snapshot, billing and shipping addresses, and commercial terms. */
export async function loadCustomer(tx: Transaction, customerId: string, shippingAddressId?: string | null) {
  const [c] = await tx.select().from(parties).where(and(eq(parties.id, customerId), isNull(parties.deletedAt)));
  if (!c) fail([{ path: 'customerId', message: 'Customer not found' }]);
  if (!c.isCustomer) fail([{ path: 'customerId', message: `${c.name} is not set up as a customer` }]);
  if (!c.isActive) fail([{ path: 'customerId', message: `${c.name} is inactive` }]);
  const addresses = await tx.select().from(partyAddresses).where(eq(partyAddresses.partyId, c.id));
  const billing = addresses.find((a) => a.isDefault && a.type !== 'shipping') ?? addresses.find((a) => a.type !== 'shipping') ?? addresses[0];
  let shipping = shippingAddressId ? addresses.find((a) => a.id === shippingAddressId) : addresses.find((a) => a.type === 'shipping' && a.isDefault) ?? addresses.find((a) => a.type === 'shipping') ?? billing;
  if (shippingAddressId && !shipping) fail([{ path: 'shippingAddressId', message: 'Not an address of this customer' }]);
  shipping ??= billing;
  const snap = (a: typeof billing) => (a ? { name: a.label ?? c.legalName ?? c.name, line1: a.line1, line2: a.line2 ?? undefined, city: a.city, stateCode: a.stateCode, pincode: a.pincode ?? undefined, gstin: a.gstin ?? c.gstin } : {});
  const stateCode = c.stateCode ?? (c.gstin ? c.gstin.slice(0, 2) : null) ?? billing?.stateCode ?? null;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    legalName: c.legalName,
    gstin: c.gstin,
    pan: c.pan,
    registration: c.gstRegistrationType as RegistrationType,
    stateCode,
    creditLimit: c.creditLimit,
    creditDays: c.creditDays,
    paymentTerms: c.paymentTerms,
    priceListId: c.priceListId,
    billingAddress: snap(billing),
    shippingAddress: snap(shipping),
    /** Place of supply for goods = where they are delivered. */
    shipStateCode: c.gstRegistrationType === 'overseas' ? null : (shipping?.stateCode ?? stateCode),
  };
}

/** Header columns shared by quotation, order and invoice. */
export function customerColumns(c: CustomerSnapshot, withLut: boolean) {
  return {
    customerId: c.id,
    customerGstin: c.gstin,
    customerStateCode: c.stateCode,
    customerRegistration: c.registration,
    billingAddress: c.billingAddress,
    shippingAddress: c.shippingAddress,
    withLut,
  };
}

export interface SellingLineInput {
  itemId: string;
  uomId?: string | null;
  qty: string;
  /** Blank = price list rate. */
  rate?: string | null;
  discountPct?: string | null;
  description?: string | null;
}

export interface PricedSellingLine extends PricedLine {
  listRate: string | null;
  unitCost: string | null;
}

/**
 * Prices selling lines: list rate from the customer's (or default) selling price list with
 * quantity breaks, GST outward to the ship-to state, cost for margin, and the facts approval
 * rules look at (largest discount below list, margin).
 */
export async function priceSelling(tx: Transaction, doc: Pick<DocumentRow, 'companyId' | 'branchId' | 'docDate'>, customer: CustomerSnapshot, lines: SellingLineInput[], withLut: boolean) {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const itemRows = ids.length ? await tx.select().from(items).where(inArray(items.id, ids)) : [];
  const errors: Err[] = [];
  lines.forEach((l, i) => {
    const it = itemRows.find((x) => x.id === l.itemId);
    if (it && it.gstRate === null && !it.isNilRatedOrExempt) errors.push({ path: `lines.${i}.itemId`, message: `${it.code} has no GST rate` });
  });
  if (errors.length) fail(errors);

  // Resolve units first (same rules as pricing), then look up list rates for them.
  const own = await ownGstRegistration(tx, doc.companyId, doc.branchId);
  const ctx = { direction: 'outward' as const, ownStateCode: own.stateCode, partyRegistration: customer.registration, partyStateCode: customer.shipStateCode, withLut };
  const draft = await priceLines(tx, ctx, lines.map((l) => ({ itemId: l.itemId, uomId: l.uomId, qty: l.qty, rate: l.rate ?? '0', discountPct: l.discountPct, description: l.description })), { defaultUnit: 'sales' });
  const listRates = await listRatesFor(tx, customer.priceListId, draft.lines.map((p) => ({ itemId: p.itemId, uomId: p.uomId, qty: p.qty, factor: p.conversionFactor })), doc.docDate);
  const missing = draft.lines.flatMap((p, i) => (!lines[i].rate && !listRates[i] ? [{ path: `lines.${i}.rate`, message: `No price for ${p.item.code}: enter a rate or add it to the price list` }] : []));
  if (missing.length) fail(missing);
  const { lines: priced, tax } = await priceLines(
    tx,
    ctx,
    lines.map((l, i) => ({ itemId: l.itemId, uomId: draft.lines[i].uomId, qty: l.qty, rate: l.rate ?? listRates[i]!, discountPct: l.discountPct, description: l.description })),
    { defaultUnit: 'sales' },
  );
  const costs = await unitCosts(tx, ids);
  let costTotal = ZERO;
  let maxDiscount = ZERO;
  const out: PricedSellingLine[] = priced.map((p, i) => {
    const baseCost = costs.get(p.itemId) ?? null;
    const unitCost = baseCost ? D(baseCost).mul(D(p.conversionFactor)).toFixed(4) : null;
    if (unitCost) costTotal = costTotal.add(D(unitCost).mul(D(p.qty)));
    const list = listRates[i];
    if (list && !D(list).isZero()) {
      const net = D(p.taxableValue).div(D(p.qty));
      const disc = D('1').sub(net.div(D(list))).mul(D('100'));
      if (disc.cmp(maxDiscount) > 0) maxDiscount = disc;
    }
    return { ...p, listRate: list, unitCost };
  });
  const taxable = D(tax.totals.taxable);
  const marginPct = taxable.isZero() ? null : taxable.sub(costTotal).mul(D('100')).div(taxable).toFixed(2);
  return {
    lines: out,
    tax,
    header: { ...taxHeader(tax), costTotal: costTotal.toFixed(2), marginPct, maxDiscountPct: maxDiscount.toFixed(2) },
  };
}

/** Rate per line unit from a selling price list (quantity breaks; GST-inclusive lists converted). */
export async function listRatesFor(tx: Transaction, priceListId: string | null, lines: { itemId: string; uomId: string; qty: string; factor: string }[], onDate: string): Promise<(string | null)[]> {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  if (!ids.length) return [];
  let listId = priceListId;
  if (!listId) {
    const [def] = await tx
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(and(eq(priceLists.type, 'selling'), eq(priceLists.isDefault, true), eq(priceLists.isActive, true)))
      .limit(1);
    listId = def?.id ?? null;
  }
  const [list] = listId
    ? await tx
        .select()
        .from(priceLists)
        .where(and(eq(priceLists.id, listId), eq(priceLists.isActive, true), or(isNull(priceLists.validFrom), lte(priceLists.validFrom, onDate)), or(isNull(priceLists.validTo), sql`${priceLists.validTo} >= ${onDate}`)))
    : [];
  const rows = list ? await tx.select().from(priceListItems).where(and(eq(priceListItems.priceListId, list.id), inArray(priceListItems.itemId, ids))).orderBy(desc(priceListItems.minQty)) : [];
  const itemRows = await tx.select({ id: items.id, sellingRate: items.sellingRate, gstRate: items.gstRate, baseUomId: items.baseUomId }).from(items).where(inArray(items.id, ids));
  return lines.map((l) => {
    const exact = rows.find((r) => r.itemId === l.itemId && r.uomId === l.uomId && D(l.qty).cmp(D(r.minQty)) >= 0);
    const it = itemRows.find((x) => x.id === l.itemId);
    if (exact) {
      let rate = D(exact.rate);
      if (list?.taxInclusive && it?.gstRate) rate = rate.mul(D('100')).div(D('100').add(D(it.gstRate)));
      return rate.toFixed(4);
    }
    // Base-unit price list entry, or the item's selling rate, scaled to the line's unit.
    const base = rows.find((r) => r.itemId === l.itemId && r.uomId === it?.baseUomId && D(l.qty).mul(D(l.factor)).cmp(D(r.minQty)) >= 0);
    let rate = base ? D(base.rate) : it?.sellingRate ? D(it.sellingRate) : null;
    if (!rate) return null;
    if (base && list?.taxInclusive && it?.gstRate) rate = rate.mul(D('100')).div(D('100').add(D(it.gstRate)));
    return rate.mul(D(l.factor)).toFixed(4);
  });
}

/** Cost per base unit: average valuation across nettable stores, else standard cost. */
export async function unitCosts(tx: Transaction, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, string>();
  const pools = await tx
    .select({ itemId: stockValuation.itemId, qty: sql<string>`sum(${stockValuation.qty})::text`, value: sql<string>`sum(${stockValuation.value})::text` })
    .from(stockValuation)
    .innerJoin(warehouses, eq(warehouses.id, stockValuation.warehouseId))
    .where(and(inArray(stockValuation.itemId, itemIds), eq(warehouses.isNettable, true)))
    .groupBy(stockValuation.itemId);
  const itemRows = await tx.select({ id: items.id, standardCost: items.standardCost, lastPurchaseRate: items.lastPurchaseRate }).from(items).where(inArray(items.id, itemIds));
  const out = new Map<string, string>();
  for (const it of itemRows) {
    const p = pools.find((x) => x.itemId === it.id);
    if (p && D(p.qty).cmp(ZERO) > 0) out.set(it.id, D(p.value).div(D(p.qty)).toFixed(4));
    else if (it.standardCost) out.set(it.id, it.standardCost);
    else if (it.lastPurchaseRate) out.set(it.id, it.lastPurchaseRate);
  }
  return out;
}

export interface CreditPosition {
  limit: string | null;
  /** Approved invoices not yet received. */
  outstanding: string;
  /** Of which past due date. */
  overdue: string;
  /** Approved orders not yet invoiced (with GST). */
  openOrders: string;
  /** This document. */
  thisDocument: string;
  exposure: string;
  exceeded: boolean;
  reasons: string[];
}

/** Customer exposure for credit control: receivables + open orders + this document vs the credit limit; overdue bills block too. */
export async function creditPosition(tx: Transaction, customerId: string, creditLimit: string | null, thisDocument: string, excludeOrderId?: string): Promise<CreditPosition> {
  const today = todayIST();
  const [inv] = await tx
    .select({
      outstanding: sql<string>`coalesce(sum(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount}), 0)::numeric(18,2)::text`,
      overdue: sql<string>`coalesce(sum(${salesInvoices.grandTotal} - ${salesInvoices.receivedAmount} - ${salesInvoices.creditedAmount}) filter (where ${salesInvoices.dueDate} < ${today}::date), 0)::numeric(18,2)::text`,
    })
    .from(salesInvoices)
    .innerJoin(documents, eq(documents.id, salesInvoices.id))
    .where(and(eq(salesInvoices.customerId, customerId), eq(documents.status, 'approved')));
  const [ord] = await tx
    .select({ open: sql<string>`coalesce(sum(${salesOrderLines.lineTotal} * greatest(${salesOrderLines.qty} - ${salesOrderLines.invoicedQty}, 0) / ${salesOrderLines.qty}), 0)::numeric(18,2)::text` })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .innerJoin(documents, eq(documents.id, salesOrders.id))
    .where(and(eq(salesOrders.customerId, customerId), eq(documents.status, 'approved'), isNull(salesOrders.closedAt), excludeOrderId ? sql`${salesOrders.id} <> ${excludeOrderId}` : undefined));
  const exposure = D(inv.outstanding).add(D(ord.open)).add(D(thisDocument));
  const reasons: string[] = [];
  if (creditLimit && exposure.cmp(D(creditLimit)) > 0) reasons.push(`Exposure ₹${exposure.toFixed(2)} is over the credit limit ₹${D(creditLimit).toFixed(2)}`);
  if (D(inv.overdue).cmp(ZERO) > 0) reasons.push(`₹${D(inv.overdue).toFixed(2)} is overdue`);
  return { limit: creditLimit, outstanding: inv.outstanding, overdue: inv.overdue, openOrders: ord.open, thisDocument: D(thisDocument).toFixed(2), exposure: exposure.toFixed(2), exceeded: reasons.length > 0, reasons };
}
