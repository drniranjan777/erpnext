/**
 * Industry starting points: item groups, stores and work centres a new workspace of that
 * industry usually needs. Applying a template only adds what is missing (by code).
 */

export interface IndustryTemplate {
  label: string;
  itemGroups: [code: string, name: string][];
  warehouses: [code: string, name: string, type: 'store' | 'production' | 'finished_goods' | 'quarantine' | 'rejected' | 'scrap', nettable: boolean][];
  /** code, name, kind, labour / machine / overhead per hour */
  workCenters: [code: string, name: string, kind: 'machine' | 'line' | 'manual' | 'subcontract', labour: number, machine: number, overhead: number][];
}

const STORES: IndustryTemplate['warehouses'] = [
  ['FG', 'Finished goods store', 'finished_goods', true],
  ['SHOP', 'Shop floor', 'production', true],
  ['REJ', 'Rejected goods', 'rejected', false],
  ['SCRAP', 'Scrap yard', 'scrap', false],
];

const DISCRETE_QC: IndustryTemplate['workCenters'][number] = ['QC', 'Quality check', 'manual', 150, 0, 30];
const PACK: IndustryTemplate['workCenters'][number] = ['PACK', 'Packing', 'manual', 90, 0, 20];

const PROCESS: IndustryTemplate = {
  label: 'Process manufacturing',
  itemGroups: [
    ['ACT', 'Actives and key ingredients'],
    ['EXC', 'Excipients and additives'],
    ['SOLV', 'Solvents'],
    ['BULK', 'Bulk / intermediates'],
  ],
  warehouses: [...STORES, ['DISP', 'Dispensing area', 'production', true]],
  workCenters: [
    ['DISP', 'Dispensing', 'manual', 120, 0, 40],
    ['MIX', 'Mixing and blending', 'machine', 120, 250, 60],
    ['FILL', 'Filling', 'line', 120, 300, 60],
    PACK,
    ['QCLAB', 'QC laboratory', 'manual', 200, 0, 50],
  ],
};

