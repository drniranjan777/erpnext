import { describe, expect, it } from 'vitest';
import { autoMatch, parseMt940, parseStatementTable, statementDate } from '../../src/modules/accounting/bank-statement';
import { parseCsv } from '../../src/modules/imports/file-parser';

describe('bank statement parsing', () => {
  it('skips the preamble and reads withdrawal / deposit columns (HDFC style)', () => {
    const csv = `HDFC BANK Ltd.,
Account No :,50200012345678
Statement From : 01/10/2026 To : 07/10/2026,

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/10/26,NEFT CR-HDFC0000123-PUNE COLD CHAIN-RV/26-27/0001,000000123456,01/10/26,,"2,950.00","1,02,950.00"
03/10/26,CHQ PAID-MICR CTS-000451-SHARMA POLYMERS,000451,03/10/26,"11,859.00",,"91,091.00"
05/10/26,CHARGES FOR NEFT,,05/10/26,17.70,,"91,073.30"
`;
    const lines = parseStatementTable(parseCsv(csv));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ txnDate: '2026-10-01', deposit: '2950.00', withdrawal: '0.00', balance: '102950.00', reference: '000000123456' });
    expect(lines[1]).toMatchObject({ withdrawal: '11859.00', deposit: '0.00', description: 'CHQ PAID-MICR CTS-000451-SHARMA POLYMERS' });
    expect(lines[2]).toMatchObject({ withdrawal: '17.70', reference: null });
  });

  it('reads amount + Dr/Cr statements (SBI style)', () => {
    const csv = `Txn Date,Description,Ref No,Amount,Dr/Cr,Balance
5 Oct 2026,BY TRANSFER-UPI,UPI12345,"1,000.00",CR,"5,000.00"
6 Oct 2026,TO CLG,451,250.00,DR,"4,750.00"`;
    const lines = parseStatementTable(parseCsv(csv));
    expect(lines.map((l) => [l.txnDate, l.deposit, l.withdrawal])).toEqual([
      ['2026-10-05', '1000.00', '0.00'],
      ['2026-10-06', '0.00', '250.00'],
    ]);
  });

  it('refuses a file without statement columns', () => {
    expect(() => parseStatementTable(parseCsv('Name,City\nA,B'))).toThrow(/statement columns/);
  });

  it('reads MT940 :61: lines with their :86: narrative', () => {
    const mt = `:20:STMT
:25:HDFC/50200012345678
:60F:C261001INR100000,00
:61:2610011001C2950,00NTRFRV2627001//123456
:86:NEFT PUNE COLD CHAIN
:61:2610031003D11859,00NCHK000451
:86:CHQ 000451 SHARMA POLYMERS
:62F:C261003INR91091,00`;
    const lines = parseMt940(mt);
    expect(lines).toEqual([
      expect.objectContaining({ txnDate: '2026-10-01', deposit: '2950.00', withdrawal: '0.00', description: 'NEFT PUNE COLD CHAIN', reference: 'RV2627001' }),
      expect.objectContaining({ txnDate: '2026-10-03', deposit: '0.00', withdrawal: '11859.00', description: 'CHQ 000451 SHARMA POLYMERS' }),
    ]);
  });

  it('reads Indian date formats day-first', () => {
    expect(statementDate('05/10/26')).toBe('2026-10-05');
    expect(statementDate('5-Oct-2026')).toBe('2026-10-05');
    expect(statementDate('2026-10-05T00:00:00')).toBe('2026-10-05');
    expect(statementDate('31/02/2026')).toBeNull();
  });
});

describe('auto-matching', () => {
  const line = (txnDate: string, deposit: string, withdrawal: string, description: string) => ({ txnDate, valueDate: null, description, reference: null, deposit, withdrawal, balance: null });

  it('prefers a reference match, then a unique amount within 3 days, then within 10', () => {
    const lines = [line('2026-10-03', '0.00', '11859.00', 'CHQ PAID 000451'), line('2026-10-01', '2950.00', '0.00', 'NEFT CR'), line('2026-10-12', '0.00', '500.00', 'IMPS')];
    const entries = [
      { id: 'pay-a', postingDate: '2026-10-02', amount: '-11859.00', refs: ['000999'] },
      { id: 'pay-b', postingDate: '2026-09-20', amount: '-11859.00', refs: ['000451'] },
      { id: 'rcpt', postingDate: '2026-09-30', amount: '2950.00', refs: [] },
      { id: 'late', postingDate: '2026-10-05', amount: '-500.00', refs: [] },
    ];
    expect(autoMatch(lines, entries)).toEqual([
      { lineIndex: 0, entryIds: ['pay-b'], rule: 'reference' },
      { lineIndex: 1, entryIds: ['rcpt'], rule: 'amount_date' },
      { lineIndex: 2, entryIds: ['late'], rule: 'amount_window' },
    ]);
  });

  it('leaves ambiguous lines alone and never reuses an entry', () => {
    const lines = [line('2026-10-03', '1000.00', '0.00', 'A'), line('2026-10-03', '1000.00', '0.00', 'B')];
    const two = [
      { id: 'x', postingDate: '2026-10-02', amount: '1000.00', refs: [] },
      { id: 'y', postingDate: '2026-10-03', amount: '1000.00', refs: [] },
    ];
    expect(autoMatch(lines, two)).toEqual([]);
    const one = [{ id: 'x', postingDate: '2026-10-02', amount: '1000.00', refs: [] }];
    expect(autoMatch(lines, one)).toEqual([{ lineIndex: 0, entryIds: ['x'], rule: 'amount_date' }]);
  });
});
