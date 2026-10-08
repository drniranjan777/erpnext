import { hazardCompatible } from '../wms/putaway';

/**
 * Chemical HSE rules: GHS hazard statements with their pictograms and signal words, SDS section
 * completeness, petroleum classes, hazardous storage limits and incompatibilities, and permit-to-work
 * checks (checklists, gas tests, validity, simultaneous operations).
 */

// ---- GHS ----------------------------------------------------------------------------------------

export const PICTOGRAMS: Record<string, string> = {
  GHS01: 'Exploding bomb',
  GHS02: 'Flame',
  GHS03: 'Flame over circle',
  GHS04: 'Gas cylinder',
  GHS05: 'Corrosion',
  GHS06: 'Skull and crossbones',
  GHS07: 'Exclamation mark',
  GHS08: 'Health hazard',
  GHS09: 'Environment',
};

type Signal = 'Danger' | 'Warning' | null;

/** Common H statements: text, pictogram and signal word (GHS Rev. 10, Annex 1 and 3). */
export const H_STATEMENTS: Record<string, [string, string | null, Signal]> = {
  H200: ['Unstable explosive', 'GHS01', 'Danger'],
  H201: ['Explosive; mass explosion hazard', 'GHS01', 'Danger'],
  H220: ['Extremely flammable gas', 'GHS02', 'Danger'],
  H222: ['Extremely flammable aerosol', 'GHS02', 'Danger'],
  H224: ['Extremely flammable liquid and vapour', 'GHS02', 'Danger'],
  H225: ['Highly flammable liquid and vapour', 'GHS02', 'Danger'],
  H226: ['Flammable liquid and vapour', 'GHS02', 'Warning'],
  H227: ['Combustible liquid', null, 'Warning'],
  H228: ['Flammable solid', 'GHS02', 'Danger'],
  H242: ['Heating may cause a fire', 'GHS02', 'Danger'],
  H250: ['Catches fire spontaneously if exposed to air', 'GHS02', 'Danger'],
  H260: ['In contact with water releases flammable gases which may ignite spontaneously', 'GHS02', 'Danger'],
  H270: ['May cause or intensify fire; oxidiser', 'GHS03', 'Danger'],
  H271: ['May cause fire or explosion; strong oxidiser', 'GHS03', 'Danger'],
  H272: ['May intensify fire; oxidiser', 'GHS03', 'Warning'],
  H280: ['Contains gas under pressure; may explode if heated', 'GHS04', 'Warning'],
  H281: ['Contains refrigerated gas; may cause cryogenic burns or injury', 'GHS04', 'Warning'],
  H290: ['May be corrosive to metals', 'GHS05', 'Warning'],
  H300: ['Fatal if swallowed', 'GHS06', 'Danger'],
  H301: ['Toxic if swallowed', 'GHS06', 'Danger'],
  H302: ['Harmful if swallowed', 'GHS07', 'Warning'],
  H304: ['May be fatal if swallowed and enters airways', 'GHS08', 'Danger'],
  H310: ['Fatal in contact with skin', 'GHS06', 'Danger'],
  H311: ['Toxic in contact with skin', 'GHS06', 'Danger'],
  H312: ['Harmful in contact with skin', 'GHS07', 'Warning'],
  H314: ['Causes severe skin burns and eye damage', 'GHS05', 'Danger'],
  H315: ['Causes skin irritation', 'GHS07', 'Warning'],
  H317: ['May cause an allergic skin reaction', 'GHS07', 'Warning'],
  H318: ['Causes serious eye damage', 'GHS05', 'Danger'],
  H319: ['Causes serious eye irritation', 'GHS07', 'Warning'],
  H330: ['Fatal if inhaled', 'GHS06', 'Danger'],
  H331: ['Toxic if inhaled', 'GHS06', 'Danger'],
  H332: ['Harmful if inhaled', 'GHS07', 'Warning'],
  H334: ['May cause allergy or asthma symptoms or breathing difficulties if inhaled', 'GHS08', 'Danger'],
  H335: ['May cause respiratory irritation', 'GHS07', 'Warning'],
  H336: ['May cause drowsiness or dizziness', 'GHS07', 'Warning'],
  H340: ['May cause genetic defects', 'GHS08', 'Danger'],
  H341: ['Suspected of causing genetic defects', 'GHS08', 'Warning'],
  H350: ['May cause cancer', 'GHS08', 'Danger'],
  H351: ['Suspected of causing cancer', 'GHS08', 'Warning'],
  H360: ['May damage fertility or the unborn child', 'GHS08', 'Danger'],
  H361: ['Suspected of damaging fertility or the unborn child', 'GHS08', 'Warning'],
  H370: ['Causes damage to organs', 'GHS08', 'Danger'],
  H371: ['May cause damage to organs', 'GHS08', 'Warning'],
  H372: ['Causes damage to organs through prolonged or repeated exposure', 'GHS08', 'Danger'],
  H373: ['May cause damage to organs through prolonged or repeated exposure', 'GHS08', 'Warning'],
  H400: ['Very toxic to aquatic life', 'GHS09', 'Warning'],
  H410: ['Very toxic to aquatic life with long lasting effects', 'GHS09', 'Warning'],
  H411: ['Toxic to aquatic life with long lasting effects', 'GHS09', null],
  H412: ['Harmful to aquatic life with long lasting effects', null, null],
};

