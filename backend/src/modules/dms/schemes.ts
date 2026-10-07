/**
 * Trade schemes: quantity slabs (a discount per unit or a % off once a quantity is reached), value
 * slabs (a % off the order once its value is reached) and free goods (buy N, get M free). Pure, so
 * the same rules price a secondary sale and compute a distributor's claim.
 */

export interface Slab {
  /** Quantity (qty slabs, free goods) or value in ₹ (value slabs) from which the slab applies. */
  min: number;
  discountPct?: number;
  /** ₹ off each unit (qty slabs). */
  perUnit?: number;
  /** Free goods: for every `min` units bought, this many free. */
  freeQty?: number;
}

export interface Scheme {
  id: string;
  code: string;
  name: string;
  kind: 'qty_slab' | 'value_slab' | 'free_goods';
  /** Empty = every item. */
  itemIds: string[];
  slabs: Slab[];
}

export interface SaleLine {
  itemId: string;
  qty: number;
  rate: number;
}

export interface Applied {
  schemeId: string;
  code: string;
  itemId: string | null;
  discount: number;
  freeQty: number;
  basis: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The highest slab reached. */
export function slabFor(slabs: Slab[], amount: number) {
  return [...slabs].sort((a, b) => b.min - a.min).find((s) => amount >= s.min) ?? null;
}

/**
 * Applies every scheme to the lines. Quantity and free-goods schemes work per item; a value slab
 * works on the value of all its items together, after the per-item discounts.
 */
export function applySchemes(lines: SaleLine[], schemes: Scheme[]): { applied: Applied[]; discount: number; gross: number; net: number } {
  const applied: Applied[] = [];
  const gross = r2(lines.reduce((s, l) => s + l.qty * l.rate, 0));
  const discountByItem = new Map<string, number>();
  const covers = (s: Scheme, itemId: string) => !s.itemIds.length || s.itemIds.includes(itemId);
  // Same item on several lines counts together.
  const byItem = new Map<string, { qty: number; value: number }>();
  for (const l of lines) {
    const cur = byItem.get(l.itemId) ?? { qty: 0, value: 0 };
    byItem.set(l.itemId, { qty: cur.qty + l.qty, value: cur.value + l.qty * l.rate });
  }
  for (const s of schemes.filter((x) => x.kind !== 'value_slab')) {
    for (const [itemId, t] of byItem) {
      if (!covers(s, itemId)) continue;
      const slab = slabFor(s.slabs, t.qty);
      if (!slab) continue;
      if (s.kind === 'free_goods') {
        const free = Math.floor(t.qty / slab.min) * (slab.freeQty ?? 0);
        if (free > 0) applied.push({ schemeId: s.id, code: s.code, itemId, discount: 0, freeQty: free, basis: `${t.qty} bought: ${free} free` });
        continue;
      }
      const discount = r2((slab.perUnit ?? 0) * t.qty + ((slab.discountPct ?? 0) * t.value) / 100);
      if (discount > 0) {
        applied.push({ schemeId: s.id, code: s.code, itemId, discount, freeQty: 0, basis: `${t.qty} units: ${slab.perUnit ? `₹${slab.perUnit} a unit` : `${slab.discountPct} %`}` });
        discountByItem.set(itemId, (discountByItem.get(itemId) ?? 0) + discount);
      }
    }
  }
  for (const s of schemes.filter((x) => x.kind === 'value_slab')) {
    let value = 0;
    for (const [itemId, t] of byItem) if (covers(s, itemId)) value += t.value - (discountByItem.get(itemId) ?? 0);
    const slab = slabFor(s.slabs, value);
    if (!slab?.discountPct) continue;
    const discount = r2((value * slab.discountPct) / 100);
    if (discount > 0) applied.push({ schemeId: s.id, code: s.code, itemId: null, discount, freeQty: 0, basis: `₹${r2(value)} order: ${slab.discountPct} %` });
  }
  const discount = r2(applied.reduce((s, a) => s + a.discount, 0));
  return { applied, discount, gross, net: r2(gross - discount) };
}

/** Distance in metres between two points (for visit check-in). */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}
