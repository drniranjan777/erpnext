import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let b: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let groups: Record<string, string> = {};

beforeAll(async () => {
  a = await signupWorkspace('mst-a');
  b = await signupWorkspace('mst-b');
  emails.push(a.email, b.email);
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  groups = Object.fromEntries((await a.client.get('/masters/item-groups')).body.map((g: any) => [g.code, g.id]));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId, b?.tenantId].filter(Boolean), emails);
});

describe('workspace defaults & reference data', () => {
  it('provisions standard units, item groups and stores', async () => {
    expect(Object.keys(uom)).toEqual(expect.arrayContaining(['NOS', 'KG', 'LTR', 'MTR', 'BAG']));
    expect(Object.keys(groups)).toEqual(expect.arrayContaining(['RM', 'FG', 'CON']));
    const wh = (await a.client.get('/inventory/warehouses')).body;
    expect(wh.map((w: any) => [w.code, w.isNettable])).toEqual(expect.arrayContaining([['MAIN', true], ['QC', false]]));
  });

  it('serves Indian reference data incl. the 40% GST slab', async () => {
    const ref = (await a.client.get('/masters/reference')).body;
    expect(ref.states).toContainEqual({ code: '36', name: 'Telangana' });
    expect(ref.gstRates).toContain('40');
  });
});

