import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, Client, cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
let checker: Awaited<ReturnType<typeof addMember>>;
const emails: string[] = [];
const ctx: Record<string, any> = {};
const T = '/tms';

async function ok(r: { status: number; body: any }, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** A posted delivery note of `qty` boxes to a customer in `city`. */
async function delivery(cust: any, qty: number, kg: string) {
  const so = await submit('/sales/orders', await ok(await a.client.post('/sales/orders', { customerId: cust.id, lines: [{ itemId: ctx.item.id, qty: String(qty) }] }), 201));
  const dn = await ok(await a.client.post('/sales/deliveries', { orderId: so.id, warehouseId: ctx.wh, grossWeightKg: kg, packages: 2, lines: [{ soLineId: so.lines[0].id, qty: String(qty) }] }), 201);
  return submit('/sales/deliveries', dn);
}

beforeAll(async () => {
  a = await signupWorkspace('tms-a');
  emails.push(a.email);
  const role = await ok(await a.client.post('/iam/roles', { name: 'Freight checker', permissions: ['tms.freight.manage', 'sales.deliveries.read'] }), 201);
  checker = await addMember(a.client, 'tms-chk', [role.id]);
  emails.push(checker.email);
  const uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  ctx.wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id])).MAIN;
  ctx.item = await ok(await a.client.post('/masters/items', { name: 'Corrugated box', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '48191010', sellingRate: '40' }), 201);
  const e = await ok(await a.client.post('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: ctx.wh, lines: [{ itemId: ctx.item.id, qty: '1000', rate: '20' }] }), 201);
  await submit('/inventory/stock-entries', e);
  const addr = (city: string, stateCode: string, pincode: string) => [{ type: 'both', line1: 'Main road', city, stateCode, pincode, isDefault: true }];
  ctx.pune = await ok(await a.client.post('/masters/parties', { name: 'Pune Packers', isCustomer: true, gstRegistrationType: 'unregistered', addresses: addr('Pune', '27', '411001') }), 201);
  ctx.nagpur = await ok(await a.client.post('/masters/parties', { name: 'Nagpur Foods', isCustomer: true, gstRegistrationType: 'unregistered', addresses: addr('Nagpur', '27', '440001') }), 201);
  ctx.vrl = await ok(await a.client.post('/masters/parties', { name: 'VRL Logistics', isVendor: true, gstin: '36AABCS1234E1ZU', addresses: addr('Hyderabad', '36', '500001') }), 201);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('masters', () => {
  it('sets up transporters, vehicles and a rate contract', async () => {
    expect((await a.client.post(`${T}/transporters`, { partyId: ctx.pune.id })).status).toBe(400);
    ctx.tr = await ok(await a.client.post(`${T}/transporters`, { partyId: ctx.vrl.id }), 201);
    expect(ctx.tr.transporterGstId).toBe('36AABCS1234E1ZU');
    ctx.truck = await ok(await a.client.post(`${T}/vehicles`, { regNo: 'ts 08 ub 4455', vehicleType: '17ft', capacityKg: 7000, transporterId: ctx.tr.id, driverName: 'Ramesh', driverPhone: '9876500011' }), 201);
    expect(ctx.truck.regNo).toBe('TS08UB4455');
    expect((await a.client.post(`${T}/vehicles`, { regNo: 'TS08UB4455', vehicleType: '407' })).status).toBe(409);
    const c = await ok(
      await a.client.post(`${T}/contracts`, {
        transporterId: ctx.tr.id,
        validFrom: `${today().slice(0, 4)}-01-01`,
        validTo: `${today().slice(0, 4)}-12-31`,
        rates: [
          { toState: '27', basis: 'per_kg', rate: 4, minCharge: 3000 },
          { toCity: 'Pune', vehicleType: '17ft', basis: 'per_trip', rate: 22000, perStop: 750 },
        ],
      }),
      201,
    );
    expect(c.number).toBe('FRC0001');
  });
});

describe('trips', () => {
  it('plans a trip of delivery notes and prices it from the contract', async () => {
    ctx.dn1 = await delivery(ctx.nagpur, 100, '800');
    ctx.dn2 = await delivery(ctx.pune, 150, '1200');
    const un = await ok(await a.client.get(`${T}/unplanned`));
    expect(un.map((d: any) => d.id)).toEqual(expect.arrayContaining([ctx.dn1.id, ctx.dn2.id]));
    const trip = await ok(await a.client.post(`${T}/trips`, { vehicleId: ctx.truck.id, plannedKm: 560, deliveryIds: [ctx.dn1.id, ctx.dn2.id] }), 201);
    // Last drop is Pune on a 17 ft truck: ₹22,000 a trip + one extra drop.
    expect(trip).toMatchObject({ number: 'TR000001', vehicleNo: 'TS08UB4455', weightKg: '2000.000', freightAmount: '22750.00', status: 'planned' });
    expect((await a.client.post(`${T}/trips`, { vehicleNo: 'AP09ZZ1111', deliveryIds: [ctx.dn1.id] })).status).toBe(409);
    const v = await ok(await a.client.get(`${T}/trips/${trip.id}`));
    expect(v.stops.map((s: any) => [s.seq, s.customer, s.city])).toEqual([[1, 'Nagpur Foods', 'Nagpur'], [2, 'Pune Packers', 'Pune']]);
    // Single drop to Nagpur on another lane falls to the per-kg state rate, with its minimum.
    ctx.dn3 = await delivery(ctx.nagpur, 20, '300');
    const small = await ok(await a.client.post(`${T}/trips`, { vehicleNo: 'TS07AB1234', vehicleType: '407', transporterId: ctx.tr.id, deliveryIds: [ctx.dn3.id] }), 201);
    expect(small).toMatchObject({ freightAmount: '3000.00', freightBasis: '300 kg × ₹4 (minimum ₹3000)' });
    await ok(await a.client.post(`${T}/trips/${small.id}/cancel`));
    ctx.trip = v;
  });

  it('gives the driver a link for positions and proof of delivery', async () => {
    expect((await a.client.post(`${T}/trips/${ctx.trip.id}/stops/${ctx.trip.stops[0].id}/arrive`)).status).toBe(409);
    const d = await ok(await a.client.post(`${T}/trips/${ctx.trip.id}/dispatch`, { odometerStart: 120500 }));
    expect(d.driverUrl).toContain('/driver?t=');
    const driver = new Client();
    const tok = encodeURIComponent(d.token);
    const view = await ok(await driver.get(`/public/trips/${tok}`));
    expect(view).toMatchObject({ number: 'TR000001', status: 'dispatched' });
    expect(view).not.toHaveProperty('freightAmount');
    await ok(await driver.post(`/public/trips/${tok}/positions`, { latitude: 17.385, longitude: 78.4867, at: new Date(Date.now() - 3_600_000).toISOString() }));
    await ok(await driver.post(`/public/trips/${tok}/positions`, { latitude: 17.4399, longitude: 78.4983 }));
    await ok(await driver.post(`/public/trips/${tok}/stops/${view.stops[0].id}/arrive`));
    await ok(await driver.post(`/public/trips/${tok}/stops/${view.stops[0].id}/pod`, { receivedBy: 'S. Patil', note: '2 boxes, seal intact', signature: 'data:image/png;base64,iVBORw0KGgo=' }));
    expect((await driver.post(`/public/trips/${tok}/stops/${view.stops[0].id}/pod`, { receivedBy: 'again' })).status).toBe(409);
    await ok(await driver.post(`/public/trips/${tok}/stops/${view.stops[1].id}/fail`, { note: 'Customer closed for Diwali' }));
    const dn = await ok(await a.client.get(`/sales/deliveries/${ctx.dn1.id}`));
    expect(dn.podNote).toBe('Received by S. Patil: 2 boxes, seal intact');
    expect(dn.deliveredAt).toBeTruthy();
    expect((await new Client().get('/public/trips/not-a-valid-token-0000000000000000000000000000000')).status).toBe(404);
    ctx.token = tok;
  });

  it('completes with expenses and the odometer, and closes the driver link', async () => {
    await ok(await a.client.post(`${T}/trips/${ctx.trip.id}/expenses`, { kind: 'toll', amount: 1450, note: 'NH44' }));
    expect((await a.client.post(`${T}/trips/${ctx.trip.id}/complete`, { odometerEnd: 100 })).status).toBe(400);
    await ok(await a.client.post(`${T}/trips/${ctx.trip.id}/complete`, { odometerEnd: 121090 }));
    const v = await ok(await a.client.get(`${T}/trips/${ctx.trip.id}`));
    expect(v).toMatchObject({ status: 'completed', odometerKm: 590, expensesTotal: '1450.00', trackedKm: 6.2 });
    expect((await new Client().get(`/public/trips/${ctx.token}`)).status).toBe(404);
  });
});

describe('freight bills', () => {
  it('checks a transporter bill against contract freight and needs a second person', async () => {
    const billable = await ok(await a.client.get(`${T}/transporters/${ctx.tr.id}/billable`));
    expect(billable).toEqual([expect.objectContaining({ id: ctx.trip.id, freightAmount: '22750.00', expenses: '1450.00' })]);
    const b = await ok(await a.client.post(`${T}/freight-bills`, { transporterId: ctx.tr.id, billNo: 'VRL/2026/881', billDate: today(), lines: [{ tripId: ctx.trip.id, claimed: 25000 }] }), 201);
    expect(b).toMatchObject({ claimedAmount: '25000.00', computedAmount: '24200.00', difference: '800.00', status: 'pending' });
    expect((await a.client.post(`${T}/freight-bills`, { transporterId: ctx.tr.id, billNo: 'X-2', billDate: today(), lines: [{ tripId: ctx.trip.id, claimed: 1 }] })).status).toBe(409);
    expect((await a.client.post(`${T}/freight-bills/${b.id}/decide`, { approve: true, note: 'ok' })).status).toBe(409);
    expect((await checker.client.post(`${T}/freight-bills/${b.id}/decide`, { approve: true })).status).toBe(400);
    const d = await ok(await checker.client.post(`${T}/freight-bills/${b.id}/decide`, { approve: false, note: 'Detention charge not agreed' }));
    expect(d.status).toBe('disputed');
    // Disputed trips can be billed again.
    expect(await ok(await a.client.get(`${T}/transporters/${ctx.tr.id}/billable`))).toHaveLength(1);
  });
});
