import { describe, expect, it } from 'vitest';
import { normaliseHeader, parseCsv } from '../../src/modules/imports/file-parser';
import { parseTally, uniqueCode } from '../../src/modules/imports/tally';
import { date, decimal, stateCode, toCode, unitKey, ValueError, yesNo } from '../../src/modules/imports/values';

describe('CSV', () => {
  it('handles quotes, embedded commas/newlines and CRLF', () => {
    expect(parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
    ]);
  });

  it('detects semicolon and tab separators', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('normalises headers', () => {
    expect(normaliseHeader('Item Code *')).toBe('item_code');
    expect(normaliseHeader('GST %')).toBe('gst_percent');
    expect(normaliseHeader(' HSN/SAC ')).toBe('hsn_sac');
  });
});

describe('values', () => {
  it('reads Indian-formatted numbers', () => {
    expect(decimal('1,23,456.50')).toBe('123456.50');
    expect(decimal('₹ 120')).toBe('120');
    expect(decimal('18%', 2)).toBe('18');
    expect(decimal('0.12345', 4)).toBe('0.1235');
    expect(decimal('(125.00)', 2, { signed: true })).toBe('-125.00');
    expect(() => decimal('-5')).toThrow(ValueError);
    expect(() => decimal('12abc')).toThrow(ValueError);
  });

  it('reads dates day-first', () => {
    expect(date('01-04-2026')).toBe('2026-04-01');
    expect(date('1/4/26')).toBe('2026-04-01');
    expect(date('31-Mar-2027')).toBe('2027-03-31');
    expect(date('20260401')).toBe('2026-04-01');
    expect(date('46113')).toBe('2026-04-01'); // Excel serial
    expect(() => date('31-02-2026')).toThrow(ValueError);
  });

  it('reads yes/no, states, units and codes', () => {
    expect(yesNo('Y')).toBe(true);
    expect(yesNo('')).toBe(false);
    expect(() => yesNo('maybe')).toThrow(ValueError);
    expect(stateCode('telangana')).toBe('36');
    expect(stateCode('7')).toBe('07');
    expect(stateCode('Orissa')).toBe('21');
    expect(() => stateCode('Atlantis')).toThrow(ValueError);
    expect(unitKey('Kgs')).toBe('KG');
    expect(unitKey('nos.')).toBe('NOS');
    expect(toCode('Raw Materials & Spares', 20)).toBe('RAW-MATERIALS-AND-SP');
    const taken = new Set(['WIRES']);
    expect(uniqueCode('Wires', 20, taken)).toBe('WIRES-2');
  });
});

describe('Tally XML', () => {
  it('reads items, opening stock and party ledgers', () => {
    const xml = `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
      <TALLYMESSAGE><STOCKITEM NAME="Bolt"><PARENT>&#4; Primary</PARENT><BASEUNITS>Nos</BASEUNITS>
        <OPENINGBALANCE> 12 Nos</OPENINGBALANCE><OPENINGVALUE>-60.00</OPENINGVALUE><OPENINGRATE></OPENINGRATE>
        <HSNDETAILS.LIST><APPLICABLEFROM>20240401</APPLICABLEFROM><HSNCODE>7318</HSNCODE></HSNDETAILS.LIST>
      </STOCKITEM></TALLYMESSAGE>
      <TALLYMESSAGE><LEDGER NAME="Acme"><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>36aabcs1234e1zu</PARTYGSTIN></LEDGER></TALLYMESSAGE>
      <TALLYMESSAGE><LEDGER NAME="Sales"><PARENT>Sales Accounts</PARENT></LEDGER></TALLYMESSAGE>
    </REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const data = parseTally(Buffer.from(xml));
    expect(data.items[0].values).toMatchObject({ name: 'Bolt', base_unit: 'Nos', hsn_code: '7318', group: 'Primary' });
    expect(data.opening[0].values).toMatchObject({ item_code: 'Bolt', warehouse: '', qty: '12', rate: '5' });
    expect(data.parties).toHaveLength(1);
    expect(data.parties[0].values).toMatchObject({ name: 'Acme', type: 'Customer', gstin: '36AABCS1234E1ZU' });
    expect(data.skipped.ledgers).toBe(1);
  });

  it('rejects other XML', () => {
    expect(() => parseTally(Buffer.from('<rss></rss>'))).toThrow(/not a Tally XML/);
  });
});
