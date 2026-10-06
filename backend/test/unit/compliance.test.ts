import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildEInvoice, nicDate, notApplicable, qrClaims, supplyType, type ESource } from '../../src/modules/compliance/einvoice-payload';
import { ewbValidUntil, irnFor, SandboxGsp } from '../../src/modules/compliance/gsp';
import { returnDeadline } from '../../src/modules/jobwork/jobwork.service';
import { similarity } from '../../src/modules/purchase/capture/bill-capture.service';
import { extractFromText, parseDate } from '../../src/modules/purchase/capture/text-extractor';
import { computeDuty } from '../../src/modules/purchase/customs';

// Made-up GSTINs with valid check digits.
const OURS = '36AABCS1234E1ZU';
const THEIRS = '36AABCD1234E1Z9';
const MH = '27AAACN0000A1ZL';

const source = (patch: Partial<ESource> = {}): ESource => ({
  docType: 'INV',
  number: 'INV/26-27/0001',
  date: '2026-10-05',
  taxKind: 'tax_invoice',
  withLut: false,
  reverseCharge: false,
  interState: false,
  placeOfSupply: '36',
  seller: { gstin: OURS, legalName: 'Sample Industries Pvt Ltd', address: { line1: 'Plot 1, IDA Uppal', city: 'Hyderabad', pincode: '500039' }, stateCode: '36' },
  buyer: { gstin: THEIRS, registration: 'regular', legalName: 'Deccan Traders', address: { line1: '12 MG Road', city: 'Secunderabad', pincode: '500003' }, stateCode: '36' },
  lines: [
    { description: 'HDPE granules', hsnCode: '390120', isService: false, qty: '10', uqc: 'KGS', rate: '150', taxableValue: '1350.00', gstRate: '18', cgst: '121.50', sgst: '121.50', igst: '0.00', cessRate: '0', cess: '0.00', lineTotal: '1593.00', batchNo: 'B1' },
    { description: 'Installation', hsnCode: '998719', isService: true, qty: '1', uqc: 'OTH', rate: '500', taxableValue: '500.00', gstRate: '18', cgst: '45.00', sgst: '45.00', igst: '0.00', cessRate: '0', cess: '0.00', lineTotal: '590.00' },
  ],
  totals: { taxable: '1850.00', cgst: '166.50', sgst: '166.50', igst: '0.00', cess: '0.00', roundOff: '0.00', grandTotal: '2183.00' },
  ...patch,
});

