import { describe, expect, it } from 'vitest';
import { addWorking, nextWorking, spread, workingMinutes, type Calendar } from '../../src/modules/planning/calendar';
import { schedule, type SchedOp, type SchedWorkCenter } from '../../src/modules/planning/scheduler';
import { nextRevision } from '../../src/modules/engineering/drawings.service';

/** Epoch ms of an IST wall-clock time. */
const ist = (s: string) => Date.parse(`${s}+05:30`);
const iso = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 16);
const CAL: Calendar = { minutesPerDay: 480, daysPerWeek: 6, shiftStart: 540 }; // 09:00–17:00, Mon–Sat

describe('working calendar', () => {
  it('snaps to the next shift and skips Sundays', () => {
    expect(iso(nextWorking(CAL, ist('2026-10-05T07:00')))).toBe('2026-10-05T09:00'); // Monday early
    expect(iso(nextWorking(CAL, ist('2026-10-05T18:00')))).toBe('2026-10-06T09:00');
    expect(iso(nextWorking(CAL, ist('2026-10-10T17:30')))).toBe('2026-10-12T09:00'); // Saturday evening → Monday
    expect(iso(nextWorking({ ...CAL, daysPerWeek: 5 }, ist('2026-10-10T10:00')))).toBe('2026-10-12T09:00');
  });

  it('adds working time across days and weekends', () => {
    expect(iso(addWorking(CAL, ist('2026-10-05T16:00'), 120))).toBe('2026-10-06T10:00');
    expect(iso(addWorking(CAL, ist('2026-10-10T16:00'), 120))).toBe('2026-10-12T10:00');
    // A night shift running past midnight.
    const night: Calendar = { minutesPerDay: 480, daysPerWeek: 7, shiftStart: 22 * 60 };
    expect(iso(addWorking(night, ist('2026-10-05T23:00'), 300))).toBe('2026-10-06T04:00');
    expect(workingMinutes(CAL, ist('2026-10-05T00:00'), ist('2026-10-12T00:00'))).toBe(6 * 480);
  });

  it('spreads load over working time', () => {
    const b = [
      { start: ist('2026-10-05T00:00'), end: ist('2026-10-06T00:00') },
      { start: ist('2026-10-06T00:00'), end: ist('2026-10-07T00:00') },
    ];
    expect(spread(CAL, ist('2026-10-05T13:00'), ist('2026-10-06T17:00'), 720, b)).toEqual([240, 480]);
  });
});

const wc = (id: string, units = 1, over: Partial<SchedWorkCenter> = {}): SchedWorkCenter => ({ id, cal: CAL, units, efficiency: 1, infinite: false, ...over });
const op = (id: string, wo: string, seq: number, wcId: string, itemId: string, setup: number, run: number, over: Partial<SchedOp> = {}): SchedOp => ({ id, workOrderId: wo, seq, workCenterId: wcId, itemId, setupMinutes: setup, runMinutes: run, running: false, locked: null, ...over });
const NOW = ist('2026-10-05T09:00');

describe('finite scheduler', () => {
  it('chains operations, queues on a busy work centre and flags lateness', () => {
    const out = schedule({
      now: NOW,
      workCenters: new Map([
        ['cut', wc('cut')],
        ['weld', wc('weld')],
      ]),
      orders: [
        { id: 'A', priority: 1, due: ist('2026-10-06T00:00'), release: NOW },
        { id: 'B', priority: 3, due: ist('2026-10-06T00:00'), release: NOW },
      ],
      ops: [op('a1', 'A', 10, 'cut', 'x', 30, 210), op('a2', 'A', 20, 'weld', 'x', 0, 120), op('b1', 'B', 10, 'cut', 'y', 60, 240)],
      transitions: new Map(),
    });
    const at = (id: string) => out.ops.find((o) => o.id === id)!;
    expect([iso(at('a1').start), iso(at('a1').end)]).toEqual(['2026-10-05T09:00', '2026-10-05T13:00']);
    expect([iso(at('a2').start), iso(at('a2').end)]).toEqual(['2026-10-05T13:00', '2026-10-05T15:00']);
    // B waits for the cutter, then runs 5 h: 13:00 → 17:00 + 1 h next day.
    expect([iso(at('b1').start), iso(at('b1').end)]).toEqual(['2026-10-05T13:00', '2026-10-06T10:00']);
    expect(out.orders.find((o) => o.id === 'A')!.late).toBe(false);
    expect(out.orders.find((o) => o.id === 'B')!.late).toBe(true);
  });

  it('uses parallel units and sequence-dependent setups', () => {
    const out = schedule({
      now: NOW,
      workCenters: new Map([['mix', wc('mix', 2)]]),
      orders: ['A', 'B', 'C'].map((id, i) => ({ id, priority: 3, due: null, release: NOW + i })),
      ops: [op('a', 'A', 10, 'mix', 'white', 60, 60), op('b', 'B', 10, 'mix', 'black', 60, 60), op('c', 'C', 10, 'mix', 'white', 60, 60)],
      transitions: new Map([['mix|black|white', 120]]),
    });
    const at = (id: string) => out.ops.find((o) => o.id === id)!;
    expect(at('a').lane).not.toBe(at('b').lane);
    // C follows A (same colour, no setup) rather than black (120 min changeover).
    expect(at('c')).toMatchObject({ lane: at('a').lane, setup: 0 });
    expect(iso(at('c').end)).toBe('2026-10-05T12:00');
  });

  it('keeps hand-placed operations and fits the rest around them', () => {
    const out = schedule({
      now: NOW,
      workCenters: new Map([['cut', wc('cut')]]),
      orders: [
        { id: 'A', priority: 3, due: null, release: NOW },
        { id: 'B', priority: 1, due: null, release: NOW },
      ],
      ops: [op('a', 'A', 10, 'cut', 'x', 0, 120, { locked: { start: ist('2026-10-05T10:00'), lane: 0 } }), op('b', 'B', 10, 'cut', 'y', 0, 120)],
      transitions: new Map(),
    });
    expect(iso(out.ops.find((o) => o.id === 'a')!.start)).toBe('2026-10-05T10:00');
    // B cannot fit in the hour before A, so it goes after.
    expect(iso(out.ops.find((o) => o.id === 'b')!.start)).toBe('2026-10-05T12:00');
  });

  it('gives outside work unlimited capacity and divides by efficiency', () => {
    const out = schedule({
      now: NOW,
      workCenters: new Map([
        ['plate', wc('plate', 1, { infinite: true })],
        ['slow', wc('slow', 1, { efficiency: 0.8 })],
      ]),
      orders: [
        { id: 'A', priority: 3, due: null, release: NOW },
        { id: 'B', priority: 3, due: null, release: NOW },
      ],
      ops: [op('a', 'A', 10, 'plate', 'x', 0, 240), op('b', 'B', 10, 'plate', 'y', 0, 240), op('c', 'B', 20, 'slow', 'y', 0, 96)],
      transitions: new Map(),
    });
    const at = (id: string) => out.ops.find((o) => o.id === id)!;
    expect(at('a').start).toBe(at('b').start);
    expect(iso(at('c').end)).toBe('2026-10-05T15:00'); // 96 ÷ 0.8 = 120 min after 13:00
  });
});

describe('drawing revisions', () => {
  it('steps letters and numbers', () => {
    expect(nextRevision('A')).toBe('B');
    expect(nextRevision('Z')).toBe('AA');
    expect(nextRevision('AZ')).toBe('BA');
    expect(nextRevision('09')).toBe('10');
    expect(nextRevision('3')).toBe('4');
    expect(nextRevision('A1')).toBe('A1-1');
  });
});