export const P_STATEMENTS: Record<string, string> = {
  P101: 'If medical advice is needed, have product container or label at hand.',
  P102: 'Keep out of reach of children.',
  P201: 'Obtain special instructions before use.',
  P210: 'Keep away from heat, hot surfaces, sparks, open flames and other ignition sources. No smoking.',
  P233: 'Keep container tightly closed.',
  P240: 'Ground and bond container and receiving equipment.',
  P260: 'Do not breathe dust / fume / gas / mist / vapours / spray.',
  P261: 'Avoid breathing dust / fume / gas / mist / vapours / spray.',
  P264: 'Wash hands thoroughly after handling.',
  P270: 'Do not eat, drink or smoke when using this product.',
  P271: 'Use only outdoors or in a well-ventilated area.',
  P273: 'Avoid release to the environment.',
  P280: 'Wear protective gloves / protective clothing / eye protection / face protection.',
  P301: 'IF SWALLOWED:',
  P303: 'IF ON SKIN (or hair):',
  P304: 'IF INHALED:',
  P305: 'IF IN EYES:',
  P310: 'Immediately call a POISON CENTER / doctor.',
  P331: 'Do NOT induce vomiting.',
  P338: 'Remove contact lenses, if present and easy to do. Continue rinsing.',
  P351: 'Rinse cautiously with water for several minutes.',
  P370: 'In case of fire:',
  P378: 'Use appropriate media to extinguish.',
  P391: 'Collect spillage.',
  P403: 'Store in a well-ventilated place.',
  P405: 'Store locked up.',
  P501: 'Dispose of contents / container in accordance with local regulations.',
};

/**
 * Pictograms and signal word from the H statements, with the GHS precedence rules: the skull and
 * crossbones replaces the exclamation mark; corrosion replaces it for skin and eye irritation; the
 * health hazard for respiratory sensitisation replaces it for skin sensitisation and irritation.
 * "Danger" wins over "Warning".
 */
export function classify(hCodes: string[]) {
  const known = hCodes.filter((h) => H_STATEMENTS[h]);
  const pictos = new Set(known.map((h) => H_STATEMENTS[h][1]).filter((p): p is string => !!p));
  const signals = known.map((h) => H_STATEMENTS[h][2]);
  if (pictos.has('GHS07')) {
    const only = (codes: string[]) => known.filter((h) => H_STATEMENTS[h][1] === 'GHS07').every((h) => codes.includes(h));
    if (pictos.has('GHS06')) pictos.delete('GHS07');
    else if (pictos.has('GHS05') && only(['H315', 'H319'])) pictos.delete('GHS07');
    else if (known.includes('H334') && only(['H315', 'H317', 'H319'])) pictos.delete('GHS07');
  }
  const signalWord: Signal = signals.includes('Danger') ? 'Danger' : signals.includes('Warning') ? 'Warning' : null;
  return { pictograms: [...pictos].sort(), signalWord, unknown: hCodes.filter((h) => !H_STATEMENTS[h]) };
}

export const SDS_SECTIONS = [
  'Identification',
  'Hazard identification',
  'Composition / information on ingredients',
  'First-aid measures',
  'Fire-fighting measures',
  'Accidental release measures',
  'Handling and storage',
  'Exposure controls / personal protection',
  'Physical and chemical properties',
  'Stability and reactivity',
  'Toxicological information',
  'Ecological information',
  'Disposal considerations',
  'Transport information',
  'Regulatory information',
  'Other information',
] as const;

