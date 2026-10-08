import type { HaccpHazard, Nutrition, RecallTrace } from '@nextgen/database';

/**
 * Food safety rules, kept pure: hazard significance and the Codex CCP decision tree, critical
 * limits, allergen roll-up and changeovers, nutrition per serving with %RDA, the allergen
 * statement, and flattening a lot trace for a recall.
 */

/** The 14 major allergens (EU 1169/2011), which include the FSSAI list. */
export const ALLERGENS: Record<string, string> = {
  gluten: 'Cereals containing gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soy: 'Soybeans',
  milk: 'Milk',
  nuts: 'Tree nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
};

/** A hazard is significant when severity × likelihood is 4 or more (on 1–3 scales), or it is severe and not unlikely. */
export function significant(h: Pick<HaccpHazard, 'severity' | 'likelihood'>) {
  return h.severity * h.likelihood >= 4 || (h.severity === 3 && h.likelihood >= 2);
}

/** Codex Alimentarius decision tree for one significant hazard at one step. */
export function codexDecision(h: Pick<HaccpHazard, 'q1' | 'q2' | 'q3' | 'q4'>): { ccp: boolean | null; reason: string } {
  if (h.q1 == null) return { ccp: null, reason: 'Answer Q1: do control measures exist for the hazard?' };
  if (!h.q1) return { ccp: false, reason: 'No control measure at this step: modify the step, process or product if control is needed for safety' };
  if (h.q2 == null) return { ccp: null, reason: 'Answer Q2: is the step designed to eliminate or reduce the hazard to an acceptable level?' };
  if (h.q2) return { ccp: true, reason: 'The step is designed to eliminate or reduce the hazard (Q2 yes)' };
  if (h.q3 == null) return { ccp: null, reason: 'Answer Q3: could contamination occur or increase to unacceptable levels?' };
  if (!h.q3) return { ccp: false, reason: 'Contamination cannot reach unacceptable levels (Q3 no)' };
  if (h.q4 == null) return { ccp: null, reason: 'Answer Q4: will a later step eliminate or reduce the hazard?' };
  return h.q4 ? { ccp: false, reason: 'A later step controls the hazard (Q4 yes)' } : { ccp: true, reason: 'No later step controls the hazard (Q4 no)' };
}

export const withinLimits = (v: number, min?: number | null, max?: number | null) => (min == null || v >= min) && (max == null || v <= max);

// ---- allergens ----------------------------------------------------------------------------------

/**
 * Allergens of an item including everything in its bill of materials (recursively): "contains"
 * is the union; "may contain" is the union of cross-contact warnings, less what it contains.
 */
export function rollUp(itemId: string, own: Map<string, { contains: string[]; mayContain: string[] }>, children: Map<string, string[]>, seen = new Set<string>()): { contains: string[]; mayContain: string[] } {
  if (seen.has(itemId)) return { contains: [], mayContain: [] };
  const next = new Set([...seen, itemId]);
  const c = new Set(own.get(itemId)?.contains ?? []);
  const m = new Set(own.get(itemId)?.mayContain ?? []);
  for (const ch of children.get(itemId) ?? []) {
    const r = rollUp(ch, own, children, next);
    r.contains.forEach((a) => c.add(a));
    r.mayContain.forEach((a) => m.add(a));
  }
  c.forEach((a) => m.delete(a));
  const order = Object.keys(ALLERGENS);
  return { contains: [...c].sort((a, b) => order.indexOf(a) - order.indexOf(b)), mayContain: [...m].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}

/** Changing a line from one product to another: allergens to remove, so a validated allergen clean is needed. */
export function changeover(prev: string[], next: string[]) {
  const remove = prev.filter((a) => !next.includes(a));
  return { cleanRequired: remove.length > 0, allergensToRemove: remove };
}

export function allergenStatement(contains: string[], mayContain: string[]) {
  const name = (a: string) => ALLERGENS[a]?.replace('Cereals containing gluten', 'Gluten') ?? a;
  return [contains.length ? `Contains: ${contains.map(name).join(', ')}.` : '', mayContain.length ? `May contain: ${mayContain.map(name).join(', ')}.` : ''].filter(Boolean).join(' ');
}

// ---- labels -------------------------------------------------------------------------------------

/** Reference daily values for %RDA on labels (FSS Labelling and Display Regulations, 2020). */
const RDA = { energyKcal: 2000, totalFat: 67, saturatedFat: 22, transFat: 2, addedSugars: 50, sodiumMg: 2000 } as const;

export function nutritionPanel(n: Nutrition, servingSizeG: number | null) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const rows = (Object.keys(n) as (keyof Nutrition)[])
    .filter((k) => n[k] !== null && n[k] !== undefined)
    .map((k) => {
      const per100 = n[k] as number;
      const perServe = servingSizeG ? (per100 * servingSizeG) / 100 : null;
      const rda = (RDA as Record<string, number>)[k];
      return { nutrient: k, per100: r1(per100), perServe: perServe === null ? null : r1(perServe), rdaPct: perServe !== null && rda ? r1((perServe / rda) * 100) : null };
    });
  return rows;
}

