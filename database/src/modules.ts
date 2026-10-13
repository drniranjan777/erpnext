/**
 * Optional ERP modules. A workspace sees the core (masters, sales, purchase, stock, finance,
 * GST, reports, settings) plus the modules that suit its industry; an administrator can switch
 * any optional module on or off (tenants.settings.modules holds only the differences).
 */
export const MODULES = {
  crm: { label: 'CRM', description: 'Leads, pipeline, estimates and the product configurator.', api: ['crm'] },
  pos: { label: 'Point of sale', description: 'Counter billing with shifts, tills and returns.', api: ['pos'] },
  portal: { label: 'Customer portal', description: 'Customers place orders and see invoices and statements online.', api: ['portal-admin'] },
  wms: { label: 'Warehouse management', description: 'Bins, directed put-away, waves, cycle counts, docks and 3PL.', api: ['wms'] },
  manufacturing: { label: 'Manufacturing', description: 'BOMs, work orders, shop floor, engineering changes and MRP planning.', api: ['manufacturing', 'engineering', 'planning'] },
  process: { label: 'Process manufacturing', description: 'Formulas, blends, packing and process equipment.', api: ['process'] },
  mes_iot: { label: 'Shop floor & IoT', description: 'Machine terminals, OEE, downtime, live signals, energy, vision and the digital twin.', api: ['mes', 'iot', 'plant', 'twin', 'vision'] },
  quality: { label: 'Quality', description: 'Inspections, NCR, CAPA, complaints, calibration, audits and SOPs.', api: ['quality', 'qms'] },
  maintenance: { label: 'Maintenance', description: 'Breakdown and preventive maintenance, AMC and reliability.', api: ['maintenance'] },
  logistics: { label: 'Transport', description: 'Trips, freight bills and the driver app.', api: ['tms'] },
  distribution: { label: 'Distribution', description: 'Distributor network, secondary sales, schemes and claims.', api: ['dms'] },
  service: { label: 'After-sales service', description: 'Service desk, field visits, installed base, RMA and SLAs.', api: ['service'] },
  projects: { label: 'Projects & PLM', description: 'Project costing, resource load, product lifecycle and the CAD vault.', api: ['projects', 'plm'] },
  hr: { label: 'People & payroll', description: 'Employees, attendance, leave, recruitment, performance and payroll.', api: ['hr', 'payroll'] },
  ai: { label: 'AI', description: 'Copilot, AI inbox and agents, predictions, document AI and voice.', api: ['ai', 'copilot', 'docai', 'voice', 'insights'] },
  pharma: { label: 'GMP & pharma', description: 'Line clearance, batch record review, stability, APQR, serialisation and validation.', api: ['gmp', 'pharma', 'validation'] },
  food: { label: 'Food safety', description: 'HACCP, allergens, recalls, labels and certificates.', api: ['food', 'compliance/certificates'] },
  hse: { label: 'Health, safety & environment', description: 'HSE register, safety data sheets, hazardous storage and permits to work.', api: ['hse'] },
  esg: { label: 'Sustainability', description: 'Carbon footprint, EPR, BRSR and materials compliance.', api: ['esg', 'compliance/materials'] },
  automotive: { label: 'Automotive quality', description: 'APQP, PPAP, FMEA, layered audits and customer EDI.', api: ['auto'] },
  textile: { label: 'Textile export', description: 'Buyer orders, tech packs and social audits.', api: ['textile'] },
} as const satisfies Record<string, { label: string; description: string; api: readonly string[] }>;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

/** On for every industry. */
const BASE: ModuleKey[] = ['crm', 'manufacturing', 'quality', 'maintenance', 'logistics', 'hr', 'ai'];

/** What each industry adds to the base. An unknown or missing industry gets everything. */
const BY_INDUSTRY: Record<string, ModuleKey[]> = {
  'auto-components': ['automotive', 'mes_iot', 'wms'],
  electronics: ['esg', 'mes_iot', 'wms', 'service'],
  engineering: ['projects', 'service'],
  plastic: ['mes_iot'],
  textile: ['textile'],
  furniture: ['projects', 'pos'],
  packaging: ['mes_iot'],
  machinery: ['projects', 'service'],
  pharma: ['process', 'pharma', 'hse', 'wms'],
  chemical: ['process', 'hse', 'esg'],
  paint: ['process', 'hse'],
  lubricants: ['process', 'hse'],
  cosmetics: ['process', 'pharma'],
  fmcg: ['process', 'food', 'distribution', 'pos'],
  food: ['process', 'food', 'distribution'],
};

/** Modules an industry starts with. */
export function defaultModules(industry: string | null | undefined): ModuleKey[] {
  const extra = industry ? BY_INDUSTRY[industry] : undefined;
  if (!extra) return [...MODULE_KEYS];
  const on = new Set<ModuleKey>([...BASE, ...extra]);
  return MODULE_KEYS.filter((k) => on.has(k));
}

/** Modules switched on for a workspace: its industry's defaults, adjusted by its own choices. */
export function enabledModules(industry: string | null | undefined, overrides: Record<string, boolean> | null | undefined): ModuleKey[] {
  const defaults = new Set(defaultModules(industry));
  return MODULE_KEYS.filter((k) => (overrides && k in overrides ? overrides[k] === true : defaults.has(k)));
}

const BY_PREFIX: [string, ModuleKey][] = MODULE_KEYS.flatMap((k) => MODULES[k].api.map((p): [string, ModuleKey] => [p, k])).sort((a, b) => b[0].length - a[0].length);

/** The optional module an API path (without the /api/v1/ prefix) belongs to, if any. */
export function moduleOfPath(path: string): ModuleKey | null {
  for (const [prefix, key] of BY_PREFIX) if (path === prefix || path.startsWith(`${prefix}/`)) return key;
  return null;
}
