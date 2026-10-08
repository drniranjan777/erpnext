/**
 * Sustainability and materials compliance rules: default emission factors, the carbon footprint by
 * scope, BRSR-lite indicators, EPR progress, and RoHS / REACH / conflict-minerals roll-up through
 * bills of materials.
 */

export interface FactorDef {
  key: string;
  name: string;
  scope: 1 | 2 | 3;
  category: string;
  unit: string;
  kgCo2ePerUnit: number;
  /** Energy content, for BRSR energy totals. */
  gjPerUnit?: number;
  source: string;
}

/** Defaults copied into a workspace on first use; each can be edited to the site's own data. */
export const DEFAULT_FACTORS: FactorDef[] = [
  { key: 'diesel_l', name: 'Diesel (DG sets, boilers, vehicles)', scope: 1, category: 'stationary_combustion', unit: 'litre', kgCo2ePerUnit: 2.68, gjPerUnit: 0.0386, source: 'IPCC 2006, 74.1 t CO2/TJ' },
  { key: 'petrol_l', name: 'Petrol', scope: 1, category: 'mobile_combustion', unit: 'litre', kgCo2ePerUnit: 2.31, gjPerUnit: 0.0342, source: 'IPCC 2006, 69.3 t CO2/TJ' },
  { key: 'lpg_kg', name: 'LPG', scope: 1, category: 'stationary_combustion', unit: 'kg', kgCo2ePerUnit: 2.94, gjPerUnit: 0.0473, source: 'IPCC 2006, 63.1 t CO2/TJ' },
  { key: 'png_scm', name: 'Natural gas (PNG)', scope: 1, category: 'stationary_combustion', unit: 'scm', kgCo2ePerUnit: 2.02, gjPerUnit: 0.0383, source: 'IPCC 2006, 56.1 t CO2/TJ' },
  { key: 'coal_kg', name: 'Coal (Indian, sub-bituminous)', scope: 1, category: 'stationary_combustion', unit: 'kg', kgCo2ePerUnit: 1.82, gjPerUnit: 0.0189, source: 'IPCC 2006, 96.1 t CO2/TJ, NCV 18.9 GJ/t' },
  { key: 'furnace_oil_kg', name: 'Furnace oil', scope: 1, category: 'stationary_combustion', unit: 'kg', kgCo2ePerUnit: 3.13, gjPerUnit: 0.0404, source: 'IPCC 2006, 77.4 t CO2/TJ' },
  { key: 'r22_kg', name: 'Refrigerant R-22 leaked / topped up', scope: 1, category: 'fugitive', unit: 'kg', kgCo2ePerUnit: 1810, source: 'IPCC AR4 GWP' },
  { key: 'r134a_kg', name: 'Refrigerant R-134a leaked / topped up', scope: 1, category: 'fugitive', unit: 'kg', kgCo2ePerUnit: 1430, source: 'IPCC AR4 GWP' },
  { key: 'r410a_kg', name: 'Refrigerant R-410A leaked / topped up', scope: 1, category: 'fugitive', unit: 'kg', kgCo2ePerUnit: 2088, source: 'IPCC AR4 GWP' },
  { key: 'r32_kg', name: 'Refrigerant R-32 leaked / topped up', scope: 1, category: 'fugitive', unit: 'kg', kgCo2ePerUnit: 675, source: 'IPCC AR4 GWP' },
  { key: 'grid_kwh', name: 'Grid electricity', scope: 2, category: 'purchased_electricity', unit: 'kWh', kgCo2ePerUnit: 0.716, gjPerUnit: 0.0036, source: 'CEA CO2 Baseline Database v19 (2022-23)' },
  { key: 'purchased_goods_inr', name: 'Purchased goods and services (spend)', scope: 3, category: 'cat1_purchased_goods', unit: 'INR', kgCo2ePerUnit: 0.0004, source: 'Placeholder spend factor: replace with supplier-specific or EEIO data' },
  { key: 'road_freight_tkm', name: 'Road freight', scope: 3, category: 'cat4_upstream_transport', unit: 'tonne-km', kgCo2ePerUnit: 0.105, source: 'GHG Protocol / DEFRA average HGV' },
  { key: 'waste_landfill_kg', name: 'Waste to landfill', scope: 3, category: 'cat5_waste', unit: 'kg', kgCo2ePerUnit: 0.467, source: 'DEFRA commercial and industrial waste, landfill' },
  { key: 'air_travel_pkm', name: 'Business air travel', scope: 3, category: 'cat6_business_travel', unit: 'passenger-km', kgCo2ePerUnit: 0.15, source: 'DEFRA domestic flights, with radiative forcing' },
  { key: 'commute_car_km', name: 'Employee commuting by car', scope: 3, category: 'cat7_commuting', unit: 'km', kgCo2ePerUnit: 0.17, source: 'DEFRA average car' },
];

export const ENERGY_GJ: Record<string, number> = Object.fromEntries(DEFAULT_FACTORS.filter((f) => f.gjPerUnit).map((f) => [f.key, f.gjPerUnit!]));

