import { describe, expect, it } from 'vitest';
import { leadInsight, leadNextAction, opportunityNextAction, type OpportunityFacts } from '../../src/modules/crm/insight';
import { suggestReply } from '../../src/modules/service/reply';

const now = new Date('2026-10-07T06:30:00Z'); // 12:00 IST
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

const lead = { email: 'kiran@deccanfoods.in', phone: '9876543210', company: 'Deccan Foods', source: 'referral', requirement: '5000 printed 5-ply boxes a month for spice packs', estimatedValue: 1_200_000, activities: 0, status: 'new', createdAt: hoursAgo(2) };

describe('lead insight', () => {
  it('explains a hot lead and asks for first contact', () => {
    const i = leadInsight(lead, [], now);
    expect(i.grade).toBe('A');
    expect(i.summary).toMatch(/^Hot lead \(\d+\/100\): value ₹10 lakh or more and referral enquiry/);
    expect(i.missing).toEqual(['+10 once qualified']);
    expect(i.nextAction).toMatchObject({ action: 'call', urgency: 'now', by: '2026-10-07' });
  });

  it('lists what would raise a thin lead', () => {
    const i = leadInsight({ ...lead, email: null, company: null, estimatedValue: null, requirement: 'boxes', source: 'indiamart', phone: null }, [], now);
    expect(i.grade).toBe('C');
    expect(i.missing).toEqual(['+10 with a phone number', '+15 with a business email', '+10 with the company name', 'up to +25 with an estimated value', '+10 with a clear requirement', '+10 once qualified']);
    expect(i.nextAction.action).toBe('email');
  });

  it('chases overdue activities first, then qualification, then idleness', () => {
    expect(leadNextAction(lead, [{ kind: 'meeting', dueAt: hoursAgo(3), doneAt: null }], now)).toMatchObject({ action: 'meeting', urgency: 'now' });
    expect(leadNextAction({ ...lead, status: 'contacted' }, [{ kind: 'call', dueAt: null, doneAt: daysAgo(1) }], now).action).toBe('qualify');
    expect(leadNextAction({ ...lead, status: 'qualified' }, [{ kind: 'call', dueAt: null, doneAt: daysAgo(9) }], now)).toMatchObject({ action: 'call', why: 'No interaction for 9 days.' });
    expect(leadNextAction({ ...lead, status: 'unqualified' }, [], now).action).toBe('none');
  });
});

describe('opportunity next action', () => {
  const o: OpportunityFacts = { status: 'open', stage: 'Proposal', stageProbability: 50, amount: '500000', closeDate: '2026-11-15', quotationId: null, quotationStatus: null, competitor: null };
  it('asks for a quotation once the stage warrants one', () => {
    expect(opportunityNextAction(o, [{ kind: 'call', dueAt: null, doneAt: daysAgo(1) }], now)).toMatchObject({ action: 'quote', label: 'Send a quotation' });
  });
  it('flags a past close date', () => {
    expect(opportunityNextAction({ ...o, closeDate: '2026-10-01' }, [], now)).toMatchObject({ action: 'update', urgency: 'now' });
  });
  it('follows up a quiet deal, naming the competitor', () => {
    const r = opportunityNextAction({ ...o, quotationId: 'q', quotationStatus: 'approved', competitor: 'Pack Co' }, [{ kind: 'call', dueAt: null, doneAt: daysAgo(10) }], now);
    expect(r).toMatchObject({ action: 'call', label: 'Follow up on the quotation' });
    expect(r.why).toContain('Pack Co');
  });
  it('asks for the order near closing at a late stage', () => {
    const r = opportunityNextAction({ ...o, stage: 'Negotiation', stageProbability: 80, closeDate: '2026-10-14', quotationId: 'q', quotationStatus: 'approved' }, [{ kind: 'call', dueAt: null, doneAt: daysAgo(2) }], now);
    expect(r).toMatchObject({ action: 'close', by: '2026-10-14' });
  });
});

describe('suggested reply', () => {
  it('uses the category, coverage and the first article', () => {
    const r = suggestReply(
      { number: 'TKT000004', contactName: 'Suresh', subject: 'Chiller stopped', category: 'breakdown', priority: 'urgent', serialNo: 'CH-1001', underWarranty: true, contract: null, resolutionDue: '2026-10-07T10:30:00Z', companyName: 'Acme Cooling', agentName: 'Priya' },
      [{ title: 'Chiller not cooling', body: 'Before a visit:\n1. Check the relay.\n2. Clean the condenser.' }],
      () => '7 Oct, 4:00 pm',
    );
    expect(r).toContain('Dear Suresh,');
    expect(r).toContain('logged your request as TKT000004 for serial number CH-1001');
    expect(r).toContain('under warranty');
    expect(r).toContain('1. Check the relay.');
    expect(r).toContain('resolve it by 7 Oct, 4:00 pm');
    expect(r.trim().endsWith('Priya\nAcme Cooling')).toBe(true);
  });
});
