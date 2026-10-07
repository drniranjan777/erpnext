import { randomInt } from 'node:crypto';
import { gs1CheckDigit } from '../wms/outbound';

/**
 * Pharma rules, kept pure: shelf-life estimation from stability data (ICH Q1E), GS1 serialisation
 * strings, DPCO ceiling-price checks and the content of the QR code on API labels.
 */

// ---- stability ----------------------------------------------------------------------------------

/** One-sided 95 % Student t quantiles. */
const T95: Record<number, number> = { 1: 6.314, 2: 2.92, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895, 8: 1.86, 9: 1.833, 10: 1.812, 11: 1.796, 12: 1.782, 13: 1.771, 14: 1.761, 15: 1.753, 16: 1.746, 17: 1.74, 18: 1.734, 19: 1.729, 20: 1.725, 25: 1.708, 30: 1.697 };
export function t95(df: number): number {
  if (df <= 0) return Infinity;
  if (T95[df]) return T95[df];
  if (df > 30) return 1.645 + (1.697 - 1.645) * (30 / df);
  const lower = Math.max(...Object.keys(T95).map(Number).filter((k) => k < df));
  return T95[lower];
}

export interface Fit {
  n: number;
  slope: number;
  intercept: number;
  /** Residual standard deviation. */
  s: number;
  xMean: number;
  sxx: number;
}

export function linearFit(points: { x: number; y: number }[]): Fit | null {
  const n = points.length;
  if (n < 3) return null;
  const xMean = points.reduce((a, p) => a + p.x, 0) / n;
  const yMean = points.reduce((a, p) => a + p.y, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.x - xMean) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((a, p) => a + (p.x - xMean) * (p.y - yMean), 0) / sxx;
  const intercept = yMean - slope * xMean;
  const sse = points.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0);
  return { n, slope, intercept, s: Math.sqrt(sse / (n - 2)), xMean, sxx };
}

/**
 * Shelf life (months) supported by the data for one attribute: the time at which the one-sided
 * 95 % confidence bound of the mean regression line reaches the specification (lower bound
 * against a minimum, upper bound against a maximum). Extrapolation is limited as ICH Q1E allows
 * at most: twice the longest time point, and no more than 12 months beyond it.
 */
export function shelfLife(points: { x: number; y: number }[], min: number | null, max: number | null): { months: number; limitedBy: 'data' | 'extrapolation'; fit: Fit } | null {
  const fit = linearFit(points);
  if (!fit || (min === null && max === null)) return null;
  const longest = Math.max(...points.map((p) => p.x));
  const cap = Math.min(2 * longest, longest + 12);
  const q = t95(fit.n - 2);
  const half = (t: number) => q * fit.s * Math.sqrt(1 / fit.n + (t - fit.xMean) ** 2 / fit.sxx);
  for (let t = 0; t <= cap + 1e-9; t = Math.round((t + 0.1) * 10) / 10) {
    const mean = fit.intercept + fit.slope * t;
    if ((min !== null && mean - half(t) < min) || (max !== null && mean + half(t) > max)) return { months: Math.max(0, Math.floor(t - 0.1)), limitedBy: 'data', fit };
  }
  return { months: Math.floor(cap), limitedBy: 'extrapolation', fit };
}

