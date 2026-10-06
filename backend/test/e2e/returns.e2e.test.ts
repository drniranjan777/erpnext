import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];
let uom: Record<string, string> = {};
let wh: Record<string, string> = {};
const item: Record<string, any> = {};
const party: Record<string, any> = {};
const acc: Record<string, any> = {};
const ctx: Record<string, any> = {};

const OUR_GSTIN = '36AABCS1234E1ZU';
const VENDOR = '36AABCD1234E1Z9';
const CUSTOMER = '27AAACN0000A1ZL';
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const period = () => today().slice(0, 7);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fyStart = () => {
  const [y, m] = today().split('-').map(Number);
  return m >= 4 ? y : y - 1;
};
const quarter = () => {
  const m = Number(today().slice(5, 7));
  return m >= 4 && m <= 6 ? 1 : m <= 9 && m >= 7 ? 2 : m >= 10 ? 3 : 4;
};

async function created(path: string, body: unknown) {
  const res = await a.client.post(path, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
async function ok(res: { status: number; body: any }, status = 200) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}
async function submit(path: string, doc: any) {
  return ok(await a.client.post(`${path}/${doc.id}/submit`, { version: doc.version }));
}
async function closing(key: string) {
  const t = (await a.client.get(`/accounting/trial-balance?to=${addDays(today(), 40)}`)).body;
  expect(t.balanced).toBe(true);
  return t.rows.find((r: any) => r.systemKey === key || r.id === key)?.closing;
}
const invoice = async (customerId: string, qty: string, extra: Record<string, unknown> = {}) => submit('/sales/invoices', await created('/sales/invoices', { customerId, warehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty, rate: '100' }], ...extra }));

