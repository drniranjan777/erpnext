import { describe, expect, it } from 'vitest';
import { addWorkingMinutes, slaState, triage } from '../../src/modules/service/sla';

const ist = (s: string) => new Date(`${s}+05:30`);
const hours = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5, 6] };

describe('due times', () => {
  it('adds minutes round the clock', () => {
    expect(addWorkingMinutes(ist('2026-10-07T17:00:00'), 240, null).toISOString()).toBe(ist('2026-10-07T21:00:00').toISOString());
  });
  it('counts only business hours', () => {
    // Wednesday 17:00 + 4 h: 1 h today, 3 h from 09:00 Thursday.
    expect(addWorkingMinutes(ist('2026-10-07T17:00:00'), 240, hours).toISOString()).toBe(ist('2026-10-08T12:00:00').toISOString());
    // Saturday 17:30 + 2 h skips Sunday: 30 min Saturday, 90 min Monday.
    expect(addWorkingMinutes(ist('2026-10-10T17:30:00'), 120, hours).toISOString()).toBe(ist('2026-10-12T10:30:00').toISOString());
    // Logged at night: the clock starts at 09:00.
    expect(addWorkingMinutes(ist('2026-10-07T22:00:00'), 60, hours).toISOString()).toBe(ist('2026-10-08T10:00:00').toISOString());
    // Two full working days.
    expect(addWorkingMinutes(ist('2026-10-07T09:00:00'), 1080, hours).toISOString()).toBe(ist('2026-10-08T18:00:00').toISOString());
  });
});

describe('SLA state', () => {
  const start = ist('2026-10-07T10:00:00');
  const due = ist('2026-10-07T14:00:00');
  it('reports due, at risk, breached, met and missed', () => {
    expect(slaState(start, due, null, ist('2026-10-07T11:00:00'))).toBe('due');
    expect(slaState(start, due, null, ist('2026-10-07T13:30:00'))).toBe('at_risk');
    expect(slaState(start, due, null, ist('2026-10-07T14:01:00'))).toBe('breached');
    expect(slaState(start, due, ist('2026-10-07T13:00:00'), ist('2026-10-08T00:00:00'))).toBe('met');
    expect(slaState(start, due, ist('2026-10-07T15:00:00'), ist('2026-10-08T00:00:00'))).toBe('missed');
    expect(slaState(start, null, null, start)).toBeNull();
  });
});

describe('triage', () => {
  it('classifies from the words used', () => {
    expect(triage('Pump not working', 'Production line stopped since morning')).toMatchObject({ category: 'breakdown', priority: 'urgent' });
    expect(triage('Installation of new chiller', 'Please schedule')).toMatchObject({ category: 'installation', priority: 'medium' });
    expect(triage('Warranty replacement', 'Motor burnt within 6 months, need replacement')).toMatchObject({ category: 'warranty' });
    expect(triage('Price list', 'Send me the latest price list')).toMatchObject({ category: 'query', priority: 'low' });
  });
});
