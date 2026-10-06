import { GST_RATES, gstinError, HSN_REGEX, PINCODE_REGEX } from '@nextgen/database';
import { Decimal } from '../../common/decimal';

/**
 * e-Invoice (INV-01, NIC schema 1.1) payload built from an invoice / credit note, with the
 * checks the IRP applies, so errors show before anything is sent to the GSP.
 */

const D = Decimal.from;
const ZERO = D('0');
const ONE = D('1');

export interface EAddress {
  line1?: string;
  line2?: string;
  city?: string;
  pincode?: string;
}

export interface EParty {
  gstin: string | null;
  legalName: string;
  tradeName?: string | null;
  address: EAddress;
  stateCode: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ELine {
  description: string;
  hsnCode: string | null;
  isService: boolean;
  qty: string;
  /** GST unit quantity code (NOS, KGS…). */
  uqc: string;
  /** Rate per unit before discount. */
  rate: string;
  taxableValue: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  cessRate: string;
  cess: string;
  lineTotal: string;
  batchNo?: string | null;
}

export interface ESource {
  /** INV invoice, CRN credit note, DBN debit note */
  docType: 'INV' | 'CRN' | 'DBN';
  number: string;
  /** YYYY-MM-DD */
  date: string;
  /** tax_invoice | bill_of_supply | export | sez */
  taxKind: string;
  withLut: boolean;
  reverseCharge: boolean;
  interState: boolean;
  placeOfSupply: string | null;
  seller: EParty;
  buyer: EParty & { registration: string };
  shipTo?: EParty | null;
  lines: ELine[];
  totals: { taxable: string; cgst: string; sgst: string; igst: string; cess: string; roundOff: string; grandTotal: string };
  /** Credit / debit notes: the original invoice. */
  preceding?: { number: string; date: string } | null;
  transport?: { transporterId?: string | null; transporterName?: string | null; vehicleNo?: string | null; distanceKm?: number | null } | null;
}

export interface EError {
  path: string;
  message: string;
}

const n2 = (v: string | Decimal) => Number((typeof v === 'string' ? D(v) : v).toFixed(2));
const n3 = (v: string | Decimal) => Number((typeof v === 'string' ? D(v) : v).toFixed(3));
/** dd/mm/yyyy, as the IRP wants dates. */
export const nicDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** NIC supply type for the invoice. */
export function supplyType(src: Pick<ESource, 'taxKind' | 'withLut'>): 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' {
  if (src.taxKind === 'export') return src.withLut ? 'EXPWOP' : 'EXPWP';
  if (src.taxKind === 'sez') return src.withLut ? 'SEZWOP' : 'SEZWP';
  return 'B2B';
}

/** Why an invoice is outside e-invoicing (B2C, bill of supply), or null when it is in. */
export function notApplicable(src: Pick<ESource, 'taxKind' | 'buyer'>): string | null {
  if (src.taxKind === 'bill_of_supply') return 'e-Invoicing does not apply to a bill of supply';
  if (src.taxKind === 'export' || src.taxKind === 'sez') return null;
  if (!src.buyer.gstin) return 'e-Invoicing applies to registered (B2B), SEZ and export customers; this customer has no GSTIN (B2C)';
  return null;
}

function party(p: EParty, kind: 'seller' | 'buyer' | 'ship', exportBuyer: boolean, errors: EError[], pos?: string | null) {
  const pin = exportBuyer ? '999999' : (p.address.pincode ?? '').trim();
  if (!exportBuyer && !PINCODE_REGEX.test(pin)) errors.push({ path: `${kind}.pincode`, message: `${kind === 'seller' ? 'Our' : kind === 'buyer' ? "The customer's" : 'The ship-to'} PIN code is missing or invalid` });
  const addr1 = (p.address.line1 ?? '').trim();
  if (addr1.length < 1 && !exportBuyer) errors.push({ path: `${kind}.address`, message: `${kind === 'seller' ? 'Our' : kind === 'buyer' ? "The customer's" : 'The ship-to'} address is missing` });
  const loc = (p.address.city ?? '').trim() || addr1;
  const out: Record<string, unknown> = {
    Gstin: exportBuyer ? 'URP' : p.gstin,
    LglNm: p.legalName.slice(0, 100),
    ...(p.tradeName ? { TrdNm: p.tradeName.slice(0, 100) } : {}),
    Addr1: (addr1 || (exportBuyer ? 'Overseas' : '')).slice(0, 100),
    ...(p.address.line2 ? { Addr2: p.address.line2.slice(0, 100) } : {}),
    Loc: (loc || 'Overseas').slice(0, 50),
    Pin: Number(pin || 0),
    Stcd: exportBuyer ? '96' : (p.stateCode ?? p.gstin?.slice(0, 2) ?? ''),
  };
  if (kind === 'buyer') out.Pos = pos ?? (exportBuyer ? '96' : p.stateCode);
  if (kind === 'seller') {
    if (p.phone) out.Ph = p.phone.replace(/\D/g, '').slice(-12);
    if (p.email) out.Em = p.email.slice(0, 100);
  }
  return out;
}

