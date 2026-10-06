/**
 * Single sampling plans for normal inspection (ISO 2859-1 / IS 2500-1, Tables I and II-A).
 *
 * The master table is diagonal: one code letter down is one AQL step left. Along a row, the
 * cell with Ac 0 is followed by an up arrow, a down arrow, then Ac 1, 2, 3, 5, 7, 10, 14, 21.
 */

export const AQLS = ['0.010', '0.015', '0.025', '0.040', '0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10', '15', '25'] as const;
export const LEVELS = ['S-1', 'S-2', 'S-3', 'S-4', 'I', 'II', 'III'] as const;
export type InspectionLevel = (typeof LEVELS)[number];

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R'] as const;
const SAMPLE = [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250, 2000];
const ACCEPT = [1, 2, 3, 5, 7, 10, 14, 21];

/** Upper lot-size bounds and the code letter per level (S-1 … S-4, I, II, III). */
const TABLE_I: [number, string][] = [
  [8, 'AAAAAAB'],
  [15, 'AAAAABC'],
  [25, 'AAABBCD'],
  [50, 'ABBCCDE'],
  [90, 'BBCCCEF'],
  [150, 'BBCDDFG'],
  [280, 'BCDEEGH'],
  [500, 'BCDEFHJ'],
  [1200, 'CCEFGJK'],
  [3200, 'CDEGHKL'],
  [10000, 'CDFGJLM'],
  [35000, 'CDFHKMN'],
  [150000, 'DEGJLNP'],
  [500000, 'DEGJMPQ'],
  [Infinity, 'DEHKNQR'],
];

export function codeLetter(lotSize: number, level: InspectionLevel = 'II') {
  const row = TABLE_I.find(([max]) => lotSize <= max)!;
  return row[1][LEVELS.indexOf(level)] as (typeof LETTERS)[number];
}

export interface SamplingPlan {
  letter: string;
  sampleSize: number;
  accept: number;
  reject: number;
  /** The whole lot is inspected (sample ≥ lot). */
  full: boolean;
}

/** Sample size and accept / reject numbers for a lot. */
export function samplingPlan(lotSize: number, aql: string, level: InspectionLevel = 'II'): SamplingPlan {
  const a = AQLS.indexOf(aql as (typeof AQLS)[number]);
  if (a < 0) throw new Error(`AQL ${aql} is not a standard value`);
  if (lotSize < 1) throw new Error('Lot size must be at least 1');
  let j = LETTERS.indexOf(codeLetter(lotSize, level));
  // Follow the arrows until a cell holds a plan.
  for (let guard = 0; guard < 40; guard++) {
    const d = a - (14 - j);
    if (d < 0 || d === 2) {
      if (j === LETTERS.length - 1) break;
      j++;
      continue;
    }
    if ((d === 1 || d - 3 >= ACCEPT.length) && j > 0) {
      j--;
      continue;
    }
    const accept = d <= 1 ? 0 : ACCEPT[Math.min(d - 3, ACCEPT.length - 1)];
    const n = SAMPLE[j];
    if (n >= lotSize) return { letter: LETTERS[j], sampleSize: lotSize, accept, reject: accept + 1, full: true };
    return { letter: LETTERS[j], sampleSize: n, accept, reject: accept + 1, full: false };
  }
  return { letter: 'R', sampleSize: Math.min(lotSize, 2000), accept: 0, reject: 1, full: lotSize <= 2000 };
}

export interface Reading {
  sampleNo: number;
  parameterId: string;
  value?: string | null;
  passed?: boolean | null;
}

export interface Parameter {
  id: string;
  kind: 'numeric' | 'attribute';
  lowerLimit: string | null;
  upperLimit: string | null;
  isCritical: boolean;
}

/** A numeric reading passes inside its limits; attribute readings carry pass / fail. */
export function readingPasses(p: Parameter, r: Reading) {
  if (p.kind === 'attribute') return r.passed !== false;
  if (r.value === null || r.value === undefined || r.value === '') return true;
  const v = Number(r.value);
  if (p.lowerLimit !== null && v < Number(p.lowerLimit)) return false;
  if (p.upperLimit !== null && v > Number(p.upperLimit)) return false;
  return true;
}

/**
 * Defective samples (any failed parameter) and what the plan says: accept at or below Ac,
 * reject at Re or above; any critical failure rejects the lot.
 */
export function evaluate(params: Parameter[], readings: Reading[], plan: { accept: number; reject: number }) {
  const failed = new Set<number>();
  let critical = false;
  for (const r of readings) {
    const p = params.find((x) => x.id === r.parameterId);
    if (!p || readingPasses(p, r)) continue;
    failed.add(r.sampleNo);
    if (p.isCritical) critical = true;
  }
  const defectives = failed.size;
  const suggestion: 'accept' | 'reject' = critical || defectives >= plan.reject ? 'reject' : 'accept';
  return { defectives, critical, suggestion, failedSamples: [...failed].sort((x, y) => x - y) };
}
