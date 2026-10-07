import { describe, expect, it } from 'vitest';
import { phoneKey, readLeadRow, scoreLead, stateCodeOf } from '../../src/modules/crm/scoring';

const base = { email: null, phone: null, company: null, source: 'other', requirement: null, estimatedValue: null, activities: 0, status: 'new' };

describe('lead scoring', () => {
  it('rewards a complete, valuable referral', () => {
    const r = scoreLead({ ...base, source: 'referral', phone: '9876543210', email: 'purchase@deccansteels.in', company: 'Deccan Steels', estimatedValue: 1_500_000, requirement: '5000 corrugated boxes a month, 5-ply, printed in two colours', activities: 2 });
    // 20 + 10 + 15 + 10 + 25 + 10 + 10
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.reasons[0]).toBe('+20 referral enquiry');
  });
  it('scores a thin portal lead low and penalises unqualified', () => {
    const r = scoreLead({ ...base, source: 'indiamart', phone: '9876543210', email: 'ravi@gmail.com' });
    expect(r).toMatchObject({ score: 20, grade: 'C' });
    expect(r.reasons).toContain('+5 personal email');
    expect(scoreLead({ ...base, source: 'web', status: 'unqualified' }).score).toBe(0);
  });
});

describe('lead import', () => {
  it('reads IndiaMART export rows and plain rows', () => {
    expect(readLeadRow({ sender_name: 'Kiran', sender_mobile: '+91-9876543210', sender_email: 'KIRAN@ACME.IN', sender_company: 'Acme', sender_city: 'Pune', sender_state: 'Maharashtra', query_product_name: 'Corrugated box', query_message: 'Need 2000', unique_query_id: '123456' })).toEqual({
      name: 'Kiran', company: 'Acme', email: 'kiran@acme.in', phone: '+91-9876543210', city: 'Pune', state: 'Maharashtra', product: 'Corrugated box', requirement: 'Need 2000', sourceRef: '123456',
    });
    expect(readLeadRow({ name: '', phone: '', email: '' })).toBeNull();
    expect(readLeadRow({ phone: '9876500000' })?.name).toBe('9876500000');
  });
  it('normalises phones and state names', () => {
    expect(phoneKey('+91 98765-43210')).toBe('9876543210');
    expect(phoneKey('12345')).toBeNull();
    expect(stateCodeOf('Telangana')).toBe('36');
    expect(stateCodeOf('Jammu & Kashmir')).toBe('01');
    expect(stateCodeOf('27')).toBe('27');
    expect(stateCodeOf('Atlantis')).toBeNull();
  });
});
