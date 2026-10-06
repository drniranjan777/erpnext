import { GST_STATES } from '@nextgen/database';
import { Decimal } from '../../common/decimal';

/**
 * GST computation for a document (PO, invoice, credit note...). Pure functions, no I/O.
 *
 * Place of supply (goods, IGST Act s.10): where delivery ends. Outward → the customer's
 * (ship-to) state, or "96" for exports; inward → our own (receiving) state.
 * Supply is inter-state (IGST) when the supplier's state differs from the place of supply,
 * and always for SEZ and exports (IGST Act s.7(5)); otherwise CGST + SGST (UTGST in UTs
 * without a legislature).
 *
 * The document charges no GST when the supplier is composition / unregistered (unless the
 * recipient pays under reverse charge), for imports (IGST is paid on the Bill of Entry), and
 * for zero-rated exports / SEZ supplies under LUT.
 */

export type Direction = 'outward' | 'inward';
export type RegistrationType = 'regular' | 'composition' | 'unregistered' | 'consumer' | 'overseas' | 'sez';

/** Union territories without a legislature charge UTGST instead of SGST. */
export const UTGST_STATES = new Set(['04', '25', '26', '31', '35', '38', '97']);
export const OVERSEAS_POS = '96';

/** State / UT name by GST code ("96" = outside India). */
export const GST_STATE_NAME: Record<string, string> = { ...GST_STATES, '96': 'Other Countries' };

export interface TaxContext {
  direction: Direction;
  /** Our GST state (branch registration, else company). */
  ownStateCode: string | null;
  ownRegistration?: 'regular' | 'composition';
  partyRegistration: RegistrationType;
  partyStateCode: string | null;
  /** Ship-to state when it differs from the party's billing state. */
  placeOfSupply?: string | null;
  /** Exports / SEZ supplies under LUT or bond: zero-rated without paying IGST. */
  withLut?: boolean;
  /** Recipient pays the tax (notified goods/services, or purchases from unregistered persons where notified). */
  reverseCharge?: boolean;
}

export interface TaxLineInput {
  taxableValue: string;
  gstRate: string | null;
  cessRate?: string | null;
  /** Nil-rated / exempt / non-GST item. */
  exempt?: boolean;
}

export type Taxability = 'taxable' | 'exempt' | 'zero_rated' | 'no_tax' | 'import' | 'reverse_charge';

export interface TaxLine {
  taxability: Taxability;
  gstRate: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  cessRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  /** Tax charged on the document for this line (0 under reverse charge). */
  tax: string;
  /** Line total payable to the supplier. */
  total: string;
}

export type DocumentKind = 'tax_invoice' | 'bill_of_supply' | 'export' | 'sez' | 'import' | 'unregistered';

export interface TaxResult {
  placeOfSupply: string | null;
  supplierStateCode: string | null;
  interState: boolean;
  /** Label for the state component: SGST, or UTGST in UTs without a legislature. */
  stateTaxLabel: 'SGST' | 'UTGST';
  reverseCharge: boolean;
  kind: DocumentKind;
  lines: TaxLine[];
  totals: {
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    cess: string;
    /** Tax charged on the document. */
    tax: string;
    /** Tax the recipient pays directly under reverse charge. */
    reverseChargeTax: string;
    roundOff: string;
    grandTotal: string;
  };
  /** Plain-language notes for the document (shown on screen and print). */
  notes: string[];
}

const D = Decimal.from;
const ZERO = D('0');
const money = (d: Decimal) => d.toFixed(2);
const pct = (v: string | null | undefined) => D(v ?? '0');
/** taxable × rate% rounded to paise. */
const taxOf = (taxable: Decimal, rate: Decimal) => D(money(taxable.mul(rate).div(D('100'))));