/** What stops an SDS from being issued. */
export function sdsProblems(s: { sections: Record<string, string>; ghs: { hazardStatements: string[]; pictograms: string[]; signalWord: string | null }; hazardClass: string | null; unNumber: string | null }) {
  const out: string[] = [];
  const missing = SDS_SECTIONS.map((_, i) => i + 1).filter((n) => !(s.sections[String(n)] ?? '').trim());
  if (missing.length) out.push(`sections ${missing.join(', ')} are empty`);
  if (s.ghs.hazardStatements.length && !s.ghs.signalWord && s.ghs.pictograms.length) out.push('a signal word is needed with these pictograms');
  if (s.hazardClass && !/^UN\d{4}$/.test(s.unNumber ?? '')) out.push('dangerous goods need a UN number (UN followed by 4 digits)');
  return out;
}

/** Petroleum Rules, 2002: class A below 23 °C flash point, B 23–65 °C, C 65–93 °C. */
export function petroleumClass(flashPointC: number | null) {
  if (flashPointC === null || flashPointC === undefined) return null;
  if (flashPointC < 23) return 'A';
  if (flashPointC < 65) return 'B';
  if (flashPointC < 93) return 'C';
  return null;
}

// ---- storage ------------------------------------------------------------------------------------

export type StockRow = {
  warehouseId: string;
  warehouse: string;
  itemId: string;
  item: string;
  hazardClass: string | null;
  petroleumClass: string | null;
  kg: number;
};

/**
 * Hazardous stock against the limits of each location, and incompatible classes stored together.
 * A limit set for a main class (3) counts every division of it (no divisions for class 3; 5 counts
 * 5.1 and 5.2); petroleum limits count the petroleum class from the SDS.
 */
export function storageCheck(stock: StockRow[], limits: { warehouseId: string; hazardClass: string; maxKg: number; licence?: string | null }[]) {
  const counts = (cls: string, r: StockRow) => (cls.startsWith('petroleum_') ? r.petroleumClass === cls.slice(10).toUpperCase() : r.hazardClass !== null && (r.hazardClass === cls || r.hazardClass.split('.')[0] === cls));
  const usage = limits.map((l) => {
    const rows = stock.filter((r) => r.warehouseId === l.warehouseId && counts(l.hazardClass, r));
    const kg = Math.round(rows.reduce((a, r) => a + r.kg, 0) * 1000) / 1000;
    return { ...l, kg, pct: l.maxKg > 0 ? Math.round((kg * 1000) / l.maxKg) / 10 : null, breach: kg > l.maxKg, items: rows.map((r) => ({ item: r.item, kg: r.kg })) };
  });
  const clashes: { warehouseId: string; warehouse: string; a: string; b: string }[] = [];
  const byWh = new Map<string, StockRow[]>();
  for (const r of stock) if (r.hazardClass && r.kg > 0) byWh.set(r.warehouseId, [...(byWh.get(r.warehouseId) ?? []), r]);
  for (const [wh, rows] of byWh)
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++)
        if (!hazardCompatible(rows[i].hazardClass, rows[j].hazardClass)) clashes.push({ warehouseId: wh, warehouse: rows[i].warehouse, a: `${rows[i].item} (class ${rows[i].hazardClass})`, b: `${rows[j].item} (class ${rows[j].hazardClass})` });
  return { usage, clashes };
}

// ---- permits to work ----------------------------------------------------------------------------

export const PERMIT_TYPES = ['hot_work', 'cold_work', 'confined_space', 'height', 'electrical', 'excavation', 'line_break'] as const;
export type PermitType = (typeof PERMIT_TYPES)[number];

const COMMON = ['Area inspected and hazards explained to the crew', 'Equipment drained, depressurised and isolated', 'Fire extinguisher and first-aid kit at the site', 'PPE checked (helmet, shoes, gloves, goggles)'];
const SPECIFIC: Record<PermitType, string[]> = {
  hot_work: ['Combustibles removed within 11 m or covered', 'Gas test done: no flammable gas', 'Fire watch posted during and 30 minutes after the work', 'Drains and sewers within 15 m covered'],
  cold_work: [],
  confined_space: ['Gas test done: oxygen, flammables, toxics', 'Ventilation running', 'Attendant posted at the entry', 'Rescue equipment and tripod ready', 'Entrants listed at the entry'],
  height: ['Full-body harness with double lanyard', 'Anchor point checked', 'Scaffold tagged as inspected', 'Area below barricaded'],
  electrical: ['Circuit isolated, locked and tagged', 'Absence of voltage tested', 'Earthing applied', 'Insulated tools and rated gloves'],
  excavation: ['Underground services located and marked', 'Shoring or sloping for depth over 1.5 m', 'Edges barricaded', 'Spoil kept 1 m from the edge'],
  line_break: ['Line drained, flushed and depressurised', 'Blinds or spades fitted and listed', 'Chemical-resistant PPE', 'Spill tray and absorbent ready'],
};

