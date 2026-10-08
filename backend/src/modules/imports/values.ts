import { GST_STATES } from '@nextgen/database';

/** Thrown by a parser; the importer reports it against the column. */
export class ValueError extends Error {}

const blank = (v: string | undefined): v is undefined | '' => v === undefined || v.trim() === '';

export function text(v: string | undefined, max?: number): string | null {
  if (blank(v)) return null;
  const t = v.trim().replace(/\s+/g, ' ');
  if (max && t.length > max) throw new ValueError(`Too long (max ${max} characters)`);
  return t;
}

const YES = new Set(['yes', 'y', 'true', '1', 'on', '✓', 'x']);
const NO = new Set(['no', 'n', 'false', '0', 'off', '-']);

export function yesNo(v: string | undefined, fallback = false): boolean {
  if (blank(v)) return fallback;
  const t = v.trim().toLowerCase();
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  throw new ValueError('Enter Yes or No');
}

/** "1,23,456.50", "₹ 120", "12.5%" → "123456.50" / "120" / "12.5". */
export function decimal(v: string | undefined, dp = 4, opts: { signed?: boolean } = {}): string | null {
  if (blank(v)) return null;
  let t = v.trim().replace(/[₹,\s%]/g, '').replace(/^rs\.?/i, '');
  // Accounting negatives: (125.00)
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new ValueError('Enter a number');
  if (t.startsWith('-') && !opts.signed) throw new ValueError('Cannot be negative');
  const [i, f = ''] = t.replace('-', '').split('.');
  if (f.length > dp) {
    // Round half-up to dp places (string math keeps it exact).
    const scaled = BigInt(i + f.slice(0, dp)) + (Number(f[dp]) >= 5 ? 1n : 0n);
    const s = scaled.toString().padStart(dp + 1, '0');
    return `${t.startsWith('-') ? '-' : ''}${s.slice(0, -dp)}.${s.slice(-dp)}`;
  }
  return t.replace(/^(-?)0+(?=\d)/, '$1');
}

export function integer(v: string | undefined, min = 0, max = 1_000_000): number | null {
  if (blank(v)) return null;
  const t = v.trim().replace(/,/g, '').replace(/\s*days?$/i, '');
  if (!/^\d+$/.test(t)) throw new ValueError('Enter a whole number');
  const n = Number(t);
  if (n < min || n > max) throw new ValueError(`Must be between ${min} and ${max}`);
  return n;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Dates as Indian users type them: 2026-04-01, 01-04-2026, 01/04/2026, 1-Apr-2026, 20260401 (Tally),
 * or an Excel serial number. Day comes before month (Indian convention).
 */
export function date(v: string | undefined): string | null {
  if (blank(v)) return null;
  const t = v.trim();
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = t.match(/^(\d{8})$/))) [y, m, d] = [Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8))];
  else if ((match = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = t.match(/^(\d{1,2})[-/ ]([a-z]{3})[a-z]*[-/ ,]+(\d{2,4})$/i))) [d, m, y] = [Number(match[1]), MONTHS[match[2].toLowerCase()] ?? 0, Number(match[3])];
  else if (/^\d{5}(\.\d+)?$/.test(t)) {
    const ms = Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  } else throw new ValueError('Enter a date like 31-03-2026');
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!m || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new ValueError('Not a valid date');
  return dt.toISOString().slice(0, 10);
}

const STATE_ALIASES: Record<string, string> = {
  'andaman & nicobar': '35',
  'andaman and nicobar islands': '35',
  orissa: '21',
  pondicherry: '34',
  'jammu & kashmir': '01',
  'dadra & nagar haveli': '26',
  'daman & diu': '26',
  'dadra and nagar haveli and daman and diu': '26',
  'the dadra and nagar haveli and daman and diu': '26',
  'delhi (nct)': '07',
  'new delhi': '07',
  uttaranchal: '05',
  chattisgarh: '22',
  tamilnadu: '33',
  'other territory': '97',
};

/** State code from "36", "Telangana", "TELANGANA". */
export function stateCode(v: string | undefined): string | null {
  if (blank(v)) return null;
  const t = v.trim();
  if (/^\d{1,2}$/.test(t)) {
    const code = t.padStart(2, '0');
    if (code in GST_STATES) return code;
    throw new ValueError('Unknown state code');
  }
  const lower = t.toLowerCase().replace(/\s+/g, ' ');
  const hit = Object.entries(GST_STATES).find(([, name]) => name.toLowerCase() === lower);
  if (hit) return hit[0];
  if (STATE_ALIASES[lower]) return STATE_ALIASES[lower];
  throw new ValueError('Unknown state. Use the state name or its 2-digit GST code');
}

/**
 * Common spellings of units (Tally symbols, Excel habits) → our default unit codes.
 * Unknown units are looked up by code as typed.
 */
const UNIT_ALIASES: Record<string, string> = {
  NO: 'NOS',
  NOS: 'NOS',
  NUMBERS: 'NOS',
  NUMBER: 'NOS',
  UNIT: 'NOS',
  UNITS: 'NOS',
  EA: 'NOS',
  EACH: 'NOS',
  PC: 'PCS',
  PCS: 'PCS',
  PIECE: 'PCS',
  PIECES: 'PCS',
  KG: 'KG',
  KGS: 'KG',
  KILOGRAM: 'KG',
  KILOGRAMS: 'KG',
  GM: 'G',
  GMS: 'G',
  GRAM: 'G',
  GRAMS: 'G',
  G: 'G',
  MT: 'MT',
  MTS: 'MT',
  TON: 'MT',
  TONS: 'MT',
  TONNE: 'MT',
  TONNES: 'MT',
  LTR: 'LTR',
  LTRS: 'LTR',
  LITRE: 'LTR',
  LITRES: 'LTR',
  LITER: 'LTR',
  L: 'LTR',
  ML: 'ML',
  MTR: 'MTR',
  MTRS: 'MTR',
  METRE: 'MTR',
  METRES: 'MTR',
  METER: 'MTR',
  M: 'MTR',
  CM: 'CM',
  CMS: 'CM',
  SQM: 'SQM',
  'SQ.M': 'SQM',
  SQMTR: 'SQM',
  SQFT: 'SQFT',
  'SQ.FT': 'SQFT',
  CBM: 'CBM',
  BOX: 'BOX',
  BOXES: 'BOX',
  CTN: 'CTN',
  CARTON: 'CTN',
  CARTONS: 'CTN',
  BAG: 'BAG',
  BAGS: 'BAG',
  DRUM: 'DRUM',
  DRUMS: 'DRUM',
  ROLL: 'ROLL',
  ROLLS: 'ROLL',
  SET: 'SET',
  SETS: 'SET',
  PAIR: 'PAIR',
  PAIRS: 'PAIR',
  PRS: 'PAIR',
  HR: 'HR',
  HRS: 'HR',
  HOUR: 'HR',
  HOURS: 'HR',
};

export function unitKey(v: string): string {
  const t = v.trim().toUpperCase().replace(/\s+/g, '');
  return UNIT_ALIASES[t] ?? UNIT_ALIASES[t.replace(/\.$/, '')] ?? t;
}

/** Turns free text into a master code: "Raw Materials - Steel" → "RAW-MATERIALS-STEEL". */
export function toCode(v: string, max: number) {
  return v
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}
