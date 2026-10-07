/**
 * Put-away rules: which bin a received quantity should go to. Pure, so it can be unit tested.
 *
 * Order of preference: the item's fixed bin; a bin already holding the same batch, then the same
 * item; then an empty bin, nearest the dock for A and unclassified items, farthest for C items.
 * A bin qualifies only if its zone has the item's storage condition (quarantine for lots on QC
 * hold), it is not another item's fixed bin, every hazardous item in it is compatible, and it has
 * room by weight, volume and quantity.
 */

export interface PutawayItem {
  itemId: string;
  batchKey: string;
  qty: number;
  condition: string;
  hazardClass: string | null;
  unitWeightKg: number | null;
  unitVolumeM3: number | null;
  abcClass: string | null;
  /** Lot in quarantine / under test. */
  held: boolean;
}

export interface BinContent {
  itemId: string;
  batchKey: string;
  qty: number;
  hazardClass: string | null;
  unitWeightKg: number | null;
  unitVolumeM3: number | null;
}

export interface CandidateBin {
  id: string;
  code: string;
  zoneKind: string;
  condition: string;
  pickSequence: number;
  fixedItemId: string | null;
  maxWeightKg: number | null;
  maxVolumeM3: number | null;
  maxQty: number | null;
  contents: BinContent[];
}

export interface Placement {
  binId: string;
  code: string;
  qty: number;
  reason: string;
}

const MAIN = (c: string | null) => (c ? c.trim().split('.')[0] : null);

/**
 * Simplified segregation of UN hazard classes (based on the IMDG / OISD segregation tables):
 * explosives apart from everything; oxidisers and organic peroxides apart from flammables;
 * water-reactive solids apart from corrosives; toxic gases apart from flammables and oxidisers.
 */
const APART: [string, string][] = [
  ['2.1', '5.1'],
  ['2.1', '5.2'],
  ['2.3', '2.1'],
  ['2.3', '5.1'],
  ['3', '5.1'],
  ['3', '5.2'],
  ['4.1', '5.1'],
  ['4.2', '5.1'],
  ['4.3', '5.1'],
  ['4.3', '8'],
  ['4.2', '8'],
  ['5.1', '8'],
  ['5.2', '8'],
];

export function hazardCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const x = a.trim();
  const y = b.trim();
  if (x === y) return true;
  if (MAIN(x) === '1' || MAIN(y) === '1') return false;
  const match = (p: string, q: string) => p === q || (!q.includes('.') && MAIN(p) === q);
  return !APART.some(([p, q]) => (match(x, p) && match(y, q)) || (match(x, q) && match(y, p)));
}

/** The storage condition a zone must have for this item. */
export function requiredCondition(it: Pick<PutawayItem, 'condition' | 'hazardClass'>) {
  if (it.condition && it.condition !== 'ambient') return it.condition;
  return it.hazardClass ? 'hazardous' : 'ambient';
}

/** How much more of the item fits in the bin (Infinity when the bin has no limits set). */
export function room(bin: CandidateBin, it: PutawayItem): number {
  let free = Infinity;
  if (bin.maxQty !== null) {
    if (bin.contents.some((c) => c.itemId !== it.itemId && c.qty > 0)) return 0;
    free = Math.min(free, bin.maxQty - bin.contents.filter((c) => c.itemId === it.itemId).reduce((s, c) => s + c.qty, 0));
  }
  if (bin.maxWeightKg !== null && it.unitWeightKg) {
    const used = bin.contents.reduce((s, c) => s + c.qty * (c.unitWeightKg ?? 0), 0);
    free = Math.min(free, (bin.maxWeightKg - used) / it.unitWeightKg);
  }
  if (bin.maxVolumeM3 !== null && it.unitVolumeM3) {
    const used = bin.contents.reduce((s, c) => s + c.qty * (c.unitVolumeM3 ?? 0), 0);
    free = Math.min(free, (bin.maxVolumeM3 - used) / it.unitVolumeM3);
  }
  return Math.max(0, Math.floor(free * 10_000) / 10_000);
}

/** Why the bin cannot take the item at all, or null. */
export function unsuitable(bin: CandidateBin, it: PutawayItem, quarantineExists: boolean): string | null {
  if (it.held && quarantineExists) {
    if (bin.zoneKind !== 'quarantine') return 'lot on QC hold goes to quarantine';
  } else if (bin.zoneKind !== 'storage') return `${bin.zoneKind} bin`;
  const need = requiredCondition(it);
  if (!(it.held && quarantineExists) && bin.condition !== need) return `needs ${need} storage, bin is ${bin.condition}`;
  if (bin.fixedItemId && bin.fixedItemId !== it.itemId) return 'fixed bin of another item';
  const clash = bin.contents.find((c) => c.qty > 0 && !hazardCompatible(it.hazardClass, c.hazardClass));
  if (clash) return `class ${it.hazardClass} cannot be stored with class ${clash.hazardClass}`;
  return null;
}

/** Splits the quantity over the best bins. Whatever does not fit is returned as `unplaced`. */
export function suggestPutaway(it: PutawayItem, bins: CandidateBin[]): { placements: Placement[]; unplaced: number } {
  const quarantineExists = bins.some((b) => b.zoneKind === 'quarantine');
  const eligible = bins.filter((b) => !unsuitable(b, it, quarantineExists));
  const holds = (b: CandidateBin, sameBatch: boolean) => b.contents.some((c) => c.itemId === it.itemId && c.qty > 0 && (!sameBatch || c.batchKey === it.batchKey));
  const empty = (b: CandidateBin) => !b.contents.some((c) => c.qty > 0);
  const far = it.abcClass === 'C';
  const rank = (b: CandidateBin): [number, number, string] => {
    if (b.fixedItemId === it.itemId) return [0, b.pickSequence, 'fixed bin of the item'];
    if (holds(b, true)) return [1, b.pickSequence, 'already holds this batch'];
    if (holds(b, false)) return [2, b.pickSequence, 'already holds this item'];
    if (empty(b)) return [3, far ? -b.pickSequence : b.pickSequence, it.held && quarantineExists ? 'quarantine bin' : far ? 'empty bin away from the dock (slow mover)' : 'nearest empty bin'];
    return [4, b.pickSequence, 'shared bin with room'];
  };
  const ordered = eligible.map((b) => ({ b, r: rank(b) })).sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.b.code.localeCompare(y.b.code));
  let left = it.qty;
  const placements: Placement[] = [];
  for (const { b, r } of ordered) {
    if (left <= 0) break;
    const fits = room(b, it);
    if (fits <= 0) continue;
    const q = Math.min(left, fits);
    placements.push({ binId: b.id, code: b.code, qty: q, reason: r[2] });
    left = Math.round((left - q) * 10_000) / 10_000;
  }
  return { placements, unplaced: left };
}