describe('e-Invoice payload (INV-01 v1.1)', () => {
  it('builds a valid B2B payload with discount, services and batch details', () => {
    const { payload, errors } = buildEInvoice(source());
    expect(errors).toEqual([]);
    expect(payload).toMatchObject({
      Version: '1.1',
      TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' },
      DocDtls: { Typ: 'INV', No: 'INV/26-27/0001', Dt: '05/10/2026' },
      SellerDtls: { Gstin: OURS, Pin: 500039, Stcd: '36' },
      BuyerDtls: { Gstin: THEIRS, Pos: '36', Pin: 500003 },
      ValDtls: { AssVal: 1850, CgstVal: 166.5, SgstVal: 166.5, IgstVal: 0, TotInvVal: 2183 },
    });
    const items = payload.ItemList as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ SlNo: '1', IsServc: 'N', HsnCd: '390120', Qty: 10, Unit: 'KGS', UnitPrice: 150, TotAmt: 1500, Discount: 150, AssAmt: 1350, GstRt: 18, TotItemVal: 1593, BchDtls: { Nm: 'B1' } });
    expect(items[1]).toMatchObject({ IsServc: 'Y', HsnCd: '998719', Discount: 0 });
  });

  it('maps exports and SEZ supplies with and without payment of tax', () => {
    expect(supplyType({ taxKind: 'export', withLut: true })).toBe('EXPWOP');
    expect(supplyType({ taxKind: 'export', withLut: false })).toBe('EXPWP');
    expect(supplyType({ taxKind: 'sez', withLut: true })).toBe('SEZWOP');
    expect(supplyType({ taxKind: 'sez', withLut: false })).toBe('SEZWP');
    const exp = buildEInvoice(
      source({ taxKind: 'export', withLut: true, interState: true, placeOfSupply: '96', buyer: { gstin: null, registration: 'overseas', legalName: 'Acme GmbH', address: {}, stateCode: null }, lines: [{ ...source().lines[0], cgst: '0', sgst: '0', lineTotal: '1350.00' }], totals: { taxable: '1350.00', cgst: '0', sgst: '0', igst: '0', cess: '0', roundOff: '0', grandTotal: '1350.00' } }),
    );
    expect(exp.errors).toEqual([]);
    expect(exp.payload).toMatchObject({ TranDtls: { SupTyp: 'EXPWOP' }, BuyerDtls: { Gstin: 'URP', Pos: '96', Stcd: '96', Pin: 999999 }, ExpDtls: { RefClm: 'N' } });
  });

  it('refuses B2C invoices and bills of supply', () => {
    expect(notApplicable({ taxKind: 'tax_invoice', buyer: { ...source().buyer, gstin: null } })).toMatch(/B2C/);
    expect(notApplicable({ taxKind: 'bill_of_supply', buyer: source().buyer })).toMatch(/bill of supply/);
  });

  it('reports what the IRP would reject', () => {
    const bad = buildEInvoice(
      source({
        number: '0INV-1',
        buyer: { ...source().buyer, gstin: '36AABCD1234E1Z8', address: { line1: 'x', pincode: '12' } },
        lines: [{ ...source().lines[0], hsnCode: '39', gstRate: '17', igst: '10.00' }],
      }),
    );
    const paths = bad.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['number', 'buyer.gstin', 'buyer.pincode', 'lines.0.hsnCode', 'lines.0.gstRate', 'lines.0.tax', 'totals']));
  });

  it('refers credit notes to the original invoice', () => {
    const { payload } = buildEInvoice(source({ docType: 'CRN', number: 'CN/26-27/0001', preceding: { number: 'INV/26-27/0001', date: '2026-10-05' } }));
    expect(payload).toMatchObject({ DocDtls: { Typ: 'CRN' }, RefDtls: { PrecDocDtls: [{ InvNo: 'INV/26-27/0001', InvDt: '05/10/2026' }] } });
  });

  it('formats dates the NIC way', () => {
    expect(nicDate('2026-04-01')).toBe('01/04/2026');
  });
});

describe('GSP sandbox', () => {
  it('derives the IRN from GSTIN, financial year, type and number (SHA-256)', () => {
    const irn = irnFor(OURS, '2026-10-05', 'INV', 'INV/26-27/0001');
    expect(irn).toBe(createHash('sha256').update(`${OURS}2026-27INVINV/26-27/0001`).digest('hex'));
    expect(irn).toHaveLength(64);
    // Same document, same IRN (the IRP rejects duplicates by this hash).
    expect(irnFor(OURS, '2027-03-31', 'INV', 'INV/26-27/0001')).toBe(irn);
    expect(irnFor(OURS, '2027-04-01', 'INV', 'INV/26-27/0001')).not.toBe(irn);
  });

  it('returns a signed QR whose claims carry the invoice summary', async () => {
    const gsp = new SandboxGsp();
    const { payload } = buildEInvoice(source());
    const r = await gsp.generateIrn(OURS, payload, '2026-10-05');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ackNo).toMatch(/^\d{15}$/);
    const [head, body, sig] = r.data.signedQr.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toMatchObject({ alg: 'RS256' });
    expect(sig.length).toBeGreaterThan(100);
    const claims = JSON.parse(JSON.parse(Buffer.from(body, 'base64url').toString()).data);
    expect(claims).toMatchObject({ SellerGstin: OURS, BuyerGstin: THEIRS, DocNo: 'INV/26-27/0001', DocTyp: 'INV', TotInvVal: 2183, ItemCnt: 2, MainHsnCode: '390120', Irn: r.data.irn });
    expect(qrClaims(payload, 'x', 'y').MainHsnCode).toBe('390120');
    // Another GSTIN cannot register our invoice.
    expect((await gsp.generateIrn(MH, payload, '2026-10-05')).ok).toBe(false);
  });

  it('e-way bill validity: a day per 200 km (20 km for ODC), ending at midnight IST', () => {
    const at = new Date('2026-10-05T10:00:00+05:30');
    expect(ewbValidUntil(at, 150).toISOString()).toBe(new Date('2026-10-06T23:59:59+05:30').toISOString());
    expect(ewbValidUntil(at, 200).toISOString()).toBe(new Date('2026-10-06T23:59:59+05:30').toISOString());
    expect(ewbValidUntil(at, 201).toISOString()).toBe(new Date('2026-10-07T23:59:59+05:30').toISOString());
    expect(ewbValidUntil(at, 45, 'O').toISOString()).toBe(new Date('2026-10-08T23:59:59+05:30').toISOString());
    // Generated just before midnight IST still counts that date as day 0.
    expect(ewbValidUntil(new Date('2026-10-05T23:50:00+05:30'), 100).toISOString()).toBe(new Date('2026-10-06T23:59:59+05:30').toISOString());
  });
});

