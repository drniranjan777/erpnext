/**
 * Freight rules, pure for unit tests: choosing the contract rate for a lane and vehicle, the freight
 * it gives, and the distance covered by a trail of GPS positions.
 */

export interface Rate {
  id: string;
  fromCity: string | null;
  fromState: string | null;
  toCity: string | null;
  toState: string | null;
  vehicleType: string | null;
  basis: 'per_kg' | 'per_trip' | 'per_km';
  rate: number;
  minCharge: number | null;
  perStop: number | null;
}

export interface Lane {
  fromCity: string | null;
  fromState: string | null;
  toCity: string | null;
  toState: string | null;
  vehicleType: string | null;
}

const same = (a: string | null, b: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** The most specific rate that fits: a city beats a state beats "any"; a named vehicle type beats "any". */
export function matchRate(rates: Rate[], lane: Lane): Rate | null {
  let best: { r: Rate; score: number } | null = null;
  for (const r of rates) {
    if (r.fromCity && !same(r.fromCity, lane.fromCity)) continue;
    if (r.fromState && !same(r.fromState, lane.fromState)) continue;
    if (r.toCity && !same(r.toCity, lane.toCity)) continue;
    if (r.toState && !same(r.toState, lane.toState)) continue;
    if (r.vehicleType && !same(r.vehicleType, lane.vehicleType)) continue;
    const score = (r.fromCity ? 4 : r.fromState ? 2 : 0) + (r.toCity ? 4 : r.toState ? 2 : 0) + (r.vehicleType ? 1 : 0);
    if (!best || score > best.score) best = { r, score };
  }
  return best?.r ?? null;
}

/** Freight for a trip on a rate: by weight, per trip or per km, plus extra drops, at least the minimum. */
export function freight(r: Rate, trip: { weightKg: number; km: number | null; stops: number }): { amount: number; basis: string } {
  let base: number;
  let basis: string;
  if (r.basis === 'per_kg') {
    base = r.rate * trip.weightKg;
    basis = `${trip.weightKg} kg × ₹${r.rate}`;
  } else if (r.basis === 'per_km') {
    if (!trip.km) throw new Error('This rate is per km: give the planned distance');
    base = r.rate * trip.km;
    basis = `${trip.km} km × ₹${r.rate}`;
  } else {
    base = r.rate;
    basis = `₹${r.rate} per trip`;
  }
  const extra = r.perStop && trip.stops > 1 ? r.perStop * (trip.stops - 1) : 0;
  if (extra) basis += ` + ${trip.stops - 1} extra drop(s) × ₹${r.perStop}`;
  let amount = base + extra;
  if (r.minCharge && amount < r.minCharge) {
    amount = r.minCharge;
    basis += ` (minimum ₹${r.minCharge})`;
  }
  return { amount: Math.round(amount * 100) / 100, basis };
}

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance along a trail of positions, ignoring jumps faster than 150 km/h (GPS noise). */
export function trailKm(points: { lat: number; lng: number; at: Date | string }[]) {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1], points[i]);
    const hours = (new Date(points[i].at).getTime() - new Date(points[i - 1].at).getTime()) / 3_600_000;
    if (hours > 0 && d / hours > 150) continue;
    km += d;
  }
  return Math.round(km * 10) / 10;
}