describe('items', () => {
  let resin: any;

  it('creates an item with an auto code, conversions and barcodes', async () => {
    const res = await a.client.post('/masters/items', {
      name: 'PP homopolymer granules',
      type: 'raw_material',
      groupId: groups.RM,
      baseUomId: uom.KG,
      purchaseUomId: uom.BAG,
      hsnCode: '39021000',
      gstRate: 18,
      trackBatch: true,
      reorderLevel: '500',
      conversions: [{ uomId: uom.BAG, factor: '25' }],
      barcodes: [{ barcode: '8901234567890' }, { barcode: '8901234567906', uomId: uom.BAG }],
      attributes: { grade: 'H110MA', mfi: 11 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    resin = res.body;
    expect(resin).toMatchObject({ code: 'ITM00001', gstRate: '18.00', isStockItem: true, trackBatch: true });
    expect(resin.conversions).toEqual([{ uomId: uom.BAG, uom: 'BAG', factor: '25.000000' }]);
    expect(resin.barcodes[0]).toMatchObject({ barcode: '8901234567890', isPrimary: true });
  });

  it('enforces item rules', async () => {
    const bad = async (patch: Record<string, unknown>) =>
      (await a.client.post('/masters/items', { name: 'Test item', type: 'consumable', baseUomId: uom.NOS, gstRate: 18, ...patch })).body.errors?.map((e: any) => e.path);
    expect(await bad({ type: 'service', trackBatch: true })).toContain('type');
    expect(await bad({ baseUomId: uom.KG, trackSerial: true })).toContain('trackSerial');
    expect(await bad({ hasExpiry: true })).toContain('hasExpiry');
    expect(await bad({ purchaseUomId: uom.BOX })).toContain('purchaseUomId');
    expect(await bad({ gstRate: null })).toContain('gstRate');
    expect(await bad({ gstRate: 13 })).toContain('gstRate');
    expect(await bad({ hsnCode: '12345' })).toContain('hsnCode');
  });

  it('services are never stock items; nil-rated items get 0%', async () => {
    const svc = (await a.client.post('/masters/items', { name: 'Machine AMC', type: 'service', baseUomId: uom.NOS, hsnCode: '998719', gstRate: 18, isStockItem: true })).body;
    expect(svc.isStockItem).toBe(false);
    const nil = (await a.client.post('/masters/items', { name: 'Fresh vegetables', type: 'consumable', baseUomId: uom.KG, isNilRatedOrExempt: true })).body;
    expect(nil.gstRate).toBe('0.00');
  });

  it('keeps codes and barcodes unique', async () => {
    expect((await a.client.post('/masters/items', { code: 'itm00001', name: 'Dup', type: 'consumable', baseUomId: uom.NOS, gstRate: 18 })).status).toBe(409);
    const dupBar = await a.client.post('/masters/items', { name: 'Other', type: 'consumable', baseUomId: uom.NOS, gstRate: 18, barcodes: [{ barcode: '8901234567890' }] });
    expect(dupBar.status).toBe(409);
    expect(dupBar.body.detail).toContain('ITM00001');
  });

  it('finds items by name, code, HSN or barcode', async () => {
    for (const q of ['homopolymer', 'ITM00001', '39021000', '8901234567906']) {
      const r = (await a.client.get(`/masters/items?q=${q}`)).body.items;
      expect(r.map((i: any) => i.id), q).toContain(resin.id);
    }
    const lookup = (await a.client.get('/masters/items/lookup?q=8901234567890')).body;
    expect(lookup[0]).toMatchObject({ id: resin.id, baseUom: 'KG' });
  });

  it('updates with optimistic locking and records an audit diff', async () => {
    const upd = { ...resin, gstRate: 5, conversions: resin.conversions.map((c: any) => ({ uomId: c.uomId, factor: c.factor })), barcodes: resin.barcodes.map((x: any) => ({ barcode: x.barcode, uomId: x.uomId, isPrimary: x.isPrimary })) };
    const ok = await a.client.request('PUT', `/masters/items/${resin.id}`, upd);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.gstRate).toBe('5.00');
    expect((await a.client.request('PUT', `/masters/items/${resin.id}`, upd)).status).toBe(409);
    const audit = (await a.client.get('/platform/audit-logs?entityType=item')).body.items;
    expect(audit[0].changes.gstRate).toEqual({ from: '18.00', to: '5' });
  });
});

describe('customers & vendors', () => {
  let vendor: any;

  it('validates GSTIN check digit and registration rules', async () => {
    const base = { name: 'Reliance Polymers', isVendor: true, addresses: [{ line1: 'Plot 12, MIDC', city: 'Pune', stateCode: '27', pincode: '411019' }] };
    const badCheck = await a.client.post('/masters/parties', { ...base, gstin: '27AAPFU0939F1ZW' });
    expect(badCheck.body.errors[0]).toMatchObject({ path: 'gstin' });
    expect(badCheck.body.errors[0].message).toMatch(/check digit/);
    const noGstin = await a.client.post('/masters/parties', { ...base, gstRegistrationType: 'regular' });
    expect(noGstin.body.errors.map((e: any) => e.path)).toContain('gstin');
    const noRole = await a.client.post('/masters/parties', { ...base, isVendor: false, gstRegistrationType: 'unregistered' });
    expect(noRole.body.errors.map((e: any) => e.path)).toContain('isCustomer');
  });

  it('creates a vendor: auto code, PAN and place of supply from GSTIN, bank masked', async () => {
    const res = await a.client.post('/masters/parties', {
      name: 'Reliance Polymers',
      isVendor: true,
      gstin: '27AAPFU0939F1ZV',
      msmeCategory: 'small',
      msmeUdyamNo: 'UDYAM-MH-26-0012345',
      creditDays: 45,
      addresses: [{ line1: 'Plot 12, MIDC', city: 'Pune', stateCode: '27', pincode: '411019' }],
      contacts: [{ name: 'Suresh Patil', phone: '+91 98220 12345', email: 'suresh@example.com' }],
      bankAccounts: [{ accountName: 'Reliance Polymers', accountNumber: '50200012345678', ifsc: 'HDFC0001234' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    vendor = res.body;
    expect(vendor).toMatchObject({ code: 'VEN00001', pan: 'AAPFU0939F', stateCode: '27', state: 'Maharashtra' });
    expect(vendor.bankAccounts[0]).toMatchObject({ accountNumberMasked: '•••• 5678', ifsc: 'HDFC0001234' });
    expect(JSON.stringify(vendor)).not.toContain('50200012345678');
  });

  it('refuses a duplicate GSTIN and suggests marking both roles', async () => {
    const dup = await a.client.post('/masters/parties', { name: 'Reliance (customer)', isCustomer: true, gstin: '27AAPFU0939F1ZV', addresses: [] });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toMatch(/both customer and vendor/);
  });

  it('keeps an existing bank account when the number is not re-sent', async () => {
    const upd = await a.client.request('PUT', `/masters/parties/${vendor.id}`, {
      name: vendor.name,
      isVendor: true,
      isCustomer: true,
      gstin: vendor.gstin,
      msmeCategory: 'small',
      msmeUdyamNo: vendor.msmeUdyamNo,
      addresses: vendor.addresses.map(({ id: _i, state: _s, ...x }: any) => x),
      bankAccounts: [{ id: vendor.bankAccounts[0].id, accountName: 'Reliance Polymers Pvt Ltd', ifsc: 'HDFC0001234' }],
      version: vendor.version,
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.bankAccounts[0].accountNumberMasked).toBe('•••• 5678');
    expect(upd.body.isCustomer).toBe(true);
    const customers = (await a.client.get('/masters/parties/lookup?role=customer&q=reli')).body;
    expect(customers.map((c: any) => c.id)).toContain(vendor.id);
  });

  it('accepts unregistered / consumer parties without GSTIN', async () => {
    const res = await a.client.post('/masters/parties', {
      name: 'Walk-in customer',
      isCustomer: true,
      gstRegistrationType: 'consumer',
      addresses: [{ line1: 'Ameerpet', city: 'Hyderabad', stateCode: '36', pincode: '500016' }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'CUS00001', stateCode: '36', gstin: null });
  });
});

describe('setup masters', () => {
  it('units: unique codes, decimals cannot be reduced once in use', async () => {
    expect((await a.client.post('/masters/uoms', { code: 'kg', name: 'Dup', uqc: 'KGS' })).status).toBe(409);
    const all = (await a.client.get('/masters/uoms')).body;
    const kg = all.find((u: any) => u.code === 'KG');
    expect((await a.client.request('PUT', `/masters/uoms/${kg.id}`, { code: 'KG', name: 'Kilogram', decimals: 0, uqc: 'KGS' })).status).toBe(409);
  });

  it('item groups: no cycles, max 3 levels', async () => {
    const l2 = (await a.client.post('/masters/item-groups', { code: 'RM-POLY', name: 'Polymers', parentId: groups.RM })).body;
    const l3 = (await a.client.post('/masters/item-groups', { code: 'RM-PP', name: 'Polypropylene', parentId: l2.id })).body;
    expect((await a.client.post('/masters/item-groups', { code: 'RM-PP-H', name: 'Homo', parentId: l3.id })).status).toBe(400);
    expect((await a.client.request('PUT', `/masters/item-groups/${groups.RM}`, { code: 'RM', name: 'Raw materials', parentId: l3.id })).status).toBe(400);
  });

  it('warehouses: transit/quarantine stock is not nettable by default', async () => {
    const res = await a.client.post('/inventory/warehouses', { code: 'TRN', name: 'Goods in transit', type: 'transit' });
    expect(res.status).toBe(201);
    const wh = (await a.client.get('/inventory/warehouses')).body.find((w: any) => w.code === 'TRN');
    expect(wh.isNettable).toBe(false);
  });

  it('price lists with quantity breaks', async () => {
    const item = (await a.client.get('/masters/items?q=ITM00001')).body.items[0];
    const res = await a.client.post('/masters/price-lists', {
      name: 'Dealer price',
      type: 'selling',
      isDefault: true,
      items: [
        { itemId: item.id, uomId: uom.KG, minQty: 0, rate: '132.50' },
        { itemId: item.id, uomId: uom.KG, minQty: 1000, rate: '128' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const pl = (await a.client.get(`/masters/price-lists/${res.body.id}`)).body;
    expect(pl.items.map((i: any) => [i.minQty, i.rate])).toEqual([['0.0000', '132.5000'], ['1000.0000', '128.0000']]);
    const dup = await a.client.post('/masters/price-lists', { name: 'Dup breaks', type: 'selling', items: [{ itemId: item.id, uomId: uom.KG, rate: 1 }, { itemId: item.id, uomId: uom.KG, rate: 2 }] });
    expect(dup.status).toBe(400);
  });
});

describe('permissions & isolation', () => {
  it('viewers can read masters but not change them', async () => {
    const roles = (await a.client.get('/iam/roles')).body;
    const viewer = await addMember(a.client, 'mst-viewer', [roles.find((r: any) => r.name === 'Viewer').id]);
    emails.push(viewer.email);
    expect((await viewer.client.get('/masters/items')).status).toBe(200);
    expect((await viewer.client.post('/masters/items', { name: 'Nope', type: 'consumable', baseUomId: uom.NOS, gstRate: 18 })).status).toBe(403);
    expect((await viewer.client.post('/masters/parties', { name: 'Nope', isCustomer: true, gstRegistrationType: 'consumer' })).status).toBe(403);
  });

  it("other workspaces can't see our items or parties", async () => {
    const item = (await a.client.get('/masters/items?q=ITM00001')).body.items[0];
    expect((await b.client.get(`/masters/items/${item.id}`)).status).toBe(404);
    expect((await b.client.get('/masters/parties')).body.items).toHaveLength(0);
    // Each workspace has its own code sequence.
    const bItem = await b.client.post('/masters/items', { name: 'B item', type: 'consumable', baseUomId: (await b.client.get('/masters/uoms')).body[0].id, gstRate: 18 });
    expect(bItem.body.code).toBe('ITM00001');
  });
});
