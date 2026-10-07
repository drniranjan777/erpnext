/**
 * Inventory-control rules, pure for unit tests: ABC classes by issue value, tank volume from a dip,
 * moisture-sensitive floor life (J-STD-033) and pick-face replenishment.
 */

/** A: items making up the first 80 % of issue value; B: up to 95 %; C: the rest (and items never issued). */
export function abcClasses(rows: { itemId: string; value: number }[], cutA = 0.8, cutB = 0.95): Map<string, 'A' | 'B' | 'C'> {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, r) => s + r.value, 0);
  const out = new Map<string, 'A' | 'B' | 'C'>();
  let before = 0;
  for (const r of sorted) {
    // An item is A when the running total before it is still under the A cut, so the top item is always A.
    out.set(r.itemId, before < cutA * total ? 'A' : before < cutB * total ? 'B' : 'C');
    before += r.value;
  }
  for (const r of rows) if (!out.has(r.itemId)) out.set(r.itemId, 'C');
  return out;
}

/** Litres for a dip reading, interpolating linearly between calibration points. */
export function tankLitres(chart: { mm: number; litres: number }[], mm: number): number {
  const pts = [...chart].sort((a, b) => a.mm - b.mm);
  if (!pts.length) throw new Error('The tank has no calibration chart');
  if (mm < pts[0].mm || mm > pts[pts.length - 1].mm) throw new Error(`The dip must be between ${pts[0].mm} and ${pts[pts.length - 1].mm} mm`);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (mm <= b.mm) return Math.round((a.litres + ((b.litres - a.litres) * (mm - a.mm)) / (b.mm - a.mm || 1)) * 100) / 100;
  }
  return pts[pts.length - 1].litres;
}

/** Floor life out of dry pack at ≤30 °C / 60 % RH, in hours (Infinity for level 1, 0 for level 6: bake before use). */
export const MSL_HOURS: Record<string, number> = { '1': Infinity, '2': 365 * 24, '2a': 4 * 7 * 24, '3': 168, '4': 72, '5': 48, '5a': 24, '6': 0 };

export function floorLife(level: string | null, exposedMinutes: number, openedAt: Date | string | null, now: Date) {
  const hours = level ? (MSL_HOURS[level] ?? null) : null;
  const running = openedAt ? Math.max(0, Math.floor((now.getTime() - new Date(openedAt).getTime()) / 60_000)) : 0;
  const used = exposedMinutes + running;
  if (hours === null) return { usedMinutes: used, remainingMinutes: null, expired: false };
  if (hours === Infinity) return { usedMinutes: used, remainingMinutes: null, expired: false };
  const remaining = hours * 60 - used;
  return { usedMinutes: used, remainingMinutes: Math.max(0, remaining), expired: remaining <= 0 };
}

/** How much to bring to a pick face: up to max once it (with what is on the way) drops below min. */
export function replenishQty(onHand: number, onTheWay: number, min: number, max: number) {
  const level = onHand + onTheWay;
  return level < min ? Math.max(0, max - level) : 0;
}