export function buildEInvoice(src: ESource): { payload: Record<string, unknown>; errors: EError[] } {
  const errors: EError[] = [];
  const na = notApplicable(src);
  if (na) errors.push({ path: 'invoice', message: na });

  // Seller
  if (!src.seller.gstin) errors.push({ path: 'seller.gstin', message: 'Add the company / branch GSTIN before generating e-invoices' });
  else {
    const e = gstinError(src.seller.gstin);
    if (e) errors.push({ path: 'seller.gstin', message: `Our GSTIN: ${e}` });
  }
  // Buyer
  const exportBuyer = src.taxKind === 'export';
  if (!exportBuyer && src.buyer.gstin) {
    const e = gstinError(src.buyer.gstin);
    if (e) errors.push({ path: 'buyer.gstin', message: `Customer GSTIN: ${e}` });
    if (src.seller.gstin && src.buyer.gstin === src.seller.gstin) errors.push({ path: 'buyer.gstin', message: 'Seller and buyer GSTIN cannot be the same' });
  }
  // Document
  if (!/^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/.test(src.number)) errors.push({ path: 'number', message: `Document number "${src.number}" must be up to 16 letters, digits, / or -, and cannot start with 0, / or -` });
  if (src.preceding === null && src.docType !== 'INV') errors.push({ path: 'preceding', message: 'A credit / debit note must refer to its invoice' });

  // Lines
  if (!src.lines.length) errors.push({ path: 'lines', message: 'No lines to report' });
  if (src.lines.length > 1000) errors.push({ path: 'lines', message: 'The IRP accepts at most 1000 lines per document' });
  let sumAss = ZERO;
  let sumC = ZERO;
  let sumS = ZERO;
  let sumI = ZERO;
  let sumCess = ZERO;
  let sumItems = ZERO;
  const itemList = src.lines.map((l, i) => {
    const path = `lines.${i}`;
    const hsn = (l.hsnCode ?? '').trim();
    if (!HSN_REGEX.test(hsn)) errors.push({ path: `${path}.hsnCode`, message: `Line ${i + 1}: HSN / SAC code is missing or invalid` });
    if (!(GST_RATES as readonly string[]).includes(String(Number(l.gstRate)))) errors.push({ path: `${path}.gstRate`, message: `Line ${i + 1}: ${Number(l.gstRate)}% is not a valid GST rate` });
    const qty = D(l.qty);
    const totAmt = qty.mul(D(l.rate)).round(2);
    const ass = D(l.taxableValue);
    // A discount can't be negative: when rounding makes the gross a paisa short, report the gross as the assessable value.
    const gross = totAmt.cmp(ass) < 0 ? ass : totAmt;
    const discount = gross.sub(ass);
    const taxes = D(l.cgst).add(D(l.sgst)).add(D(l.igst)).add(D(l.cess));
    const tot = D(l.lineTotal);
    if (tot.sub(ass.add(taxes)).abs().cmp(ONE) > 0) errors.push({ path: `${path}.lineTotal`, message: `Line ${i + 1}: total does not match taxable value plus tax` });
    if (src.interState && (D(l.cgst).cmp(ZERO) !== 0 || D(l.sgst).cmp(ZERO) !== 0)) errors.push({ path: `${path}.tax`, message: `Line ${i + 1}: an inter-state supply carries IGST only` });
    if (!src.interState && D(l.igst).cmp(ZERO) !== 0) errors.push({ path: `${path}.tax`, message: `Line ${i + 1}: an intra-state supply carries CGST and SGST only` });
    sumAss = sumAss.add(ass);
    sumC = sumC.add(D(l.cgst));
    sumS = sumS.add(D(l.sgst));
    sumI = sumI.add(D(l.igst));
    sumCess = sumCess.add(D(l.cess));
    sumItems = sumItems.add(tot);
    return {
      SlNo: String(i + 1),
      PrdDesc: l.description.slice(0, 300),
      IsServc: l.isService || hsn.startsWith('99') ? 'Y' : 'N',
      HsnCd: hsn,
      Qty: n3(qty),
      FreeQty: 0,
      Unit: l.uqc || 'OTH',
      UnitPrice: n3(l.rate),
      TotAmt: n2(gross),
      Discount: n2(discount),
      PreTaxVal: 0,
      AssAmt: n2(ass),
      GstRt: Number(l.gstRate),
      IgstAmt: n2(l.igst),
      CgstAmt: n2(l.cgst),
      SgstAmt: n2(l.sgst),
      CesRt: Number(l.cessRate),
      CesAmt: n2(l.cess),
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: n2(tot),
      ...(l.batchNo ? { BchDtls: { Nm: l.batchNo.slice(0, 20) } } : {}),
    };
  });

  const t = src.totals;
  const check = (label: string, a: Decimal, b: string) => {
    if (a.sub(D(b)).abs().cmp(ONE) > 0) errors.push({ path: 'totals', message: `${label} of the lines (${a.toFixed(2)}) does not match the document (${D(b).toFixed(2)})` });
  };
  check('Taxable value', sumAss, t.taxable);
  check('CGST', sumC, t.cgst);
  check('SGST', sumS, t.sgst);
  check('IGST', sumI, t.igst);
  check('Cess', sumCess, t.cess);
  check('Total', sumItems.add(D(t.roundOff)), t.grandTotal);

  const payload: Record<string, unknown> = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: supplyType(src), RegRev: src.reverseCharge ? 'Y' : 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: src.docType, No: src.number, Dt: nicDate(src.date) },
    SellerDtls: party(src.seller, 'seller', false, errors),
    BuyerDtls: party(src.buyer, 'buyer', exportBuyer, errors, exportBuyer ? '96' : src.placeOfSupply),
    ItemList: itemList,
    ValDtls: {
      AssVal: n2(t.taxable),
      CgstVal: n2(t.cgst),
      SgstVal: n2(t.sgst),
      IgstVal: n2(t.igst),
      CesVal: n2(t.cess),
      StCesVal: 0,
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: n2(t.roundOff),
      TotInvVal: n2(t.grandTotal),
    },
  };
  if (src.shipTo && !exportBuyer) payload.ShipDtls = party(src.shipTo, 'ship', false, errors);
  if (src.preceding) payload.RefDtls = { PrecDocDtls: [{ InvNo: src.preceding.number, InvDt: nicDate(src.preceding.date) }] };
  if (exportBuyer) payload.ExpDtls = { CntCode: 'XX', RefClm: 'N' };
  const tr = src.transport;
  if (tr && (tr.vehicleNo || tr.transporterId) && tr.distanceKm) {
    payload.EwbDtls = {
      ...(tr.transporterId ? { TransId: tr.transporterId } : {}),
      ...(tr.transporterName ? { TransName: tr.transporterName.slice(0, 100) } : {}),
      Distance: tr.distanceKm,
      ...(tr.vehicleNo ? { VehNo: tr.vehicleNo.replace(/[\s-]/g, '').toUpperCase(), VehType: 'R', TransMode: '1' } : {}),
    };
  }
  return { payload, errors };
}

/** Fields of the signed QR code (as the IRP signs them). */
export function qrClaims(payload: Record<string, unknown>, irn: string, ackDate: string) {
  const doc = payload.DocDtls as { Typ: string; No: string; Dt: string };
  const items = payload.ItemList as { HsnCd: string; AssAmt: number }[];
  const main = [...items].sort((a, b) => b.AssAmt - a.AssAmt)[0];
  return {
    SellerGstin: (payload.SellerDtls as { Gstin: string }).Gstin,
    BuyerGstin: (payload.BuyerDtls as { Gstin: string }).Gstin,
    DocNo: doc.No,
    DocTyp: doc.Typ,
    DocDt: doc.Dt,
    TotInvVal: (payload.ValDtls as { TotInvVal: number }).TotInvVal,
    ItemCnt: items.length,
    MainHsnCode: main?.HsnCd ?? '',
    Irn: irn,
    IrnDt: ackDate,
  };
}
