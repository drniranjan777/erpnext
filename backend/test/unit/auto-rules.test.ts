import { describe, expect, it } from 'vitest';
import { actionPriority, apqpProgress, apqpTemplate, buildDesadv, buildInvoic, lpaScore, parseEdifact, ppapElements, ppapOpen, readSchedule } from '../../src/modules/auto/auto-rules';

describe('AIAG-VDA action priority', () => {
  it('follows the table', () => {
    expect(actionPriority(9, 8, 7)).toBe('H');
    expect(actionPriority(10, 4, 1)).toBe('M');
    expect(actionPriority(9, 2, 1)).toBe('L');
    expect(actionPriority(8, 4, 5)).toBe('M');
    expect(actionPriority(7, 6, 1)).toBe('M');
    expect(actionPriority(5, 8, 2)).toBe('M');
    expect(actionPriority(5, 6, 1)).toBe('L');
    expect(actionPriority(3, 9, 8)).toBe('M');
    expect(actionPriority(3, 6, 8)).toBe('L');
    expect(actionPriority(1, 10, 10)).toBe('L');
  });
});

describe('APQP and PPAP', () => {
  it('tracks phase readiness', () => {
    const d = apqpTemplate().map((x) => (x.phase === 1 ? { ...x, status: x.code === 'P1-05' ? 'na' : 'done' } : x));
    const p = apqpProgress(d);
    expect(p[0]).toMatchObject({ phase: 1, total: 5, done: 5, pct: 100, ready: true });
    expect(p[1]).toMatchObject({ ready: false, pct: 0 });
    expect(apqpTemplate()).toHaveLength(24);
  });

  it('sets what to submit by level and lists what is still open', () => {
    const l2 = ppapElements(2);
    expect(l2.filter((e) => e.requirement === 'S').map((e) => e.no)).toEqual([1, 2, 9, 10, 12, 13, 14, 18]);
    expect(ppapElements(3).filter((e) => e.requirement === 'R').map((e) => e.no)).toEqual([15, 16]);
    expect(ppapElements(1).filter((e) => e.requirement === 'S').map((e) => e.no)).toEqual([13, 18]);
    expect(ppapOpen(ppapElements(1)).map((e) => e.no)).toEqual([13]);
    expect(ppapOpen(ppapElements(1).map((e) => ({ ...e, status: 'complete' })))).toEqual([]);
  });

  it('scores layered process audits', () => {
    expect(lpaScore([{ answer: 'yes' }, { answer: 'no' }, { answer: 'na' }, { answer: 'yes' }])).toEqual({ questions: 4, findings: 1, compliancePct: 66.7 });
  });
});

describe('EDIFACT', () => {
  const delfor = `UNA:+.? 'UNB+UNOC:3+OEMPLANT1+SUPP042+261008:0915+77'UNH+1+DELFOR:D:96A:UN'BGM+241+DS-2610?+A+5'NAD+BY+OEMPLANT1::92'NAD+SE+SUPP042::92'
LIN+1++BRKT-101:IN'SCC+1'QTY+113:500:PCE'DTM+2:20261014:102'QTY+113:600:PCE'DTM+2:20261021:102'SCC+4'QTY+113:2000:PCE'DTM+2:20261101:102'
LIN+2++BRKT-202:IN'SCC+1'QTY+113:120:PCE'DTM+2:20261015:102'UNT+17+1'UNZ+1+77'`;

  it('parses segments with the release character', () => {
    const s = parseEdifact(delfor);
    expect(s[0]).toEqual({ tag: 'UNB', elements: [['UNOC', '3'], ['OEMPLANT1'], ['SUPP042'], ['261008', '0915'], ['77']] });
    expect(s.find((x) => x.tag === 'BGM')?.elements[1]).toEqual(['DS-2610+A']);
  });

  it('reads a delivery schedule with firm and forecast quantities', () => {
    expect(readSchedule(delfor)).toEqual({
      type: 'DELFOR',
      sender: 'OEMPLANT1',
      receiver: 'SUPP042',
      reference: 'DS-2610+A',
      lines: [
        { part: 'BRKT-101', qty: 500, date: '2026-10-14', firm: true },
        { part: 'BRKT-101', qty: 600, date: '2026-10-21', firm: true },
        { part: 'BRKT-101', qty: 2000, date: '2026-11-01', firm: false },
        { part: 'BRKT-202', qty: 120, date: '2026-10-15', firm: true },
      ],
    });
    expect(() => readSchedule("UNH+1+ORDERS:D:96A:UN'")).toThrow(/Not a delivery schedule/);
  });

  it('builds a despatch advice and an invoice that parse back', () => {
    const now = new Date('2026-10-08T04:00:00Z');
    const d = buildDesadv({ sender: 'SUPP042', receiver: 'OEMPLANT1', number: 'DN/26-27/0012', date: '2026-10-08', orderRef: 'SO/26-27/0003', lines: [{ part: 'BRKT-101', qty: 500 }], now });
    const s = parseEdifact(d);
    expect(s.map((x) => x.tag)).toEqual(['UNB', 'UNH', 'BGM', 'DTM', 'DTM', 'RFF', 'NAD', 'NAD', 'CPS', 'LIN', 'QTY', 'UNT', 'UNZ']);
    expect(s.find((x) => x.tag === 'UNT')?.elements[0]).toEqual(['11']);
    expect(s.find((x) => x.tag === 'QTY')?.elements[0]).toEqual(['12', '500', 'PCE']);
    const inv = buildInvoic({ sender: 'SUPP042', receiver: 'OEMPLANT1', number: 'INV/26-27/0040', date: '2026-10-08', lines: [{ part: 'BRKT-101', qty: 500, price: 42.5, amount: 21250, gstRate: 18 }], taxable: 21250, tax: 3825, total: 25075, now });
    const t = parseEdifact(inv);
    expect(t.filter((x) => x.tag === 'MOA').map((x) => x.elements[0])).toEqual([['203', '21250.00'], ['77', '25075.00'], ['125', '21250.00'], ['124', '3825.00']]);
    expect(t.find((x) => x.tag === 'TAX')?.elements).toEqual([['7'], ['VAT'], [''], [''], ['', '', '', '18']]);
  });
});