export const TEMPLATES: Record<string, IndustryTemplate> = {
  engineering: {
    label: 'Engineering / Fabrication',
    itemGroups: [
      ['STEEL', 'Steel, sheet and sections'],
      ['CAST', 'Castings and forgings'],
      ['FAST', 'Fasteners'],
      ['PAINT', 'Paints and coatings'],
    ],
    warehouses: STORES,
    workCenters: [
      ['CUT', 'Cutting', 'machine', 120, 200, 50],
      ['CNC', 'CNC machining', 'machine', 150, 400, 80],
      ['WELD', 'Welding', 'manual', 150, 80, 50],
      ['PAINT', 'Painting', 'line', 120, 150, 60],
      ['ASSY', 'Assembly', 'manual', 120, 0, 30],
      DISCRETE_QC,
    ],
  },
  'auto-components': {
    label: 'Automobile / Auto components',
    itemGroups: [
      ['STEEL', 'Steel and bar stock'],
      ['CAST', 'Castings and forgings'],
      ['FAST', 'Fasteners'],
      ['RUB', 'Rubber and plastic parts'],
    ],
    warehouses: STORES,
    workCenters: [
      ['CNC', 'CNC turning and milling', 'machine', 150, 450, 90],
      ['VMC', 'Vertical machining centre', 'machine', 150, 500, 90],
      ['PRESS', 'Press shop', 'machine', 120, 300, 60],
      ['HT', 'Heat treatment', 'subcontract', 0, 0, 0],
      ['ASSY', 'Assembly', 'manual', 120, 0, 30],
      DISCRETE_QC,
    ],
  },
  machinery: {
    label: 'Machinery',
    itemGroups: [
      ['STEEL', 'Steel and structurals'],
      ['BOUGHT', 'Bought-out parts'],
      ['ELEC', 'Electricals and controls'],
      ['HYD', 'Hydraulics and pneumatics'],
    ],
    warehouses: STORES,
    workCenters: [
      ['FAB', 'Fabrication', 'manual', 150, 100, 50],
      ['MACH', 'Machining', 'machine', 150, 450, 80],
      ['PAINT', 'Painting', 'line', 120, 150, 60],
      ['ASSY', 'Assembly', 'manual', 150, 0, 40],
      ['TEST', 'Testing and trials', 'manual', 200, 100, 50],
    ],
  },
  plastic: {
    label: 'Plastic',
    itemGroups: [
      ['POLY', 'Polymers and resins'],
      ['MB', 'Masterbatches'],
      ['REGR', 'Regrind'],
      ['INS', 'Inserts and components'],
    ],
    warehouses: STORES,
    workCenters: [
      ['IMM', 'Injection moulding', 'machine', 120, 300, 60],
      ['BLOW', 'Blow moulding', 'machine', 120, 280, 60],
      ['EXTR', 'Extrusion', 'line', 120, 350, 70],
      ['PRINT', 'Printing', 'machine', 100, 150, 40],
      PACK,
    ],
  },
  electronics: {
    label: 'Electronics',
    itemGroups: [
      ['PCB', 'Bare PCBs'],
      ['IC', 'ICs and active components'],
      ['PASS', 'Passive components'],
      ['ENCL', 'Enclosures and mechanicals'],
    ],
    warehouses: [...STORES, ['MSL', 'Dry storage (MSL)', 'store', true]],
    workCenters: [
      ['SMT', 'SMT line', 'line', 150, 600, 100],
      ['THT', 'Through-hole and wave', 'line', 120, 250, 60],
      ['TEST', 'Testing (ICT / functional)', 'manual', 150, 200, 50],
      ['ASSY', 'Box build', 'manual', 120, 0, 30],
      PACK,
    ],
  },
  textile: {
    label: 'Textile & Apparel',
    itemGroups: [
      ['YARN', 'Yarn'],
      ['FAB', 'Fabric'],
      ['TRIM', 'Trims and accessories'],
      ['DYE', 'Dyes and chemicals'],
    ],
    warehouses: STORES,
    workCenters: [
      ['CUT', 'Cutting', 'manual', 100, 50, 30],
      ['STITCH', 'Stitching', 'line', 100, 60, 30],
      ['FINISH', 'Finishing and pressing', 'manual', 90, 30, 20],
      ['EMB', 'Embroidery', 'subcontract', 0, 0, 0],
      PACK,
    ],
  },
  furniture: {
    label: 'Furniture',
    itemGroups: [
      ['BOARD', 'Boards and panels'],
      ['HW', 'Hardware and fittings'],
      ['UPH', 'Fabrics and foam'],
      ['FIN', 'Finishes and laminates'],
    ],
    warehouses: STORES,
    workCenters: [
      ['CUT', 'Panel cutting', 'machine', 100, 200, 40],
      ['EDGE', 'Edge banding', 'machine', 100, 150, 40],
      ['DRILL', 'Boring and drilling', 'machine', 100, 120, 30],
      ['ASSY', 'Assembly', 'manual', 110, 0, 30],
      ['POLISH', 'Polishing', 'manual', 110, 20, 30],
    ],
  },
  packaging: {
    label: 'Packaging',
    itemGroups: [
      ['PAPER', 'Kraft paper and board'],
      ['INK', 'Inks'],
      ['ADH', 'Adhesives'],
      ['FILM', 'Films and laminates'],
    ],
    warehouses: [...STORES, ['REEL', 'Reel store', 'store', true]],
    workCenters: [
      ['CORR', 'Corrugation', 'line', 100, 400, 80],
      ['PRINT', 'Printing', 'machine', 120, 300, 60],
      ['DIE', 'Die cutting', 'machine', 100, 200, 40],
      ['PASTE', 'Pasting and stitching', 'manual', 90, 50, 30],
    ],
  },
  pharma: { ...PROCESS, label: 'Pharma', warehouses: [...PROCESS.warehouses, ['COLD', 'Cold store (2–8 °C)', 'store', true]] },
  chemical: { ...PROCESS, label: 'Chemical', workCenters: [...PROCESS.workCenters, ['REACT', 'Reactor', 'machine', 150, 500, 100]] },
  paint: { ...PROCESS, label: 'Paint & Coatings', itemGroups: [...PROCESS.itemGroups, ['PIG', 'Pigments'], ['TINT', 'Tinters']] },
  lubricants: { ...PROCESS, label: 'Lubricants', itemGroups: [...PROCESS.itemGroups, ['BASE', 'Base oils'], ['ADD', 'Additive packages']] },
  cosmetics: { ...PROCESS, label: 'Cosmetics' },
  fmcg: { ...PROCESS, label: 'FMCG' },
  food: { ...PROCESS, label: 'Food processing', warehouses: [...PROCESS.warehouses, ['COLD', 'Cold store', 'store', true]] },
  other: { label: 'Other', itemGroups: [], warehouses: STORES.filter(([c]) => c !== 'SHOP'), workCenters: [] },
};