export function computeTax(ctx: TaxContext, lines: TaxLineInput[], opts: { roundOff?: boolean } = {}): TaxResult {
  const notes: string[] = [];
  const party = ctx.partyRegistration;
  const supplierState = ctx.direction === 'outward' ? ctx.ownStateCode : party === 'overseas' ? null : ctx.partyStateCode;
  const placeOfSupply =
    ctx.placeOfSupply ??
    (ctx.direction === 'outward' ? (party === 'overseas' ? OVERSEAS_POS : (ctx.partyStateCode ?? ctx.ownStateCode)) : ctx.ownStateCode);

  const overseas = party === 'overseas';
  const sez = party === 'sez';
  const interState = overseas || sez || !supplierState || !placeOfSupply || supplierState !== placeOfSupply;
  const stateTaxLabel = placeOfSupply && UTGST_STATES.has(placeOfSupply) ? 'UTGST' : 'SGST';

  // What kind of document is this, and is GST charged on it?
  let kind: DocumentKind = 'tax_invoice';
  let charge = true;
  let reverseCharge = !!ctx.reverseCharge;
  let zeroRated = false;
  if (ctx.direction === 'outward') {
    if (ctx.ownRegistration === 'composition') {
      kind = 'bill_of_supply';
      charge = false;
      reverseCharge = false;
      notes.push('Composition taxable person, not eligible to collect tax on supplies.');
    } else if (overseas || sez) {
      kind = overseas ? 'export' : 'sez';
      if (ctx.withLut) {
        zeroRated = true;
        notes.push(`${overseas ? 'Supply meant for export' : 'Supply to SEZ unit/developer'} under LUT without payment of integrated tax.`);
      } else notes.push(`${overseas ? 'Supply meant for export' : 'Supply to SEZ unit/developer'} on payment of integrated tax.`);
    }
  } else {
    if (overseas) {
      kind = 'import';
      charge = false;
      reverseCharge = false;
      notes.push('Import: IGST and customs duty are paid on the Bill of Entry.');
    } else if (party === 'composition') {
      kind = 'bill_of_supply';
      charge = false;
      reverseCharge = false;
      notes.push('Supplier is under the composition scheme: no GST is charged and no input tax credit is available.');
    } else if (party === 'unregistered' || party === 'consumer') {
      kind = 'unregistered';
      charge = reverseCharge;
      if (!reverseCharge) notes.push('Supplier is unregistered: no GST is charged.');
    }
  }
  if (reverseCharge) notes.push('Tax payable on reverse charge basis: Yes. The recipient pays this tax directly to the government.');

  let taxable = ZERO;
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;
  let cess = ZERO;
  let rcm = ZERO;
  let payable = ZERO;
  const out: TaxLine[] = lines.map((l) => {
    const value = D(l.taxableValue);
    const rate = l.exempt ? ZERO : pct(l.gstRate);
    const cessRate = l.exempt ? ZERO : pct(l.cessRate);
    taxable = taxable.add(value);
    const none = (taxability: Taxability): TaxLine => {
      payable = payable.add(value);
      return { taxability, gstRate: rate.toFixed(2), cgstRate: '0.000', sgstRate: '0.000', igstRate: '0.00', cessRate: '0.00', cgst: '0.00', sgst: '0.00', igst: '0.00', cess: '0.00', tax: '0.00', total: money(value) };
    };
    if (l.exempt || rate.isZero()) {
      if (rate.isZero() && cessRate.isZero()) return none(l.exempt ? 'exempt' : 'taxable');
    }
    if (!charge) return none(kind === 'import' ? 'import' : 'no_tax');
    if (zeroRated) return none('zero_rated');

    const half = rate.div(D('2'));
    const lc = interState ? ZERO : taxOf(value, half);
    const ls = interState ? ZERO : taxOf(value, half);
    const li = interState ? taxOf(value, rate) : ZERO;
    const lcess = taxOf(value, cessRate);
    const lineTax = lc.add(ls).add(li).add(lcess);
    cgst = cgst.add(lc);
    sgst = sgst.add(ls);
    igst = igst.add(li);
    cess = cess.add(lcess);
    if (reverseCharge) rcm = rcm.add(lineTax);
    const charged = reverseCharge ? ZERO : lineTax;
    payable = payable.add(value).add(charged);
    return {
      taxability: reverseCharge ? 'reverse_charge' : 'taxable',
      gstRate: rate.toFixed(2),
      cgstRate: interState ? '0.000' : half.toFixed(3),
      sgstRate: interState ? '0.000' : half.toFixed(3),
      igstRate: interState ? rate.toFixed(2) : '0.00',
      cessRate: cessRate.toFixed(2),
      cgst: money(lc),
      sgst: money(ls),
      igst: money(li),
      cess: money(lcess),
      tax: money(charged),
      total: money(value.add(charged)),
    };
  });

  const charged = reverseCharge ? ZERO : cgst.add(sgst).add(igst).add(cess);
  let roundOff = ZERO;
  let grand = payable;
  if (opts.roundOff !== false) {
    // Round the payable total to the nearest rupee (half-up).
    const rupees = D(payable.toFixed(0));
    roundOff = rupees.sub(payable);
    grand = rupees;
  }
  return {
    placeOfSupply,
    supplierStateCode: supplierState,
    interState,
    stateTaxLabel,
    reverseCharge,
    kind,
    lines: out,
    totals: {
      taxable: money(taxable),
      cgst: money(cgst),
      sgst: money(sgst),
      igst: money(igst),
      cess: money(cess),
      tax: money(charged),
      reverseChargeTax: money(rcm),
      roundOff: money(roundOff),
      grandTotal: money(grand),
    },
    notes,
  };
}

/** Taxable value of a line: qty × rate less discount %, to paise. */
export function lineTaxable(qty: string, rate: string, discountPct?: string | null): string {
  const gross = D(qty).mul(D(rate));
  const disc = discountPct ? gross.mul(D(discountPct)).div(D('100')) : ZERO;
  return money(gross.sub(disc));
}