export function checklistFor(type: PermitType) {
  return [...COMMON, ...SPECIFIC[type]].map((label, i) => ({ key: `c${i + 1}`, label, done: false }));
}

/** Gas test limits: oxygen 19.5–23.5 %, flammables 0 % LEL for hot work and below 10 % otherwise, H2S below 10 ppm, CO below 25 ppm. */
export function gasTestOk(t: { o2Pct: number; lelPct: number; h2sPpm: number; coPpm: number }, type: PermitType) {
  const out: string[] = [];
  if (t.o2Pct < 19.5 || t.o2Pct > 23.5) out.push(`oxygen ${t.o2Pct} % is outside 19.5–23.5 %`);
  if (type === 'hot_work' ? t.lelPct > 0 : t.lelPct >= 10) out.push(`flammables ${t.lelPct} % LEL ${type === 'hot_work' ? 'must be 0 for hot work' : 'must be below 10 %'}`);
  if (t.h2sPpm >= 10) out.push(`H2S ${t.h2sPpm} ppm must be below 10`);
  if (t.coPpm >= 25) out.push(`CO ${t.coPpm} ppm must be below 25`);
  return out;
}

export const NEEDS_GAS_TEST: PermitType[] = ['hot_work', 'confined_space'];
/** Hours a permit may run: one shift for hot work and confined space. */
export const MAX_HOURS: Record<PermitType, number> = { hot_work: 8, confined_space: 8, cold_work: 12, height: 12, electrical: 12, excavation: 12, line_break: 12 };

/** Work that must not run together at the same location. */
const CONFLICTS: [PermitType, PermitType][] = [
  ['hot_work', 'line_break'],
  ['hot_work', 'confined_space'],
  ['hot_work', 'excavation'],
  ['electrical', 'excavation'],
];

export function conflicts(p: { type: PermitType; location: string; validFrom: Date; validTo: Date }, others: { number: string; type: string; location: string; validFrom: Date; validTo: Date }[]) {
  const loc = p.location.trim().toLowerCase();
  return others
    .filter((o) => o.location.trim().toLowerCase() === loc && o.validFrom < p.validTo && p.validFrom < o.validTo)
    .filter((o) => CONFLICTS.some(([a, b]) => (a === p.type && b === o.type) || (b === p.type && a === o.type)) || (o.type === 'hot_work' && p.type === 'hot_work'))
    .map((o) => `${o.number} (${o.type.replace('_', ' ')}) at the same place and time`);
}

/** What stops a permit from being approved or activated. */
export function permitProblems(p: { type: PermitType; validFrom: Date; validTo: Date; checklist: { label: string; done: boolean }[]; gasTests: { o2Pct: number; lelPct: number; h2sPpm: number; coPpm: number; at: string }[] }, stage: 'approve' | 'activate', now = new Date()) {
  const out: string[] = [];
  const hours = (p.validTo.getTime() - p.validFrom.getTime()) / 3600_000;
  if (hours <= 0) out.push('the permit ends before it starts');
  if (hours > MAX_HOURS[p.type]) out.push(`a ${p.type.replace('_', ' ')} permit may run at most ${MAX_HOURS[p.type]} hours`);
  const open = p.checklist.filter((c) => !c.done);
  if (open.length) out.push(`${open.length} checklist item(s) not confirmed`);
  if (stage === 'activate') {
    if (now < p.validFrom || now > p.validTo) out.push('the permit is not valid now');
    if (NEEDS_GAS_TEST.includes(p.type)) {
      const last = [...p.gasTests].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      if (!last) out.push('a gas test is needed');
      else if (now.getTime() - new Date(last.at).getTime() > 2 * 3600_000) out.push('the last gas test is more than 2 hours old');
      else out.push(...gasTestOk(last, p.type));
    }
  }
  return out;
}