/** Pull date of a time point: start date plus whole months (end-of-month safe). */
export function pullDate(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const whole = Math.floor(months);
  const target = new Date(Date.UTC(y, m - 1 + whole, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  if (months !== whole) target.setUTCDate(target.getUTCDate() + Math.round((months - whole) * 30));
  return target.toISOString().slice(0, 10);
}

// ---- serialisation ------------------------------------------------------------------------------

export function validGtin(gtin: string): boolean {
  return /^\d{14}$/.test(gtin) && gs1CheckDigit(gtin.slice(0, 13)) === Number(gtin[13]);
}

/** A GTIN-14 from a GTIN-8/12/13 or 14 (left-padded with zeros). */
export function toGtin14(code: string): string | null {
  const g = code.trim().padStart(14, '0');
  return validGtin(g) ? g : null;
}

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Random (non-sequential) serial numbers, as regulators expect, 12 characters. */
export function randomSerial(length = 12): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

const yymmdd = (d: string) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);

/** Human-readable GS1 element string: (01) GTIN (17) expiry (10) batch (21) serial. */
export function gs1Hri(u: { gtin: string; serial: string; batchNo: string; expiryDate: string }) {
  return `(01)${u.gtin}(17)${yymmdd(u.expiryDate)}(10)${u.batchNo}(21)${u.serial}`;
}

/** The data carried in the GS1 DataMatrix: fixed-length fields first, group separators after variable ones. */
export function gs1DataMatrix(u: { gtin: string; serial: string; batchNo: string; expiryDate: string }) {
  return `01${u.gtin}17${yymmdd(u.expiryDate)}10${u.batchNo}\u001d21${u.serial}`;
}

// ---- DPCO ---------------------------------------------------------------------------------------

export interface Ceiling {
  itemId: string;
  ceilingPrice: number;
  effectiveFrom: string;
  notification: string | null;
}

/** The ceiling in force on a date (the latest notified on or before it). */
export function ceilingOn(ceilings: Ceiling[], itemId: string, date: string): Ceiling | null {
  return ceilings.filter((c) => c.itemId === itemId && c.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

/** Sales above the ceiling price: invoice lines and item MRPs. */
export function dpcoBreaches(
  ceilings: Ceiling[],
  lines: { invoice: string; date: string; itemId: string; item: string; unitPrice: number }[],
  mrps: { itemId: string; item: string; mrp: number | null }[],
  today: string,
) {
  const sales = lines
    .map((l) => ({ ...l, ceiling: ceilingOn(ceilings, l.itemId, l.date) }))
    .filter((l) => l.ceiling && l.unitPrice > l.ceiling.ceilingPrice + 0.005)
    .map((l) => ({ invoice: l.invoice, date: l.date, item: l.item, unitPrice: l.unitPrice, ceiling: l.ceiling!.ceilingPrice, excess: Math.round((l.unitPrice - l.ceiling!.ceilingPrice) * 100) / 100, notification: l.ceiling!.notification }));
  const mrp = mrps
    .map((m) => ({ ...m, ceiling: ceilingOn(ceilings, m.itemId, today) }))
    .filter((m) => m.ceiling && m.mrp !== null && m.mrp > m.ceiling.ceilingPrice + 0.005)
    .map((m) => ({ item: m.item, mrp: m.mrp!, ceiling: m.ceiling!.ceilingPrice, notification: m.ceiling!.notification }));
  return { sales, mrp };
}

// ---- API labels ---------------------------------------------------------------------------------

/**
 * Content of the QR code on active pharmaceutical ingredient labels (Drugs Rules, Schedule H2 /
 * the 2022 amendment): unique product identification code, API name, brand name, manufacturer's
 * name and address, batch number, batch size, manufacturing and expiry / retest dates, serial
 * shipping container code, manufacturing licence number, storage conditions, import licence.
 */
export function apiQrContent(f: {
  productCode: string;
  apiName: string;
  brandName?: string | null;
  manufacturer: string;
  address: string;
  batchNo: string;
  batchSize?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  retestDate?: string | null;
  sscc?: string | null;
  licenceNo?: string | null;
  storage?: string | null;
  importLicenceNo?: string | null;
}) {
  const rows: [string, string | null | undefined][] = [
    ['UPIC', f.productCode],
    ['API', f.apiName],
    ['Brand', f.brandName],
    ['Mfr', `${f.manufacturer}, ${f.address}`],
    ['Batch', f.batchNo],
    ['Batch size', f.batchSize],
    ['Mfg', f.mfgDate],
    ['Exp', f.expiryDate],
    ['Retest', f.retestDate],
    ['SSCC', f.sscc],
    ['Mfg Lic', f.licenceNo],
    ['Storage', f.storage],
    ['Import Lic', f.importLicenceNo],
  ];
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}
