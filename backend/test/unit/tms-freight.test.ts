import { describe, expect, it } from 'vitest';
import { freight, haversineKm, matchRate, trailKm, type Rate } from '../../src/modules/tms/freight';

const rate = (id: string, p: Partial<Rate>): Rate => ({ id, fromCity: null, fromState: null, toCity: null, toState: null, vehicleType: null, basis: 'per_trip', rate: 1000, minCharge: null, perStop: null, ...p });

describe('rate matching', () => {
  const rates = [rate('any', {}), rate('state', { toState: '27' }), rate('city', { toCity: 'Pune' }), rate('city-truck', { toCity: 'pune', vehicleType: '17ft' })];
  it('takes the most specific lane that fits', () => {
    expect(matchRate(rates, { fromCity: 'Hyderabad', fromState: '36', toCity: 'Pune', toState: '27', vehicleType: '17ft' })?.id).toBe('city-truck');
    expect(matchRate(rates, { fromCity: 'Hyderabad', fromState: '36', toCity: 'Pune', toState: '27', vehicleType: '407' })?.id).toBe('city');
    expect(matchRate(rates, { fromCity: 'Hyderabad', fromState: '36', toCity: 'Nagpur', toState: '27', vehicleType: null })?.id).toBe('state');
    expect(matchRate(rates, { fromCity: 'Hyderabad', fromState: '36', toCity: 'Chennai', toState: '33', vehicleType: null })?.id).toBe('any');
    expect(matchRate([rate('x', { fromCity: 'Mumbai' })], { fromCity: 'Hyderabad', fromState: '36', toCity: null, toState: null, vehicleType: null })).toBeNull();
  });
});

describe('freight', () => {
  it('charges by weight, trip or km with extra drops and a minimum', () => {
    expect(freight(rate('k', { basis: 'per_kg', rate: 3.5, minCharge: 2500 }), { weightKg: 1200, km: null, stops: 1 }).amount).toBe(4200);
    expect(freight(rate('k', { basis: 'per_kg', rate: 3.5, minCharge: 2500 }), { weightKg: 400, km: null, stops: 1 })).toEqual({ amount: 2500, basis: '400 kg × ₹3.5 (minimum ₹2500)' });
    expect(freight(rate('t', { basis: 'per_trip', rate: 18000, perStop: 500 }), { weightKg: 0, km: null, stops: 3 }).amount).toBe(19000);
    expect(freight(rate('m', { basis: 'per_km', rate: 42 }), { weightKg: 0, km: 560, stops: 1 }).amount).toBe(23520);
    expect(() => freight(rate('m', { basis: 'per_km', rate: 42 }), { weightKg: 0, km: null, stops: 1 })).toThrow(/planned distance/);
  });
});

describe('tracking distance', () => {
  it('sums the trail and ignores impossible jumps', () => {
    const hyd = { lat: 17.385, lng: 78.4867 };
    const sec = { lat: 17.4399, lng: 78.4983 };
    expect(Math.round(haversineKm(hyd, sec) * 10) / 10).toBe(6.2);
    const t0 = '2026-10-07T08:00:00Z';
    expect(trailKm([{ ...hyd, at: t0 }, { ...sec, at: '2026-10-07T08:20:00Z' }, { lat: 28.6, lng: 77.2, at: '2026-10-07T08:21:00Z' }, { ...sec, at: '2026-10-07T08:40:00Z' }])).toBe(6.2);
  });
});
