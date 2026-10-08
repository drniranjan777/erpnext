import { Decimal } from '../../common/decimal';

const D = Decimal.from;
const ZERO = D('0');

export interface AssetBasis {
  cost: string;
  residualValue: string;
  method: 'slm' | 'wdv';
  usefulLifeYears: string;
  capitalisedOn: string;
  accumulated: string;
  depreciatedUntil: string | null;
  disposedOn?: string | null;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** WDV rate that brings cost down to the residual value over the useful life (Schedule II). */
export function wdvRate(cost: string, residual: string, lifeYears: string) {
  const c = Number(cost);
  // Schedule II assumes at least 5% residual; a zero residual would make the rate 100%.
  const r = Math.max(Number(residual), c * 0.05);
  return 1 - Math.pow(r / c, 1 / Number(lifeYears));
}

/**
 * Companies Act depreciation for a period, day-based (365-day year):
 * SLM = (cost − residual) / life; WDV = written-down value × rate. Never below residual value.
 */
export function bookDepreciation(a: AssetBasis, to: string): { from: string; to: string; days: number; amount: string } | null {
  const start = a.depreciatedUntil ? addDays(a.depreciatedUntil, 1) : a.capitalisedOn;
  const end = a.disposedOn && a.disposedOn < to ? a.disposedOn : to;
  if (start > end) return null;
  const days = daysBetween(start, end);
  const cost = D(a.cost);
  const acc = D(a.accumulated);
  const room = cost.sub(D(a.residualValue)).sub(acc);
  if (room.cmp(ZERO) <= 0) return null;
  let amount =
    a.method === 'slm'
      ? cost.sub(D(a.residualValue)).div(D(a.usefulLifeYears)).mul(D(String(days))).div(D('365'))
      : cost.sub(acc).mul(D(wdvRate(a.cost, a.residualValue, a.usefulLifeYears).toFixed(6))).mul(D(String(days))).div(D('365'));
  if (amount.cmp(room) > 0) amount = room;
  return { from: start, to: end, days, amount: amount.toFixed(2) };
}

export interface BlockAsset {
  cost: string;
  capitalisedOn: string;
  disposedOn: string | null;
  disposalAmount: string;
}

/**
 * Income-tax depreciation of one block (s.32): WDV at the block rate; half the rate on assets
 * put to use for less than 180 days in the year of addition; sale proceeds reduce the block.
 * Returns the schedule of every year up to the requested financial year (start year).
 */
export function itBlockSchedule(assets: BlockAsset[], ratePct: string, upToFyStart: number) {
  const rate = D(ratePct).div(D('100'));
  const fyOf = (d: string) => {
    const [y, m] = d.split('-').map(Number);
    return m >= 4 ? y : y - 1;
  };
  const first = assets.length ? Math.min(...assets.map((a) => fyOf(a.capitalisedOn))) : upToFyStart;
  const out: { fy: string; opening: string; additionsFull: string; additionsHalf: string; deletions: string; depreciation: string; closing: string }[] = [];
  let wdv = ZERO;
  for (let fy = first; fy <= upToFyStart; fy++) {
    const fyEnd = `${fy + 1}-03-31`;
    const adds = assets.filter((a) => fyOf(a.capitalisedOn) === fy);
    const full = adds.filter((a) => daysBetween(a.capitalisedOn, fyEnd) >= 180).reduce((s, a) => s.add(D(a.cost)), ZERO);
    const half = adds.filter((a) => daysBetween(a.capitalisedOn, fyEnd) < 180).reduce((s, a) => s.add(D(a.cost)), ZERO);
    const sales = assets.filter((a) => a.disposedOn && fyOf(a.disposedOn) === fy).reduce((s, a) => s.add(D(a.disposalAmount)), ZERO);
    // Sales come off the full-rate part first, then the half-rate additions.
    let fullBase = wdv.add(full).sub(sales);
    let halfBase = half;
    if (fullBase.isNegative()) {
      halfBase = halfBase.add(fullBase);
      fullBase = ZERO;
      if (halfBase.isNegative()) halfBase = ZERO;
    }
    const dep = fullBase.mul(rate).add(halfBase.mul(rate).div(D('2'))).round(0);
    const opening = wdv;
    wdv = fullBase.add(halfBase).sub(dep);
    out.push({ fy: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`, opening: opening.toFixed(2), additionsFull: full.toFixed(2), additionsHalf: half.toFixed(2), deletions: sales.toFixed(2), depreciation: dep.toFixed(2), closing: wdv.toFixed(2) });
  }
  return out;
}
