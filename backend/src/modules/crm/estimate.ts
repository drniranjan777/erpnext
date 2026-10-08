/**
 * Estimation engines for made-to-order products: corrugated boxes, sheet-metal fabrication and
 * panel furniture. Each returns its working (so the estimator can check it), the unit cost and
 * the unit price at the margin asked.
 */

export interface CostLine {
  label: string;
  basis: string;
  amount: number;
}
export interface Estimate {
  lines: CostLine[];
  unitCost: number;
  unitPrice: number;
  total: number;
  facts: Record<string, string | number>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

function finish(lines: CostLine[], qty: number, marginPct: number, facts: Record<string, string | number>): Estimate {
  if (marginPct >= 100) throw new Error('Margin must be below 100 %');
  const unitCost = r2(lines.reduce((s, l) => s + l.amount, 0));
  // Margin on selling price: price = cost ÷ (1 − margin).
  const unitPrice = r2(unitCost / (1 - marginPct / 100));
  return { lines: lines.map((l) => ({ ...l, amount: r2(l.amount) })), unitCost, unitPrice, total: r2(unitPrice * qty), facts };
}

// ---- Corrugated box (regular slotted container) -------------------------------------------------

/** Flute take-up: how much longer the fluting medium is than the board. */
export const FLUTES = { A: 1.5, B: 1.35, C: 1.45, E: 1.25, F: 1.2 } as const;
export type Flute = keyof typeof FLUTES;

export interface BoxInput {
  /** Inside dimensions, mm. */
  length: number;
  width: number;
  height: number;
  ply: 3 | 5 | 7;
  /** Liner papers (outer first) and fluting papers, GSM. A 3-ply has 2 liners and 1 flute; 5-ply 3 and 2; 7-ply 4 and 3. */
  linerGsm: number[];
  fluteGsm: number[];
  flutes: Flute[];
  /** ₹ a kg of paper, and conversion (corrugation, pasting, slotting) ₹ a kg of board. */
  paperRate: number;
  conversionRate: number;
  printColours: number;
  /** ₹ a box per colour. */
  printRatePerColour: number;
  wastagePct: number;
  marginPct: number;
  qty: number;
}

export function corrugatedBox(i: BoxInput): Estimate {
  const liners = i.ply === 3 ? 2 : i.ply === 5 ? 3 : 4;
  const media = liners - 1;
  if (i.linerGsm.length !== liners || i.fluteGsm.length !== media || i.flutes.length !== media) throw new Error(`A ${i.ply}-ply board needs ${liners} liners and ${media} flutes`);
  // RSC blank: length = 2 (L + W) + 35 mm glue flap; deckle = W + H (flaps meet in the middle), plus 6 mm trim.
  const blankL = 2 * (i.length + i.width) + 35;
  const blankW = i.width + i.height + 6;
  const areaM2 = (blankL / 1000) * (blankW / 1000);
  const boardGsm = i.linerGsm.reduce((s, g) => s + g, 0) + i.fluteGsm.reduce((s, g, k) => s + g * FLUTES[i.flutes[k]], 0);
  const weightKg = (areaM2 * boardGsm) / 1000;
  const grossKg = weightKg * (1 + i.wastagePct / 100);
  const lines: CostLine[] = [
    { label: 'Paper', basis: `${r4(grossKg)} kg × ₹${i.paperRate}`, amount: grossKg * i.paperRate },
    { label: 'Conversion', basis: `${r4(grossKg)} kg × ₹${i.conversionRate}`, amount: grossKg * i.conversionRate },
  ];
  if (i.printColours > 0) lines.push({ label: 'Printing', basis: `${i.printColours} colour(s) × ₹${i.printRatePerColour}`, amount: i.printColours * i.printRatePerColour });
  return finish(lines, i.qty, i.marginPct, { blank: `${blankL} × ${blankW} mm`, areaM2: r4(areaM2), boardGsm: Math.round(boardGsm), boxWeightKg: r4(weightKg) });
}

// ---- Sheet-metal / structural fabrication --------------------------------------------------------

const DENSITY = { ms: 7850, ss: 8000, al: 2700, gi: 7850 } as const;
export type Metal = keyof typeof DENSITY;

export interface FabPart {
  name: string;
  material: Metal;
  /** Plate: length × width × thickness in mm; or a given weight in kg (sections). */
  length?: number;
  width?: number;
  thickness?: number;
  weightKg?: number;
  count: number;
}
export interface FabInput {
  parts: FabPart[];
  /** ₹ a kg by material. */
  rates: Partial<Record<Metal, number>>;
  scrapPct: number;
  /** Cutting, bending, welding... minutes per unit at a ₹ hourly rate. */
  processes: { name: string; minutes: number; ratePerHour: number }[];
  /** Painting / powder coating ₹ a kg of finished weight. */
  finishPerKg: number;
  overheadPct: number;
  marginPct: number;
  qty: number;
}

export function fabrication(i: FabInput): Estimate {
  let net = 0;
  let material = 0;
  for (const p of i.parts) {
    const each = p.weightKg ?? ((p.length ?? 0) / 1000) * ((p.width ?? 0) / 1000) * ((p.thickness ?? 0) / 1000) * DENSITY[p.material];
    const w = each * p.count;
    const rate = i.rates[p.material];
    if (rate === undefined) throw new Error(`No rate for ${p.material.toUpperCase()}`);
    net += w;
    material += w * (1 + i.scrapPct / 100) * rate;
  }
  const lines: CostLine[] = [{ label: 'Material', basis: `${r4(net)} kg net + ${i.scrapPct} % scrap`, amount: material }];
  for (const p of i.processes) lines.push({ label: p.name, basis: `${p.minutes} min × ₹${p.ratePerHour}/h`, amount: (p.minutes / 60) * p.ratePerHour });
  if (i.finishPerKg) lines.push({ label: 'Finishing', basis: `${r4(net)} kg × ₹${i.finishPerKg}`, amount: net * i.finishPerKg });
  const direct = lines.reduce((s, l) => s + l.amount, 0);
  if (i.overheadPct) lines.push({ label: 'Overheads', basis: `${i.overheadPct} % of direct cost`, amount: (direct * i.overheadPct) / 100 });
  return finish(lines, i.qty, i.marginPct, { netWeightKg: r4(net) });
}

// ---- Panel furniture (cabinet / wardrobe carcass) ------------------------------------------------

export interface FurnitureInput {
  /** Outside size, mm. */
  width: number;
  height: number;
  depth: number;
  shelves: number;
  doors: number;
  /** Board (plywood / particle board) ₹ a m²; back panel ₹ a m². */
  boardRate: number;
  backRate: number;
  /** Laminate / veneer / PU on visible faces, ₹ a m². */
  finishRate: number;
  /** Edge banding ₹ a running metre. */
  edgeRate: number;
  /** Hinges, handles, channels: ₹ a unit. */
  hardware: number;
  labourHours: number;
  labourRate: number;
  wastagePct: number;
  marginPct: number;
  qty: number;
}

export function furniture(i: FurnitureInput): Estimate {
  const m = (mm: number) => mm / 1000;
  const sides = 2 * m(i.height) * m(i.depth);
  const topBottom = 2 * m(i.width) * m(i.depth);
  const shelves = i.shelves * m(i.width) * m(i.depth);
  const doors = i.doors ? m(i.width) * m(i.height) : 0;
  const board = (sides + topBottom + shelves + doors) * (1 + i.wastagePct / 100);
  const back = m(i.width) * m(i.height);
  // Visible faces: outside of the sides and top, and the door fronts (both faces of the doors).
  const finishArea = sides + m(i.width) * m(i.depth) + doors * 2;
  // Front edges of sides, top, bottom and shelves, and all four edges of each door.
  const edges = 2 * m(i.height) + (2 + i.shelves) * m(i.width) + (i.doors ? 2 * (m(i.width) + m(i.height)) : 0);
  const lines: CostLine[] = [
    { label: 'Board', basis: `${r4(board)} m² × ₹${i.boardRate}`, amount: board * i.boardRate },
    { label: 'Back panel', basis: `${r4(back)} m² × ₹${i.backRate}`, amount: back * i.backRate },
    { label: 'Finish', basis: `${r4(finishArea)} m² × ₹${i.finishRate}`, amount: finishArea * i.finishRate },
    { label: 'Edge banding', basis: `${r4(edges)} m × ₹${i.edgeRate}`, amount: edges * i.edgeRate },
    { label: 'Hardware', basis: 'fixed', amount: i.hardware },
    { label: 'Labour', basis: `${i.labourHours} h × ₹${i.labourRate}`, amount: i.labourHours * i.labourRate },
  ];
  return finish(lines, i.qty, i.marginPct, { boardM2: r4(board), finishM2: r4(finishArea), edgeM: r4(edges) });
}

// ---- Rules-based configurator --------------------------------------------------------------------

export interface OptionGroup {
  code: string;
  name: string;
  required: boolean;
  /** One choice (select) or several (multi). */
  multi: boolean;
  options: { code: string; label: string; priceDelta: number; excludes?: string[]; requires?: string[] }[];
}

/** Checks a choice of options against the rules and prices it. Codes are "GROUP.OPTION". */
export function configure(basePrice: number, groups: OptionGroup[], chosen: string[]) {
  const errors: string[] = [];
  const picked = new Set(chosen);
  const all = new Map<string, { g: OptionGroup; o: OptionGroup['options'][number] }>(groups.flatMap((g) => g.options.map((o) => [`${g.code}.${o.code}`, { g, o }] as [string, { g: OptionGroup; o: OptionGroup['options'][number] }])));
  for (const c of chosen) if (!all.has(c)) errors.push(`Unknown option ${c}`);
  for (const g of groups) {
    const n = chosen.filter((c) => c.startsWith(`${g.code}.`)).length;
    if (g.required && n === 0) errors.push(`Choose a ${g.name}`);
    if (!g.multi && n > 1) errors.push(`Only one ${g.name}`);
  }
  for (const c of chosen) {
    const hit = all.get(c);
    if (!hit) continue;
    for (const x of hit.o.excludes ?? []) if (picked.has(x)) errors.push(`${hit.o.label} cannot go with ${all.get(x)?.o.label ?? x}`);
    for (const r of hit.o.requires ?? []) if (!picked.has(r)) errors.push(`${hit.o.label} needs ${all.get(r)?.o.label ?? r}`);
  }
  const price = r2(basePrice + chosen.reduce((s, c) => s + (all.get(c)?.o.priceDelta ?? 0), 0));
  const description = chosen.map((c) => all.get(c)).filter(Boolean).map((h) => `${h!.g.name}: ${h!.o.label}`).join('; ');
  return { ok: errors.length === 0, errors: [...new Set(errors)], price, description };
}
