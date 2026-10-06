import { describe, expect, it } from 'vitest';
import { computeTax, lineTaxable, type TaxContext } from '../../src/modules/gst/gst-engine';

const TS = '36'; // Telangana
const MH = '27';
const CH = '04'; // Chandigarh (UT without legislature)

const sale = (patch: Partial<TaxContext> = {}): TaxContext => ({ direction: 'outward', ownStateCode: TS, partyRegistration: 'regular', partyStateCode: TS, ...patch });
const purchase = (patch: Partial<TaxContext> = {}): TaxContext => ({ direction: 'inward', ownStateCode: TS, partyRegistration: 'regular', partyStateCode: TS, ...patch });

describe('GST engine: outward supplies', () => {
  it('splits intra-state tax into CGST + SGST', () => {
    const r = computeTax(sale(), [{ taxableValue: '1000.00', gstRate: '18' }]);
    expect(r).toMatchObject({ interState: false, placeOfSupply: TS, kind: 'tax_invoice', stateTaxLabel: 'SGST' });
    expect(r.lines[0]).toMatchObject({ cgstRate: '9.000', sgstRate: '9.000', cgst: '90.00', sgst: '90.00', igst: '0.00', tax: '180.00', total: '1180.00' });
    expect(r.totals).toMatchObject({ taxable: '1000.00', tax: '180.00', grandTotal: '1180.00', roundOff: '0.00' });
  });

  it('charges IGST inter-state, using the ship-to state as place of supply', () => {
    const r = computeTax(sale({ partyStateCode: TS, placeOfSupply: MH }), [{ taxableValue: '1000.00', gstRate: '12' }]);
    expect(r).toMatchObject({ interState: true, placeOfSupply: MH });
    expect(r.lines[0]).toMatchObject({ igstRate: '12.00', igst: '120.00', cgst: '0.00' });
  });

  it('uses UTGST in union territories without a legislature', () => {
    const r = computeTax(sale({ ownStateCode: CH, partyStateCode: CH }), [{ taxableValue: '100', gstRate: '5' }]);
    expect(r.stateTaxLabel).toBe('UTGST');
    expect(r.lines[0]).toMatchObject({ cgst: '2.50', sgst: '2.50' });
  });

  it('handles 0.25% / 3% rates, cess and paise rounding', () => {
    const r = computeTax(sale(), [
      { taxableValue: '999.99', gstRate: '0.25' },
      { taxableValue: '333.33', gstRate: '28', cessRate: '12' },
    ]);
    expect(r.lines[0]).toMatchObject({ cgstRate: '0.125', cgst: '1.25', sgst: '1.25' });
    expect(r.lines[1]).toMatchObject({ cgst: '46.67', sgst: '46.67', cess: '40.00' });
    expect(r.totals).toMatchObject({ taxable: '1333.32', tax: '135.84', roundOff: '-0.16', grandTotal: '1469.00' });
  });

  it('exports and SEZ are inter-state; under LUT they are zero-rated', () => {
    const exp = computeTax(sale({ partyRegistration: 'overseas', partyStateCode: null, withLut: true }), [{ taxableValue: '5000', gstRate: '18' }]);
    expect(exp).toMatchObject({ kind: 'export', placeOfSupply: '96', interState: true });
    expect(exp.lines[0]).toMatchObject({ taxability: 'zero_rated', tax: '0.00' });
    expect(exp.notes[0]).toMatch(/under LUT/);

    const sez = computeTax(sale({ partyRegistration: 'sez', partyStateCode: TS }), [{ taxableValue: '5000', gstRate: '18' }]);
    expect(sez).toMatchObject({ kind: 'sez', interState: true });
    expect(sez.lines[0]).toMatchObject({ igst: '900.00', cgst: '0.00' });
  });

  it('composition sellers issue a bill of supply with no tax', () => {
    const r = computeTax(sale({ ownRegistration: 'composition' }), [{ taxableValue: '1000', gstRate: '18' }]);
    expect(r).toMatchObject({ kind: 'bill_of_supply', totals: { tax: '0.00', grandTotal: '1000.00' } });
  });

  it('exempt items carry no tax', () => {
    const r = computeTax(sale(), [{ taxableValue: '400', gstRate: '18', exempt: true }]);
    expect(r.lines[0]).toMatchObject({ taxability: 'exempt', tax: '0.00' });
  });
});

describe('GST engine: inward supplies', () => {
  it('takes the place of supply from our receiving state', () => {
    const r = computeTax(purchase({ partyStateCode: MH }), [{ taxableValue: '2000', gstRate: '18' }]);
    expect(r).toMatchObject({ placeOfSupply: TS, supplierStateCode: MH, interState: true });
    expect(r.lines[0].igst).toBe('360.00');
  });

  it('charges nothing from composition or unregistered suppliers', () => {
    expect(computeTax(purchase({ partyRegistration: 'composition' }), [{ taxableValue: '100', gstRate: '18' }]).totals.tax).toBe('0.00');
    const unreg = computeTax(purchase({ partyRegistration: 'unregistered' }), [{ taxableValue: '100', gstRate: '18' }]);
    expect(unreg).toMatchObject({ kind: 'unregistered', totals: { tax: '0.00', grandTotal: '100.00' } });
  });

  it('computes reverse-charge tax without adding it to the supplier total', () => {
    const r = computeTax(purchase({ partyRegistration: 'unregistered', reverseCharge: true }), [{ taxableValue: '10000', gstRate: '5' }]);
    expect(r.reverseCharge).toBe(true);
    expect(r.lines[0]).toMatchObject({ taxability: 'reverse_charge', cgst: '250.00', sgst: '250.00', tax: '0.00', total: '10000.00' });
    expect(r.totals).toMatchObject({ tax: '0.00', reverseChargeTax: '500.00', grandTotal: '10000.00' });
  });

  it('imports: tax is paid at customs, not to the supplier', () => {
    const r = computeTax(purchase({ partyRegistration: 'overseas', partyStateCode: null }), [{ taxableValue: '100000', gstRate: '18' }]);
    expect(r).toMatchObject({ kind: 'import', interState: true, totals: { tax: '0.00' } });
    expect(r.lines[0].taxability).toBe('import');
  });
});

describe('line value', () => {
  it('applies the discount and rounds to paise', () => {
    expect(lineTaxable('3', '33.333', '10')).toBe('90.00');
    expect(lineTaxable('2.5', '98.50')).toBe('246.25');
  });
});

describe('amount in words', () => {
  it('uses lakh and crore', async () => {
    const { rupeesInWords } = await import('../../src/common/amount-in-words');
    expect(rupeesInWords('140125.00')).toBe('Indian Rupees One Lakh Forty Thousand One Hundred Twenty Five Only');
    expect(rupeesInWords('12345678.5')).toBe('Indian Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only');
    expect(rupeesInWords('0')).toBe('Indian Rupees Zero Only');
  });
});
