import { describe, expect, it } from 'vitest';
import { combineOee, computeOee, counterDelta, currentShift, shiftWindows, type Span } from '../../src/modules/mes/oee';

const s = (sec: number) => sec * 1000;

describe('OEE', () => {
  const spans: Span[] = [
    { state: 'running', start: s(0), end: s(1800), loss: null },
    { state: 'stopped', start: s(1800), end: s(1900), loss: null },
    { state: 'running', start: s(1900), end: s(2700), loss: null },
    { state: 'stopped', start: s(2700), end: s(3300), loss: 'breakdown' },
    { state: 'setup', start: s(3300), end: s(3600), loss: null },
  ];

  it('splits an hour into availability, performance and quality with the six big losses', () => {
    const r = computeOee({ from: 0, to: s(3600), now: s(4000), spans, counts: [{ minute: 0, good: 1400, reject: 100, idealSeconds: 1500 }], minorStopSeconds: 300 });
    expect(r).toMatchObject({ plannedSeconds: 3600, runSeconds: 2600, downtimeSeconds: 900, operatingSeconds: 2700, good: 1400, reject: 100, stops: 2 });
    expect(r.losses).toEqual({ breakdown: 600, setup: 300, unexplained: 0, other: 0, minor_stop: 100, speed: 1100, defects: 100, startup: 0 });
    expect([r.availability, r.performance, r.quality, r.oee]).toEqual([0.75, 0.5556, 0.9333, 0.3889]);
  });

  it('leaves out planned stops, breaks and time without data, and counts start-up rejects', () => {
    const r = computeOee({
      from: 0,
      to: s(3600),
      now: s(3000),
      spans: [
        { state: 'setup', start: s(0), end: s(600), loss: null },
        { state: 'running', start: s(600), end: s(1800), loss: null },
        { state: 'planned_stop', start: s(1800), end: s(2100), loss: null },
        { state: 'stopped', start: s(2100), end: null, loss: null },
      ],
      counts: [
        { minute: s(600), good: 50, reject: 10, idealSeconds: 60 },
        { minute: s(1500), good: 100, reject: 5, idealSeconds: 105 },
      ],
      minorStopSeconds: 300,
      breakSeconds: 600,
    });
    // Now is 3000 s: 2100–3000 is a 900 s unexplained stop, of which 600 s are the shift break.
    expect(r).toMatchObject({ windowSeconds: 3000, noDataSeconds: 0, plannedStopSeconds: 900, plannedSeconds: 2100 });
    expect(r.losses).toMatchObject({ setup: 600, unexplained: 300, startup: 10, defects: 5 });
    expect(r.availability).toBe(0.5714);
  });

  it('adds results of several machines', () => {
    const a = computeOee({ from: 0, to: s(3600), now: s(3600), spans, counts: [{ minute: 0, good: 1400, reject: 100, idealSeconds: 1500 }], minorStopSeconds: 300 });
    const idle = computeOee({ from: 0, to: s(3600), now: s(3600), spans: [], counts: [], minorStopSeconds: 300 });
    expect(idle).toMatchObject({ noDataSeconds: 3600, oee: null });
    expect(combineOee([a, a]).oee).toBe(a.oee);
    expect(combineOee([a, idle]).plannedSeconds).toBe(3600);
  });
});

describe('shifts and counters', () => {
  const shifts = [
    { code: 'A', name: 'A', startMinute: 360, endMinute: 840, breakMinutes: 30 },
    { code: 'B', name: 'B', startMinute: 840, endMinute: 1320, breakMinutes: 30 },
    { code: 'C', name: 'C', startMinute: 1320, endMinute: 360, breakMinutes: 30 },
  ];
  const ist = (d: string) => Date.parse(`${d}+05:30`);

  it('lists the shifts overlapping a day, including the night shift across midnight', () => {
    const w = shiftWindows(shifts, ist('2026-10-08T00:00:00'), ist('2026-10-09T00:00:00'));
    expect(w.map((x) => `${x.date} ${x.shift.code}`)).toEqual(['2026-10-07 C', '2026-10-08 A', '2026-10-08 B', '2026-10-08 C']);
    expect(new Date(w[0].end).toISOString()).toBe('2026-10-08T00:30:00.000Z');
    expect(currentShift(shifts, ist('2026-10-08T23:30:00'))?.shift.code).toBe('C');
    expect(currentShift(shifts, ist('2026-10-08T10:00:00'))?.date).toBe('2026-10-08');
  });

  it('turns counter readings into counts, treating a drop as a reset', () => {
    expect(counterDelta(null, 500)).toBe(0);
    expect(counterDelta(500, 512)).toBe(12);
    expect(counterDelta(65530, 4)).toBe(4);
  });
});