export type Activity = {
  period: string;
  key: string;
  name: string;
  scope: number;
  category: string;
  quantity: number;
  kgCo2ePerUnit: number;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Emissions in tonnes CO2e by scope, by category and by month. */
export function footprint(rows: Activity[]) {
  const t = (r: Activity) => (r.quantity * r.kgCo2ePerUnit) / 1000;
  const scopes = { 1: 0, 2: 0, 3: 0 } as Record<number, number>;
  const categories = new Map<string, { scope: number; category: string; t: number }>();
  const months = new Map<string, Record<number, number>>();
  for (const r of rows) {
    const v = t(r);
    scopes[r.scope] = (scopes[r.scope] ?? 0) + v;
    const c = categories.get(r.category) ?? { scope: r.scope, category: r.category, t: 0 };
    c.t += v;
    categories.set(r.category, c);
    const m = months.get(r.period) ?? { 1: 0, 2: 0, 3: 0 };
    m[r.scope] += v;
    months.set(r.period, m);
  }
  return {
    scope1: r3(scopes[1]),
    scope2: r3(scopes[2]),
    scope3: r3(scopes[3]),
    total: r3(scopes[1] + scopes[2] + scopes[3]),
    categories: [...categories.values()].map((c) => ({ ...c, t: r3(c.t) })).sort((a, b) => a.scope - b.scope || b.t - a.t),
    months: [...months.entries()].sort().map(([period, m]) => ({ period, scope1: r3(m[1]), scope2: r3(m[2]), scope3: r3(m[3]) })),
  };
}

/** Energy in GJ from activities with a known energy content. */
export function energyGj(rows: { key: string; quantity: number }[]) {
  let total = 0;
  let electricity = 0;
  for (const r of rows) {
    const gj = (ENERGY_GJ[r.key] ?? 0) * r.quantity;
    total += gj;
    if (r.key === 'grid_kwh') electricity += gj;
  }
  return { totalGj: r3(total), electricityGj: r3(electricity), fuelGj: r3(total - electricity) };
}

/** Per ₹ crore of turnover. */
export const perCrore = (v: number, turnoverInr: number) => (turnoverInr > 0 ? Math.round((v * 1e7 * 1e4) / turnoverInr) / 1e4 : null);

/** Lost-time injury frequency rate per million person-hours. */
export const ltifr = (lostTimeInjuries: number, personHours: number) => (personHours > 0 ? Math.round(((lostTimeInjuries * 1e6) / personHours) * 100) / 100 : null);

/** EPR progress: the target against certificates. */
export function eprStatus(obligations: { category: string; fiscalYear: string; targetKg: number }[], certs: { category: string; fiscalYear: string; qtyKg: number; kind: string }[]) {
  const keys = new Set([...obligations.map((o) => `${o.category}|${o.fiscalYear}`), ...certs.map((c) => `${c.category}|${c.fiscalYear}`)]);
  return [...keys]
    .map((k) => {
      const [category, fiscalYear] = k.split('|');
      const targetKg = obligations.find((o) => o.category === category && o.fiscalYear === fiscalYear)?.targetKg ?? 0;
      const mine = certs.filter((c) => c.category === category && c.fiscalYear === fiscalYear);
      const certifiedKg = r3(mine.reduce((a, c) => a + c.qtyKg, 0));
      const byKind: Record<string, number> = {};
      for (const c of mine) byKind[c.kind] = r3((byKind[c.kind] ?? 0) + c.qtyKg);
      return { category, fiscalYear, targetKg, certifiedKg, byKind, shortfallKg: r3(Math.max(0, targetKg - certifiedKg)), pct: targetKg > 0 ? Math.round((certifiedKg * 1000) / targetKg) / 10 : null };
    })
    .sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear) || a.category.localeCompare(b.category));
}

// ---- materials compliance -----------------------------------------------------------------------

export interface PartDecl {
  rohs: string;
  svhc: { substance: string; cas: string; pct: number }[];
  uses3tg: boolean;
  smelters: { metal: string; name: string; conformant: boolean }[];
}

const ROHS_RANK: Record<string, number> = { compliant: 0, exempt: 1, unknown: 2, non_compliant: 3 };

/**
 * A product's compliance from its own declaration and every component's (recursively): RoHS is the
 * worst status found (a part without a declaration is unknown); SVHCs above 0.1 % w/w in any
 * article need REACH Article 33 communication; 3TG smelters not RMAP conformant are listed.
 */
export function rollUpCompliance(itemId: string, decl: Map<string, PartDecl>, children: Map<string, string[]>, names: Map<string, string>, seen = new Set<string>()) {
  const own = decl.get(itemId);
  const kids = (children.get(itemId) ?? []).filter((c) => !seen.has(c));
  const next = new Set([...seen, itemId]);
  let rohs = own ? own.rohs : kids.length ? 'compliant' : 'unknown';
  const svhc: { part: string; substance: string; cas: string; pct: number }[] = (own?.svhc ?? []).filter((s) => s.pct > 0.1).map((s) => ({ part: names.get(itemId) ?? itemId, ...s }));
  const smelters: { part: string; metal: string; name: string }[] = (own?.smelters ?? []).filter((s) => !s.conformant).map((s) => ({ part: names.get(itemId) ?? itemId, metal: s.metal, name: s.name }));
  const unknownParts: string[] = !own && !kids.length ? [names.get(itemId) ?? itemId] : [];
  let uses3tg = own?.uses3tg ?? false;
  for (const c of kids) {
    const r = rollUpCompliance(c, decl, children, names, next);
    if (ROHS_RANK[r.rohs] > ROHS_RANK[rohs]) rohs = r.rohs;
    svhc.push(...r.svhc);
    smelters.push(...r.nonConformantSmelters);
    unknownParts.push(...r.unknownParts);
    uses3tg ||= r.uses3tg;
  }
  return { rohs, svhc, reachArticle33: svhc.length > 0, uses3tg, nonConformantSmelters: smelters, unknownParts: [...new Set(unknownParts)] };
}
