/**
 * Outbound rules, kept pure for unit tests: GS1 check digits and SSCC numbers, and the allocation
 * of a quantity to pick across bins (FEFO with a minimum remaining shelf life).
 */

/** GS1 mod-10 check digit for the digits given (weights 3,1,3,… from the right). */
export function gs1CheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[digits.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** 18-digit SSCC: extension digit + GS1 company prefix + serial reference + check digit. */
export function sscc(extension: number, companyPrefix: string, serial: number): string {
  if (!/^\d{7,10}$/.test(companyPrefix)) throw new Error('The GS1 company prefix must be 7 to 10 digits');
  const width = 16 - companyPrefix.length;
  const ref = String(serial);
  if (ref.length > width) throw new Error('SSCC serial numbers for this prefix are used up');
  const body = `${extension % 10}${companyPrefix}${ref.padStart(width, '0')}`;
  return `${body}${gs1CheckDigit(body)}`;
}

export function validSscc(code: string) {
  return /^\d{18}$/.test(code) && gs1CheckDigit(code.slice(0, 17)) === Number(code[17]);
}

/** Strips an (00) application identifier from a scanned GS1-128 SSCC. */
export function normaliseSscc(scan: string) {
  const d = scan.replace(/[^\d]/g, '');
  return d.length === 20 && d.startsWith('00') ? d.slice(2) : d;
}

export interface BinStockRow {
  binId: string;
  code: string;
  batchId: string | null;
  expiryDate: string | null;
  qty: number;
  pickSequence: number;
  zoneKind: string;
  blocked: boolean;
  /** Lot in quarantine, under test or rejected. */
  held: boolean;
}

export interface Pick {
  binId: string;
  code: string;
  batchId: string | null;
  qty: number;
}

const DAY = 86_400_000;

/**
 * Picks for a quantity: first-expiry-first-out, then walking order. Bins in receiving, dispatch
 * or quarantine, blocked bins, lots on QC hold, and lots that are expired or would leave with less
 * than the minimum shelf life are skipped. `why` explains any shortfall.
 */
export function allocate(need: number, stock: BinStockRow[], opts: { today: string; minShelfLifeDays?: number | null; reserved?: Map<string, number> }) {
  const skipped = { blocked: 0, held: 0, expired: 0, shelfLife: 0 };
  const key = (s: BinStockRow) => `${s.binId}|${s.batchId ?? ''}`;
  const usable = stock.filter((s) => {
    if (!['storage', 'staging'].includes(s.zoneKind)) return false;
    const free = s.qty - (opts.reserved?.get(key(s)) ?? 0);
    if (free <= 0) return false;
    if (s.blocked) return (skipped.blocked += free), false;
    if (s.held) return (skipped.held += free), false;
    if (s.expiryDate) {
      const days = (Date.parse(s.expiryDate) - Date.parse(opts.today)) / DAY;
      if (days < 0) return (skipped.expired += free), false;
      if (opts.minShelfLifeDays && days < opts.minShelfLifeDays) return (skipped.shelfLife += free), false;
    }
    return true;
  });
  usable.sort((a, b) => (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') || a.pickSequence - b.pickSequence || a.code.localeCompare(b.code));
  const picks: Pick[] = [];
  let left = need;
  for (const s of usable) {
    if (left <= 0) break;
    const free = s.qty - (opts.reserved?.get(key(s)) ?? 0);
    const q = Math.min(left, free);
    picks.push({ binId: s.binId, code: s.code, batchId: s.batchId, qty: q });
    opts.reserved?.set(key(s), (opts.reserved.get(key(s)) ?? 0) + q);
    left = Math.round((left - q) * 10_000) / 10_000;
  }
  const reasons = [
    skipped.shelfLife && `${skipped.shelfLife} below the minimum shelf life`,
    skipped.expired && `${skipped.expired} expired`,
    skipped.held && `${skipped.held} on QC hold`,
    skipped.blocked && `${skipped.blocked} in blocked bins`,
  ].filter(Boolean);
  return { picks, short: left, why: left > 0 ? (reasons.length ? `not enough pickable stock (${reasons.join(', ')})` : 'not enough stock in storage bins') : '' };
}