describe('Customs duty (Bill of Entry)', () => {
  it('BCD on assessable value, SWS on BCD, IGST on the duty-paid value, each to the rupee', () => {
    const d = computeDuty({ assessableValue: '100000', bcdRate: '7.5', swsRate: '10', igstRate: '18', cessRate: '0' });
    expect(d).toMatchObject({ bcdAmount: '7500.00', swsAmount: '750.00', igstAmount: '19485.00', customsDuty: '8250.00', creditable: '19485.00', total: '27735.00' });
    const r = computeDuty({ assessableValue: '12345.67', bcdRate: '10', swsRate: '10', igstRate: '12', cessRate: '1' });
    expect(r).toMatchObject({ bcdAmount: '1235.00', swsAmount: '124.00', igstAmount: '1645.00', cessAmount: '137.00' });
  });
});

describe('Job work deadlines (s.143)', () => {
  it('gives inputs one year and capital goods three', () => {
    expect(returnDeadline('2026-10-05', 'inputs')).toBe('2027-10-05');
    expect(returnDeadline('2026-10-05', 'capital_goods')).toBe('2029-10-05');
  });
});

describe('Bill capture: text extraction', () => {
  const bill = `SHARMA POLYMERS PVT LTD
Plot 14, IDA Jeedimetla, Hyderabad 500055
GSTIN: ${THEIRS}
TAX INVOICE
Invoice No: SP/1234   Invoice Date: 03-Oct-2026
Bill to: Sample Industries Pvt Ltd  GSTIN: ${OURS}
Sr Description HSN Qty Unit Rate Amount
1 HDPE Granules Natural 390120 500 KGS 120.00 60,000.00
2 Masterbatch Blue 320417 20 KGS 450.00 9,000.00
Taxable Value 69,000.00
CGST @9% 6,210.00
SGST @9% 6,210.00
Grand Total 81,420.00
Amount in words: Rupees Eighty One Thousand Four Hundred Twenty Only`;

  it('finds GSTINs, number, date, rows and totals', () => {
    const x = extractFromText(bill, [OURS]);
    expect(x).toMatchObject({ supplierName: 'SHARMA POLYMERS PVT LTD', supplierGstin: THEIRS, buyerGstin: OURS, invoiceNo: 'SP/1234', invoiceDate: '2026-10-03', taxableTotal: '69000.00', cgst: '6210.00', sgst: '6210.00', grandTotal: '81420.00', reverseCharge: false });
    expect(x.lines).toEqual([
      { description: 'HDPE Granules Natural', hsnCode: '390120', qty: '500', unit: 'KGS', rate: '120.00', discountPct: null, taxableValue: '60000.00', gstRate: null },
      { description: 'Masterbatch Blue', hsnCode: '320417', qty: '20', unit: 'KGS', rate: '450.00', discountPct: null, taxableValue: '9000.00', gstRate: null },
    ]);
  });

  it('reads Indian date formats', () => {
    expect(parseDate('05/08/2026')).toBe('2026-08-05');
    expect(parseDate('5-8-26')).toBe('2026-08-05');
    expect(parseDate('05 Sept 2026')).toBe('2026-09-05');
    expect(parseDate('31/02/2026')).toBeNull();
  });

  it('scores name similarity ignoring company suffixes', () => {
    expect(similarity('Sharma Polymers Pvt Ltd', 'SHARMA POLYMERS PRIVATE LIMITED')).toBe(1);
    expect(similarity('HDPE Granules', 'HDPE Granules Natural')).toBeGreaterThan(0.6);
    expect(similarity('Steel rod', 'Paint')).toBe(0);
  });
});
