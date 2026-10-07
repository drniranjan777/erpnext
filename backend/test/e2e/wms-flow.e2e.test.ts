import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const item: Record<string, any> = {};
const W = '/wms';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
const put = (path: string, b: unknown) => a.client.request('PUT', path, b);
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
async function binQty(code: string, itemId: string) {
  const b = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins/${code}`));
  return b.contents.filter((c: any) => c.itemId === itemId).reduce((s: number, c: any) => s + Number(c.qty), 0);
}
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  a = await signupWorkspace('wmsf-a');
  emails.push(a.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  const addr = [{ type: 'both', line1: 'Plot 4, IDA Uppal', city: 'Hyderabad', stateCode: '36', pincode: '500039', isDefault: true }];
  ctx.vendor = await ok(await a.client.post('/masters/parties', { name: 'Telangana Agro Inputs', isVendor: true, gstin: '36AABCS1234E1ZU', addresses: addr }), 201);
  ctx.cust = await ok(await a.client.post('/masters/parties', { name: 'Deccan Foods', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: addr }), 201);
  item.syrup = await ok(await a.client.post('/masters/items', { name: 'Glucose syrup can', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '17023010', trackBatch: true, hasExpiry: true, shelfLifeDays: 365, sellingRate: '120' }), 201);
  item.lid = await ok(await a.client.post('/masters/items', { name: 'Can lid', type: 'raw_material', baseUomId: uom.NOS, gstRate: 18, hsnCode: '83099090', sellingRate: '2' }), 201);
  await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/enable`));
  const zone = await ok(await a.client.post(`${W}/zones`, { warehouseId: ctx.wh, code: 'STOR', name: 'Storage', sequence: 10 }), 201);
  await ok(await a.client.post(`${W}/bins/generate`, { zoneId: zone.id, aisles: ['A'], racks: 3, shelves: 1 }), 201);
  ctx.bins = Object.fromEntries((await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/bins`))).map((b: any) => [b.code, b.id]));
  await ok(await put(`${W}/items/${item.syrup.id}/profile`, { minShelfLifeDays: 120 }));
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('docks and receiving', () => {
  it('books dock doors without clashes', async () => {
    ctx.door = await ok(await a.client.post(`${W}/doors`, { warehouseId: ctx.wh, code: 'D1', name: 'Door 1', direction: 'inbound' }), 201);
    const at = `${addDays(today(), 1)}T10:00:00+05:30`;
    ctx.appt = await ok(await a.client.post(`${W}/appointments`, { doorId: ctx.door.id, direction: 'inbound', partyId: ctx.vendor.id, vehicleNo: 'TS 08 UB 4455', startsAt: at, minutes: 60 }), 201);
    expect(ctx.appt).toMatchObject({ number: 'DA000001', vehicleNo: 'TS08UB4455', status: 'booked' });
    expect((await a.client.post(`${W}/appointments`, { doorId: ctx.door.id, direction: 'inbound', startsAt: `${addDays(today(), 1)}T10:30:00+05:30`, minutes: 30 })).status).toBe(409);
    expect((await a.client.post(`${W}/appointments`, { doorId: ctx.door.id, direction: 'outbound', startsAt: `${addDays(today(), 1)}T12:00:00+05:30` })).status).toBe(400);
    await ok(await a.client.post(`${W}/appointments`, { doorId: ctx.door.id, direction: 'inbound', startsAt: `${addDays(today(), 1)}T11:00:00+05:30`, minutes: 30 }), 201);
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/appointments?date=${addDays(today(), 1)}`))).toHaveLength(2);
    await ok(await a.client.post(`${W}/appointments/${ctx.appt.id}/status`, { status: 'arrived' }));
    expect((await a.client.post(`${W}/appointments/${ctx.appt.id}/status`, { status: 'no_show' })).status).toBe(409);
  });

  it('resolves scans and turns scanned counts into a GRN that lands in receiving', async () => {
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/resolve?code=a-01-1`))).toMatchObject({ kind: 'bin', code: 'A-01-1' });
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/resolve?code=${item.lid.code}`))).toMatchObject({ kind: 'item', id: item.lid.id });
    expect((await a.client.get(`${W}/warehouses/${ctx.wh}/resolve?code=NOPE-99`)).status).toBe(404);
    const po = await submit('/purchase/orders', await ok(await a.client.post('/purchase/orders', { vendorId: ctx.vendor.id, lines: [{ itemId: item.syrup.id, qty: '100', rate: '80' }, { itemId: item.lid.id, qty: '500', rate: '1' }] }), 201));
    const syrupLine = po.lines.find((l: any) => l.itemId === item.syrup.id).id;
    const lidLine = po.lines.find((l: any) => l.itemId === item.lid.id).id;
    const grn = await ok(
      await a.client.post(`${W}/receiving`, {
        poId: po.id,
        warehouseId: ctx.wh,
        appointmentId: ctx.appt.id,
        vehicleNo: 'TS08UB4455',
        lines: [
          { poLineId: syrupLine, receivedQty: 40, batchNo: 'GS-SHORT', mfgDate: addDays(today(), -300) },
          { poLineId: syrupLine, receivedQty: 60, batchNo: 'GS-LONG', mfgDate: addDays(today(), -10) },
          { poLineId: lidLine, receivedQty: 500 },
        ],
      }),
      201,
    );
    expect(grn.status).toBe('draft');
    await submit('/purchase/receipts', grn);
    expect(await binQty('RECV', item.syrup.id)).toBe(100);
    expect((await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/appointments?date=${addDays(today(), 1)}`))).find((x: any) => x.id === ctx.appt.id).status).toBe('in_progress');
  });

  it('cross-docks what open orders are waiting for', async () => {
    const so = await ok(await a.client.post('/sales/orders', { customerId: ctx.cust.id, lines: [{ itemId: item.lid.id, qty: '120' }] }), 201);
    ctx.lidOrder = await submit('/sales/orders', so);
    const plan = await ok(await a.client.post(`${W}/warehouses/${ctx.wh}/putaway`));
    const lid = plan.tasks.filter((t: any) => t.itemId === item.lid.id);
    expect(lid.map((t: any) => [t.reason, Number(t.qty)])).toEqual([['cross-dock: 120 waiting on open sales orders', 120], ['nearest empty bin', 380]]);
    for (const t of plan.tasks) await ok(await a.client.post(`${W}/tasks/${t.id}/confirm`, { binId: t.toBinId, qty: Number(t.qty) }));
    expect(await binQty('DISP', item.lid.id)).toBe(120);
  });
});

describe('waves, packing, delivery and loading', () => {
  it('plans FEFO picks within the minimum shelf life and reports the shortage', async () => {
    const so = await ok(await a.client.post('/sales/orders', { customerId: ctx.cust.id, customerPoNo: 'DF/77', lines: [{ itemId: item.syrup.id, qty: '80' }, { itemId: item.lid.id, qty: '50' }] }), 201);
    ctx.order = await submit('/sales/orders', so);
    const pickable = await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/pickable`));
    expect(pickable.map((p: any) => p.id)).toEqual(expect.arrayContaining([ctx.order.id, ctx.lidOrder.id]));
    const wave = await ok(await a.client.post(`${W}/waves`, { warehouseId: ctx.wh, orderIds: [ctx.order.id], mode: 'batch' }), 201);
    expect(wave).toMatchObject({ number: 'WV00001', status: 'open' });
    const w = await ok(await a.client.get(`${W}/waves/${wave.id}`));
    const syrup = w.tasks.filter((t: any) => t.itemId === item.syrup.id);
    // GS-SHORT has about 65 days left, under the 120-day minimum: only GS-LONG (60) can go.
    expect(syrup.map((t: any) => [t.batchNo, Number(t.qty)])).toEqual([['GS-LONG', 60]]);
    expect(w.shortages).toEqual([expect.objectContaining({ itemId: item.syrup.id, short: '20.0000', why: 'not enough pickable stock (40 below the minimum shelf life)' })]);
    expect(w.tasks.map((t: any) => t.pathSeq)).toEqual(w.tasks.map((_: any, i: number) => i + 1));
    expect((await a.client.post(`${W}/waves`, { warehouseId: ctx.wh, orderIds: [ctx.order.id] })).status).toBe(409);
    ctx.wave = w;
  });

  it('confirms picks into dispatch and refuses put-away style confirmation', async () => {
    const [first, ...rest] = ctx.wave.tasks;
    expect((await a.client.post(`${W}/tasks/${first.id}/confirm`, { binCode: first.fromBin, qty: 1 })).status).toBe(400);
    expect((await a.client.post(`${W}/picks/${first.id}/confirm`, { binCode: 'DISP', qty: 1 })).status).toBe(400);
    for (const t of [first, ...rest]) await ok(await a.client.post(`${W}/picks/${t.id}/confirm`, { binCode: t.fromBin, qty: t.itemId === item.lid.id ? 45 : Number(t.qty) }));
    const w = await ok(await a.client.get(`${W}/waves/${ctx.wave.id}`));
    expect(w.status).toBe('picked');
    expect(await binQty('DISP', item.syrup.id)).toBe(60);
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/reconcile`))).toEqual([]);
  });

  it('packs into SSCC cartons up to what was picked', async () => {
    expect((await a.client.post(`${W}/packages`, { orderId: ctx.order.id, waveId: ctx.wave.id })).status).toBe(400);
    await ok(await put(`${W}/settings`, { gs1Prefix: '8901234', ssccExtension: 1 }));
    const c1 = await ok(await a.client.post(`${W}/packages`, { orderId: ctx.order.id, waveId: ctx.wave.id }), 201);
    expect(c1.sscc).toMatch(/^18901234\d{10}$/);
    expect((await a.client.post(`${W}/packages/${c1.id}/close`, {})).status).toBe(400);
    await ok(await a.client.post(`${W}/packages/${c1.id}/items`, { itemId: item.syrup.id, qty: 60 }));
    expect((await a.client.post(`${W}/packages/${c1.id}/items`, { itemId: item.syrup.id, qty: 1 })).status).toBe(400);
    await ok(await a.client.post(`${W}/packages/${c1.id}/close`, { grossWeightKg: 66 }));
    const c2 = await ok(await a.client.post(`${W}/packages`, { orderId: ctx.order.id, waveId: ctx.wave.id }), 201);
    await ok(await a.client.post(`${W}/packages/${c2.id}/items`, { itemId: item.lid.id, qty: 45 }));
    expect((await a.client.post(`${W}/waves/${ctx.wave.id}/deliveries`)).status).toBe(409);
    await ok(await a.client.post(`${W}/packages/${c2.id}/close`, { grossWeightKg: 2.5 }));
    const lbl = await ok(await a.client.get(`${W}/packages/${c1.id}/label`));
    expect(lbl).toMatchObject({ customer: 'Deccan Foods', customerPoNo: 'DF/77', seq: 1, of: 2 });
    expect(lbl.contents[0]).toMatchObject({ code: item.syrup.code, batch: { batchNo: 'GS-LONG' } });
    expect((await ok(await a.client.get(`${W}/orders/${ctx.order.id}/packing`))).toPack).toEqual([]);
    ctx.c1 = c1;
    ctx.c2 = c2;
  });

  it('makes the delivery note from the picks and issues from dispatch', async () => {
    const r = await ok(await a.client.post(`${W}/waves/${ctx.wave.id}/deliveries`), 201);
    expect(r.deliveries).toHaveLength(1);
    const dn = await ok(await a.client.get(`/sales/deliveries/${r.deliveries[0].deliveryId}`));
    expect(dn).toMatchObject({ packages: 2, grossWeightKg: '68.500' });
    expect(dn.lines.map((l: any) => [l.itemId, l.qty, l.batchNo])).toEqual([
      [item.syrup.id, '60.0000', 'GS-LONG'],
      [item.lid.id, '45.0000', null],
    ]);
    await submit('/sales/deliveries', dn);
    expect(await binQty('DISP', item.syrup.id)).toBe(0);
    // The cross-docked lids for the other order are untouched.
    expect(await binQty('DISP', item.lid.id)).toBe(120);
    expect(await ok(await a.client.get(`${W}/warehouses/${ctx.wh}/reconcile`))).toEqual([]);
    ctx.dn = dn;
  });

  it('checks every carton onto the vehicle', async () => {
    expect((await a.client.post(`${W}/loading`, { deliveryId: ctx.dn.id, code: '123456789012345678' })).status).toBe(400);
    const first = await ok(await a.client.post(`${W}/loading`, { deliveryId: ctx.dn.id, code: `(00)${ctx.c1.sscc}`, vehicleNo: 'TS09AB1234' }));
    expect(first.remaining).toBe(1);
    expect((await a.client.post(`${W}/loading`, { deliveryId: ctx.dn.id, code: ctx.c1.sscc })).status).toBe(409);
    await ok(await a.client.post(`${W}/loading`, { deliveryId: ctx.dn.id, code: ctx.c2.sscc }));
    expect(await ok(await a.client.get(`${W}/deliveries/${ctx.dn.id}/loading`))).toMatchObject({ loaded: 2, total: 2 });
  });
});
