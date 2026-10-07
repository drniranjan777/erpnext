import { describe, expect, it } from 'vitest';
import { detectKind, extractDocument, meetsSpec } from '../../src/modules/docai/extractors';

const EWB = `e-Way Bill
E-Way Bill No: 3412 5678 9012
Generated Date: 05/10/2026  Valid Upto: 07/10/2026
GSTIN of Supplier 36AABCS1234E1ZU  GSTIN of Recipient 27AAACN0000A1ZL
Document No. INV/26/0456  Document Date 05/10/2026
Vehicle No: TS 08 UB 4455
Total Invoice Value: 2,45,600.00
Approx Distance 712 km`;

const COA = `CERTIFICATE OF ANALYSIS
Product Name: Calcium carbonate IP
Batch No: CC-2609-14     Mfg. Date: 12/09/2026     Expiry Date: 11/09/2028
S.No  Test    Specification    Result
1  Description    White powder complies    Complies
2  pH    9.0 - 10.5    9.6
3  Assay    NLT 98.0 %    97.4 %
4  Loss on drying    NMT 1.0 %    0.4 %`;

const BANK = `HDFC BANK  Statement of Account
A/c No: XXXXXX4521   IFSC: HDFC0001234
Date        Narration                          Withdrawal     Deposit        Balance
01/10/2026  Opening balance                                                1,00,000.00
02/10/2026  NEFT-DECCAN FOODS-INV 451        0.00          59,000.00      1,59,000.00
03/10/2026  RTGS-TELANGANA POLYMERS          45,000.00     0.00           1,14,000.00`;

describe('document detection', () => {
  it('tells documents apart', () => {
    expect(detectKind(EWB).kind).toBe('eway_bill');
    expect(detectKind(COA).kind).toBe('coa');
    expect(detectKind(BANK).kind).toBe('bank_statement');
    expect(detectKind('DELIVERY CHALLAN  Challan No: DC/112  Returnable').kind).toBe('delivery_challan');
    expect(detectKind('Quotation No: Q-77  Validity: 30 days').kind).toBe('quotation');
    expect(detectKind('hello world').kind).toBe('unknown');
  });
});

describe('e-way bill', () => {
  it('reads the number, dates, parties, vehicle and value', () => {
    const r = extractDocument(EWB);
    expect(r.fields).toMatchObject({ ewbNo: '341256789012', generatedOn: '2026-10-05', validUntil: '2026-10-07', fromGstin: '36AABCS1234E1ZU', toGstin: '27AAACN0000A1ZL', vehicleNo: 'TS08UB4455', value: 245600, distanceKm: 712 });
    expect(r.warnings).toEqual([]);
  });
});

describe('certificate of analysis', () => {
  it('reads the batch and checks every result against its specification', () => {
    const r = extractDocument(COA);
    expect(r.fields).toMatchObject({ batchNo: 'CC-2609-14', mfgDate: '2026-09-12', expiryDate: '2028-09-11', conclusion: 'fails' });
    expect(r.lines.map((l) => [l.parameter, l.pass])).toEqual([['Description', true], ['pH', true], ['Assay', false], ['Loss on drying', true]]);
    expect(r.warnings).toContain('Assay: 97.4 % is outside NLT 98.0 %');
  });
  it('judges specifications', () => {
    expect(meetsSpec('6.5 - 7.5', '7.1')).toBe(true);
    expect(meetsSpec('≤ 0.5 %', '0.7')).toBe(false);
    expect(meetsSpec('Min 99', '99.4')).toBe(true);
    expect(meetsSpec('Complies', 'Does not comply')).toBe(false);
  });
});

describe('bank statement', () => {
  it('reads transactions and checks the running balance', () => {
    const r = extractDocument(BANK);
    expect(r.fields).toMatchObject({ ifsc: 'HDFC0001234' });
    expect(r.lines.slice(1)).toEqual([
      { date: '2026-10-02', narration: 'NEFT-DECCAN FOODS-INV 451', debit: null, credit: 59000, balance: 159000 },
      { date: '2026-10-03', narration: 'RTGS-TELANGANA POLYMERS', debit: 45000, credit: null, balance: 114000 },
    ]);
    expect(r.warnings).toEqual([]);
  });
});
