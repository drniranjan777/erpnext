/**
 * Pure helpers for 3PL billing, demand-driven pick-face levels and RFID: pallets for a quantity,
 * min / max from daily demand, and decoding GS1 SGTIN-96 EPCs.
 */
import { gs1CheckDigit } from './outbound';

export function pallets(qty: number, unitsPerPallet: number) {
  return qty > 0 ? Math.ceil(qty / Math.max(unitsPerPallet, 1e-9) - 1e-9) : 0;
}

/**
 * Pick-face levels from daily outbound quantities: min covers demand until the next top-up plus a
 * safety margin for busy days; max adds the days of cover wanted, capped by what the bin holds.
 */
export function faceLevels(daily: number[], opts: { leadDays?: number; coverDays?: number; capacity?: number | null } = {}) {
  const lead = opts.leadDays ?? 1;
  const cover = opts.coverDays ?? 3;
  const days = daily.length || 1;
  const avg = daily.reduce((s, v) => s + v, 0) / days;
  const peak = Math.max(0, ...daily);
  if (avg <= 0) return { avg: 0, peak, min: null, max: null };
  const min = Math.ceil(avg * lead + (peak - avg) * 0.5);
  let max = Math.ceil(min + avg * cover);
  if (opts.capacity && max > opts.capacity) max = Math.floor(opts.capacity);
  return { avg: Math.round(avg * 100) / 100, peak, min: Math.min(min, max - 1), max };
}

/** SGTIN-96 partition table: company prefix bits / digits, then item reference bits / digits. */
const PARTITIONS: [number, number, number, number][] = [
  [40, 12, 4, 1],
  [37, 11, 7, 2],
  [34, 10, 10, 3],
  [30, 9, 14, 4],
  [27, 8, 17, 5],
  [24, 7, 20, 6],
  [20, 6, 24, 7],
];

/** Decodes a GS1 SGTIN-96 EPC (24 hex digits, header 0x30) into its GTIN-14 and serial; null when it is something else. */
export function decodeSgtin96(hex: string): { gtin: string; serial: string; filter: number } | null {
  const h = hex.trim().toUpperCase();
  if (!/^[0-9A-F]{24}$/.test(h) || !h.startsWith('30')) return null;
  const v = BigInt(`0x${h}`);
  const bits = (from: number, len: number) => (v >> BigInt(96 - from - len)) & ((1n << BigInt(len)) - 1n);
  const filter = Number(bits(8, 3));
  const partition = Number(bits(11, 3));
  if (partition > 6) return null;
  const [cpBits, cpDigits, irBits, irDigits] = PARTITIONS[partition];
  const companyPrefix = bits(14, cpBits).toString().padStart(cpDigits, '0');
  const itemRef = bits(14 + cpBits, irBits).toString().padStart(irDigits, '0');
  const serial = bits(14 + cpBits + irBits, 38).toString();
  if (companyPrefix.length !== cpDigits || itemRef.length !== irDigits) return null;
  // GTIN-14: indicator digit (first of the item reference) + company prefix + rest of the item reference + check digit.
  const body = `${itemRef[0]}${companyPrefix}${itemRef.slice(1)}`;
  return { gtin: `${body}${gs1CheckDigit(body)}`, serial, filter };
}

/** GTIN-14 and the shorter forms a barcode master may hold (GTIN-13 / EAN-13, GTIN-12 / UPC). */
export function gtinForms(gtin14: string) {
  const out = new Set([gtin14]);
  let g = gtin14;
  while (g.startsWith('0') && g.length > 12) {
    g = g.slice(1);
    out.add(g);
  }
  return [...out];
}