// ---- recall trace -------------------------------------------------------------------------------

interface Node {
  item: { code: string; name: string };
  batchNo: string | null;
  links: { docType: string; number: string | null; qty: string; party: string | null; lots?: Node[] }[];
  onHand?: { warehouse: string; qty: string }[];
}

const DISPATCH = new Set(['delivery_note', 'sales_invoice', 'delivery', 'job_work_challan', 'stock_transfer_out']);

/** Who received the lot (and the products made from it), where it still is, and what it was made from. */
export function flattenTrace(forward: Node, backward: Node | null): RecallTrace {
  const customers = new Map<string, { party: string; documents: Set<string>; qty: number }>();
  const usedIn: { item: string; batchNo: string | null }[] = [];
  const onHand: { warehouse: string; qty: number }[] = [];
  let dispatched = 0;
  const walk = (n: Node, root: boolean) => {
    for (const h of n.onHand ?? []) onHand.push({ warehouse: root ? h.warehouse : `${h.warehouse} (${n.item.code} ${n.batchNo ?? ''})`.trim(), qty: Number(h.qty) });
    for (const l of n.links) {
      if (l.party && DISPATCH.has(l.docType)) {
        const c = customers.get(l.party) ?? { party: l.party, documents: new Set<string>(), qty: 0 };
        if (l.number) c.documents.add(l.number);
        c.qty += Number(l.qty);
        if (root) dispatched += Number(l.qty);
        customers.set(l.party, c);
      }
      for (const lot of l.lots ?? []) {
        usedIn.push({ item: `${lot.item.code} · ${lot.item.name}`, batchNo: lot.batchNo });
        walk(lot, false);
      }
    }
  };
  walk(forward, true);
  const lotsMadeFrom = backward ? backward.links.flatMap((l) => (l.lots ?? []).map((x) => ({ item: `${x.item.code} · ${x.item.name}`, batchNo: x.batchNo }))) : [];
  return {
    customers: [...customers.values()].map((c) => ({ party: c.party, documents: [...c.documents], qty: Math.round(c.qty * 1000) / 1000 })),
    lotsMadeFrom,
    usedIn,
    onHand,
    dispatchedQty: Math.round(dispatched * 1000) / 1000,
  };
}

/** How long the trace took and how much of what left was brought back. */
export function recallMetrics(r: { startedAt: Date; traceCompletedAt: Date | null; trace: RecallTrace | null; recovered: { qty: number }[] }) {
  const minutes = r.traceCompletedAt ? Math.round((r.traceCompletedAt.getTime() - r.startedAt.getTime()) / 60_000) : null;
  const recovered = r.recovered.reduce((n, x) => n + x.qty, 0);
  const out = r.trace?.dispatchedQty ?? 0;
  return { traceMinutes: minutes, recoveredQty: Math.round(recovered * 1000) / 1000, recoveredPct: out ? Math.round((recovered / out) * 1000) / 10 : null };
}