beforeAll(async () => {
  a = await signupWorkspace('rt-a');
  emails.push(a.email);
  const company = (await a.client.get('/org/companies')).body[0];
  await a.client.request('PUT', `/org/companies/${company.id}`, { name: company.name, gstin: OUR_GSTIN, address: { line1: 'Plot 7, IDA Uppal', city: 'Hyderabad', pincode: '500039' } });
  uom = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
  wh = Object.fromEntries((await a.client.get('/inventory/warehouses')).body.map((w: any) => [w.code, w.id]));
  item.crate = await created('/masters/items', { name: 'Crate', type: 'finished_good', baseUomId: uom.NOS, gstRate: 18, hsnCode: '39231090' });
  item.service = await created('/masters/items', { name: 'Machining job', type: 'service', baseUomId: uom.NOS, gstRate: 18, hsnCode: '998898' });
  await submit('/inventory/stock-entries', await created('/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh.MAIN, lines: [{ itemId: item.crate.id, qty: '100', rate: '50' }] }));
  const addr = (stateCode: string, city: string, pincode: string) => [{ type: 'both', line1: 'Main road', city, stateCode, pincode, isDefault: true }];
  party.b2b = await created('/masters/parties', { name: 'Pune Cold Chain', isCustomer: true, gstin: CUSTOMER, addresses: addr('27', 'Pune', '411001') });
  party.b2c = await created('/masters/parties', { name: 'Walk-in', isCustomer: true, gstRegistrationType: 'consumer', addresses: addr('36', 'Hyderabad', '500002') });
  party.export = await created('/masters/parties', { name: 'Gulf Fresh LLC', isCustomer: true, gstRegistrationType: 'overseas' });
  party.vendor = await created('/masters/parties', { name: 'Deccan Machining Co', isVendor: true, gstin: VENDOR, pan: 'AABCD1234E', tdsSection: '194C', addresses: addr('36', 'Hyderabad', '500055') });
  const list = (await a.client.get('/accounting/accounts')).body;
  acc.bank = await created('/accounting/accounts', { parentId: list.find((r: any) => r.code === '5320').id, code: '5321', name: 'HDFC current', accountType: 'bank' });
  acc.cwip = list.find((r: any) => r.systemKey === 'cwip');
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

describe('GSTR-1 and GSTR-3B', () => {
  it('builds GSTR-1 sections from the month’s invoices and credit notes', async () => {
    ctx.b2b = await invoice(party.b2b.id, '10'); // 1000 + IGST 180
    await invoice(party.b2c.id, '5'); // 500 + CGST 45 + SGST 45
    await invoice(party.export.id, '2', { withLut: true }); // 200, zero-rated
    const inv = (await a.client.get(`/sales/invoices/${ctx.b2b.id}`)).body;
    await submit('/sales/credit-notes', await created('/sales/credit-notes', { invoiceId: inv.id, kind: 'price_adjustment', reason: 'Rate difference', lines: [{ invoiceLineId: inv.lines[0].id, qty: '10', rate: '1' }] }));
    const r = await ok(await a.client.get(`/gst/gstr1?period=${period()}`));
    expect(r.summary).toMatchObject({ invoices: 3, b2b: 1, b2cs: 1, exp: 1, cdnr: 1, b2cl: 0 });
    expect(r.json.gstin).toBe(OUR_GSTIN);
    expect(r.json.b2b[0]).toMatchObject({ ctin: CUSTOMER, inv: [expect.objectContaining({ inum: ctx.b2b.number, val: 1180, pos: '27', rchrg: 'N', inv_typ: 'R' })] });
    expect(r.json.b2b[0].inv[0].itms[0].itm_det).toEqual({ rt: 18, txval: 1000, iamt: 180, camt: 0, samt: 0, csamt: 0 });
    expect(r.json.b2cs[0]).toMatchObject({ sply_ty: 'INTRA', pos: '36', rt: 18, txval: 500, camt: 45, samt: 45 });
    expect(r.json.exp[0]).toMatchObject({ exp_typ: 'WOPAY' });
    expect(r.json.cdnr[0].nt[0]).toMatchObject({ ntty: 'C', val: 12 });
    expect(r.json.hsn.hsn_b2b[0]).toMatchObject({ hsn_sc: '39231090', txval: 990 });
    const file = await a.client.download(`/gst/gstr1?period=${period()}&download=true`);
    expect(file.type).toMatch(/json/);
  });

  it('computes GSTR-3B and the set-off of input credit', async () => {
    const pi = await submit('/purchase/invoices', await created('/purchase/invoices', { vendorId: party.vendor.id, supplierInvoiceNo: 'DM/0901', supplierInvoiceDate: today(), lines: [{ itemId: item.service.id, qty: '1', rate: '5000' }] }));
    expect(pi).toMatchObject({ tdsSection: '194C', tdsAmount: '100.00' });
    ctx.pi = pi;
    const r = await ok(await a.client.get(`/gst/gstr3b?period=${period()}`));
    expect(r.table31.a).toEqual({ taxable: '1490.00', igst: '178.20', cgst: '45.00', sgst: '45.00', cess: '0.00' });
    expect(r.table31.b).toMatchObject({ taxable: '200.00', igst: '0.00' });
    expect(r.table4.others).toMatchObject({ cgst: '450.00', sgst: '450.00' });
    expect(r.ledger.liability).toMatchObject({ igst: '178.20', cgst: '45.00', sgst: '45.00' });
    // CGST credit pays CGST, then IGST; SGST pays SGST.
    expect(r.setOff.utilised.cgst).toMatchObject({ cgst: '45.00' });
    expect(r.setOff.utilised.igst).toMatchObject({ cgst: '178.20', sgst: '0.00' });
    expect(r.setOff.utilised.sgst).toMatchObject({ sgst: '45.00' });
    expect(r.cashPayable).toEqual({ igst: '0.00', cgst: '0.00', sgst: '0.00', cess: '0.00' });
    expect(r.setOff.creditLeft).toMatchObject({ cgst: '226.80', sgst: '405.00' });
  });

  it('posts the set-off journal: output tax cleared against credit', async () => {
    const s = await ok(await a.client.post('/gst/gstr3b/settle', { period: period() }));
    expect(s.number).toMatch(/^JV\//);
    expect(s.cashPayable).toBe('0.00');
    expect(await closing('gst_out_igst')).toBe('0.00');
    expect(await closing('gst_out_cgst')).toBe('0.00');
    expect(await closing('gst_in_cgst')).toBe('226.80');
    expect(await closing('gst_in_sgst')).toBe('405.00');
  });
});

describe('GSTR-2B reconciliation', () => {
  it('matches the portal’s invoices with bills, flags the rest', async () => {
    const fp = `${period().slice(5, 7)}${period().slice(0, 4)}`;
    const dmy = today().split('-').reverse().join('-');
    const json = {
      data: {
        gstin: OUR_GSTIN,
        rtnprd: fp,
        docdata: {
          b2b: [
            {
              ctin: VENDOR,
              trdnm: 'Deccan Machining Co',
              inv: [
                { inum: 'DM-901', typ: 'R', dt: dmy, val: 5900, pos: '36', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0 }] },
                { inum: 'DM-950', typ: 'R', dt: dmy, val: 1180, pos: '36', rev: 'N', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 }] },
              ],
            },
          ],
        },
      },
    };
    const r = await ok(await a.client.upload('/gst/gstr2b', 'gstr2b.json', JSON.stringify(json), 'application/json'));
    expect(r.summary).toMatchObject({ lines: 2, matched: 1, missingInBooks: 1, missingIn2b: 0, itcIn2b: '1080.00' });
    const matched = r.lines.find((l: any) => l.docNo === 'DM-901');
    expect(matched).toMatchObject({ status: 'matched', purchaseInvoiceId: ctx.pi.id });
    const missing = r.lines.find((l: any) => l.docNo === 'DM-950');
    const act = await ok(await a.client.request('PUT', `/gst/gstr2b/lines/${missing.id}`, { action: 'follow_up', note: 'Ask vendor for the bill' }));
    expect(act).toMatchObject({ action: 'follow_up' });
    const bad = await a.client.upload('/gst/gstr2b', 'x.json', '{"data":{}}', 'application/json');
    expect(bad.status).toBe(400);
  });
});

describe('TDS', () => {
  it('summarises the quarter’s deductions and deposits, with 16A data', async () => {
    let q = await ok(await a.client.get(`/accounting/tds?fy=${fyStart()}&quarter=${quarter()}`));
    expect(q.sections).toEqual([expect.objectContaining({ section: '194C', deducted: '100.00', deposited: '0.00', balance: '100.00', deductees: 1 })]);
    expect(q.deductions[0]).toMatchObject({ pan: 'AABCD1234E', base: '5000.00', rate: '2.000', tds: '100.00' });
    await ok(await a.client.post('/accounting/tds/challans', { accountId: acc.bank.id, section: '194C', fy: fyStart(), quarter: quarter(), amount: '100', bsrCode: '0510308', challanSerial: '12345', depositDate: today() }), 201);
    q = await ok(await a.client.get(`/accounting/tds?fy=${fyStart()}&quarter=${quarter()}`));
    expect(q.sections[0]).toMatchObject({ deposited: '100.00', balance: '0.00' });
    expect(q.challans[0]).toMatchObject({ bsrCode: '0510308', challanSerial: '12345' });
    expect(await closing('tds_payable')).toBe('0.00');
    const c = await ok(await a.client.get(`/accounting/tds/16a/${party.vendor.id}?fy=${fyStart()}&quarter=${quarter()}`));
    expect(c).toMatchObject({ deductee: { pan: 'AABCD1234E' }, tdsDeducted: '100.00', amountPaid: '5000.00' });
    const csv = new TextDecoder().decode((await a.client.download(`/accounting/tds?fy=${fyStart()}&quarter=${quarter()}&format=csv`)).bytes);
    expect(csv).toContain('AABCD1234E');
  });
});

describe('fixed assets', () => {
  it('capitalises from CWIP, depreciates by the day and posts the journal', async () => {
    const cats = (await a.client.get('/assets/categories')).body;
    expect(cats.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Plant and machinery', 'Computers']));
    const plant = cats.find((c: any) => c.name === 'Plant and machinery');
    // Put money into CWIP first.
    await submit('/accounting/journals', await created('/accounting/journals', { narration: 'Machine under installation', lines: [{ accountId: acc.cwip.id, debit: '120000' }, { accountId: acc.bank.id, credit: '120000' }] }));
    const put = addDays(today(), -182);
    const asset = await created('/assets', { name: 'Injection moulding machine', categoryId: plant.id, purchaseDate: put, capitalisedOn: put, cost: '120000', capitaliseFromAccountId: acc.cwip.id, serialNo: 'IMM-77' });
    expect(asset).toMatchObject({ code: 'FA-00001', residualValue: '6000.00', method: 'slm', netBookValue: '120000.00' });
    expect(asset.capitalisationJournalId).toBeTruthy();
    expect(await closing('cwip')).toBe('0.00');
    const run = await ok(await a.client.post('/assets/depreciation', { to: today() }));
    // 7600 a year × 183 days / 365.
    expect(run).toMatchObject({ assets: 1, amount: '3810.41' });
    expect(await closing('depreciation')).toBe('3810.41');
    expect(await closing('accumulated_depreciation')).toBe('-3810.41');
    // Running again to the same date charges nothing.
    expect((await ok(await a.client.post('/assets/depreciation', { to: today() }))).assets).toBe(0);
    const detail = (await a.client.get(`/assets/${asset.id}`)).body;
    expect(detail).toMatchObject({ accumulatedDepreciation: '3810.41', depreciatedUntil: today(), netBookValue: '116189.59' });
    expect(detail.history[0]).toMatchObject({ days: 183, amount: '3810.41' });
    ctx.asset = asset;
  });

  it('a cancelled depreciation journal takes the charge back off the asset', async () => {
    const detail = (await a.client.get(`/assets/${ctx.asset.id}`)).body;
    const jv = (await a.client.get(`/accounting/journals/${detail.history[0].journalId}`)).body;
    await ok(await a.client.post(`/accounting/journals/${jv.id}/cancel`, { version: jv.version, reason: 'Wrong period' }));
    const after = (await a.client.get(`/assets/${ctx.asset.id}`)).body;
    expect(after).toMatchObject({ accumulatedDepreciation: '0.00', depreciatedUntil: addDays(addDays(today(), -182), -1), history: [] });
    await ok(await a.client.post('/assets/depreciation', { to: today() }));
  });

  it('disposes with a sale: depreciation to the date, cost and depreciation out, profit or loss booked', async () => {
    const d = await ok(await a.client.post(`/assets/${ctx.asset.id}/dispose`, { date: today(), amount: '100000', accountId: acc.bank.id, reason: 'Sold to a scrap dealer' }));
    expect(d).toMatchObject({ status: 'disposed', disposalAmount: '100000.00', gainOrLoss: '-16189.59' });
    expect(await closing('asset_disposal')).toBe('16189.59');
    expect(await closing('accumulated_depreciation')).toBe('0.00');
    expect((await a.client.post(`/assets/${ctx.asset.id}/dispose`, { date: today(), reason: 'again' })).status).toBe(409);
    const it = (await a.client.get(`/assets/it-schedule?fy=${fyStart()}`)).body;
    expect(it.blocks[0]).toMatchObject({ ratePct: '15', assets: 1 });
    expect(it.blocks[0].year.deletions).toBe('100000.00');
  });
});
