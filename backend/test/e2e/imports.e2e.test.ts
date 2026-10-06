import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenants, signupWorkspace } from './helpers';

type Workspace = Awaited<ReturnType<typeof signupWorkspace>>;

let a: Workspace;
const emails: string[] = [];

beforeAll(async () => {
  a = await signupWorkspace('imp-a');
  emails.push(a.email);
});

afterAll(async () => {
  await cleanupTenants([a?.tenantId].filter(Boolean), emails);
});

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
const rowsBy = (body: any) => Object.fromEntries(body.rows.map((r: any) => [r.rowNo, r]));

describe('templates', () => {
  it('serves Excel and CSV templates', async () => {
    const xlsx = await a.client.download('/imports/items/template');
    expect(xlsx.status).toBe(200);
    expect(xlsx.type).toContain('spreadsheetml');
    expect(xlsx.disposition).toContain('items-import-template.xlsx');
    expect(String.fromCharCode(xlsx.bytes[0], xlsx.bytes[1])).toBe('PK');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.bytes.buffer as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Items', 'Help']);
    expect(wb.worksheets[0].getRow(1).getCell(2).value).toBe('Item name *');

    const c = await a.client.download('/imports/opening-stock/template?format=csv');
    expect(new TextDecoder().decode(c.bytes)).toContain('Item code *,Warehouse *,Quantity *');
    expect((await a.client.get('/imports/parties/columns')).body.columns.map((x: any) => x.key)).toContain('gstin');
  });
});

describe('items import', () => {
  const file = csv([
    ['Item Code', 'Item Name', 'Type', 'Group', 'UOM', 'Purchase unit', 'Base units per purchase unit', 'HSN/SAC', 'GST %', 'Batch tracking', 'Reorder level', 'Colour'],
    ['RM-PP-H110', 'PP homopolymer granules H110', 'raw material', 'RM', 'KG', 'BAG', '25', '39021000', '18', 'Yes', '500', 'white'],
    ['', 'Corrugated box 5-ply', 'PM', 'Packing materials', 'Nos', '', '', '48191010', '12', 'No', '1,000', ''],
    ['', 'Bad rate item', 'consumable', '', 'NOS', '', '', '', '13', '', '', ''],
    ['', 'Unknown unit item', 'consumable', '', 'BUCKETS', '', '', '', '18', '', '', ''],
    ['', 'PP homopolymer granules H110', 'raw material', '', 'KG', '', '', '', '18', '', '', ''],
  ]);

  it('previews row by row without saving anything', async () => {
    const res = await a.client.upload('/imports/items/preview', 'items.csv', file, 'text/csv');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ committed: false, summary: { total: 5, created: 2, skipped: 1, errors: 2 }, ignoredColumns: ['colour'] });
    const rows = rowsBy(res.body);
    expect(rows[2]).toMatchObject({ status: 'created', label: 'RM-PP-H110 · PP homopolymer granules H110' });
    expect(rows[4].errors[0]).toMatchObject({ column: 'gst_rate' });
    expect(rows[5].errors[0]).toMatchObject({ column: 'base_unit', message: expect.stringContaining('BUCKETS') });
    // The same item twice in one file: the second row matches the first.
    expect(rows[6]).toMatchObject({ status: 'skipped', message: 'Already exists as RM-PP-H110' });
    expect((await a.client.get('/masters/items?q=granules')).body.items).toHaveLength(0);
  });

  it('refuses to commit with errors unless asked to skip them', async () => {
    const blocked = await a.client.upload('/imports/items/commit', 'items.csv', file, 'text/csv');
    expect(blocked.body.committed).toBe(false);
    expect((await a.client.get('/masters/items?q=granules')).body.items).toHaveLength(0);

    const res = await a.client.upload('/imports/items/commit?skipInvalid=true', 'items.csv', file, 'text/csv');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.committed).toBe(true);
    const item = (await a.client.get('/masters/items?q=RM-PP-H110')).body.items[0];
    const full = (await a.client.get(`/masters/items/${item.id}`)).body;
    expect(full).toMatchObject({ code: 'RM-PP-H110', type: 'raw_material', gstRate: '18.00', trackBatch: true, reorderLevel: '500.0000' });
    expect(full.conversions[0]).toMatchObject({ uom: 'BAG', factor: '25.000000' });
    const box = (await a.client.get('/masters/items?q=Corrugated')).body.items[0];
    expect(box).toMatchObject({ code: 'ITM00001', type: 'packing_material', baseUom: 'NOS', group: 'Packing materials' });
  });

  it('skips items that already exist when the file is uploaded again', async () => {
    const res = await a.client.upload('/imports/items/preview', 'items.csv', file, 'text/csv');
    expect(res.body.summary).toMatchObject({ created: 0, skipped: 3, errors: 2 });
    expect(rowsBy(res.body)[2].message).toContain('RM-PP-H110');
  });

  it('checks the header and ignores the template example row', async () => {
    const missing = await a.client.upload('/imports/items/preview', 'x.csv', csv([['Code', 'Description'], ['A', 'B']]), 'text/csv');
    expect(missing.status).toBe(400);
    expect(missing.body.detail).toMatch(/Missing columns: Item name, Unit/);
    const template = await a.client.download('/imports/items/template?format=csv');
    const onlyExample = await a.client.upload('/imports/items/preview', 't.csv', template.bytes, 'text/csv');
    expect(onlyExample.status).toBe(400);
    expect(onlyExample.body.detail).toMatch(/example row/);
    expect((await a.client.upload('/imports/items/preview', 'x.pdf', 'hello')).status).toBe(400);
  });
});

describe('customers & vendors from Excel', () => {
  it('imports parties, deriving the state from the GSTIN', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Parties');
    ws.addRow(['Name *', 'Type *', 'GSTIN', 'Address line 1', 'City', 'State', 'PIN code', 'Credit days', 'Contact person', 'Phone']);
    ws.addRow(['Sharma Polymers', 'Vendor', '36AABCS1234E1ZU', 'Plot 14, IDA Jeedimetla', 'Hyderabad', '', '500055', '30 days', 'R. Sharma', '9848012345']);
    ws.addRow(['Retail walk-in', 'customer', '', 'MG Road', 'Pune', 'Maharashtra', 411001, '', '', '']);
    ws.addRow(['Typo Traders', 'Vendor', '36AABCS1234E1ZX', '', '', '', '', '', '', '']);
    ws.addRow(['No Type Ltd', '', '', '', '', '', '', '', '', '']);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());

    const res = await a.client.upload('/imports/parties/commit?skipInvalid=true', 'parties.xlsx', buf);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ committed: true, summary: { created: 2, errors: 2 } });
    const rows = rowsBy(res.body);
    expect(rows[4].errors[0]).toMatchObject({ column: 'gstin' });
    expect(rows[5].errors[0]).toMatchObject({ column: 'type' });

    const vendor = (await a.client.get(`/masters/parties/${rows[2].ref.id}`)).body;
    expect(vendor).toMatchObject({ code: 'VEN00001', isVendor: true, gstRegistrationType: 'regular', pan: 'AABCS1234E', creditDays: 30 });
    expect(vendor.addresses[0]).toMatchObject({ stateCode: '36', city: 'Hyderabad', pincode: '500055' });
    expect(vendor.contacts[0]).toMatchObject({ name: 'R. Sharma' });
    const customer = (await a.client.get(`/masters/parties/${rows[3].ref.id}`)).body;
    expect(customer).toMatchObject({ isCustomer: true, gstRegistrationType: 'unregistered' });
    expect(customer.addresses[0].stateCode).toBe('27');

    const again = await a.client.upload('/imports/parties/preview', 'parties.xlsx', buf);
    expect(rowsBy(again.body)[2]).toMatchObject({ status: 'skipped', message: expect.stringContaining('same GSTIN') });
  });
});

describe('opening stock import', () => {
  it('creates one opening entry per warehouse and can post it', async () => {
    const file = csv([
      ['Item code', 'Warehouse', 'Qty', 'Unit', 'Rate', 'Batch no', 'Mfg date'],
      ['RM-PP-H110', 'MAIN', '40', 'BAG', '2450', 'B2603-17', '15-03-2026'],
      ['ITM00001', 'main', '1,200', '', '18.5', '', ''],
      ['RM-PP-H110', 'MAIN', '10', '', '98', '', ''],
      ['ITM00001', 'NOWHERE', '5', '', '18', '', ''],
    ]);
    const res = await a.client.upload('/imports/opening-stock/commit?skipInvalid=true&post=true&postingDate=2026-04-01', 'opening.csv', file, 'text/csv');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = rowsBy(res.body);
    expect(rows[4].errors[0]).toMatchObject({ column: 'batch_no' });
    expect(rows[5].errors[0]).toMatchObject({ column: 'warehouse' });
    expect(rows[2]).toMatchObject({ status: 'created', message: expect.stringMatching(/^Posted in SE\//) });
    expect(rows[2].ref.id).toBe(rows[3].ref.id);

    const entry = (await a.client.get(`/inventory/stock-entries/${rows[2].ref.id}`)).body;
    expect(entry).toMatchObject({ status: 'approved', purpose: 'opening_stock', docDate: '2026-04-01', amount: '120200.00' });
    const resin = (await a.client.get('/inventory/stock?q=RM-PP-H110')).body.items[0];
    expect(resin).toMatchObject({ qty: '1000.0000', value: '98000.00' }); // 40 BAG × 25 KG
  });
});

// A small TallyPrime masters export, saved the way Tally writes it: UTF-16 with control-character entities.
const TALLY_XML = `<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
  <REQUESTDATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><UNIT NAME="Kgs"><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES> 3</DECIMALPLACES><GSTREPUOM>KGS-KILOGRAMS</GSTREPUOM></UNIT></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><UNIT NAME="Coil"><ISSIMPLEUNIT>Yes</ISSIMPLEUNIT><DECIMALPLACES> 0</DECIMALPLACES><GSTREPUOM>ROL-ROLLS</GSTREPUOM></UNIT></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><UNIT NAME="Coil of 25 Kgs"><ISSIMPLEUNIT>No</ISSIMPLEUNIT></UNIT></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKGROUP NAME="Wires" RESERVEDNAME=""><PARENT>Copper Products</PARENT></STOCKGROUP></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKGROUP NAME="Copper Products" RESERVEDNAME=""><PARENT>&#4; Primary</PARENT>
     <GSTDETAILS.LIST><APPLICABLEFROM>20170701</APPLICABLEFROM><HSNCODE>7408</HSNCODE>
      <STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATE> 18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST>
     </GSTDETAILS.LIST></STOCKGROUP></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><GODOWN NAME="Main Location"></GODOWN></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><GODOWN NAME="Unit 2 Store"><PARENT>&#4; Primary</PARENT></GODOWN></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="Enamelled Copper Wire 0.5mm" RESERVEDNAME="">
     <PARENT>Wires</PARENT><BASEUNITS>Kgs</BASEUNITS><ADDITIONALUNITS>Coil</ADDITIONALUNITS><DENOMINATOR> 25</DENOMINATOR><CONVERSION> 1</CONVERSION>
     <ISBATCHWISEON>No</ISBATCHWISEON>
     <OPENINGBALANCE> 150 Kgs</OPENINGBALANCE><OPENINGVALUE>-127500.00</OPENINGVALUE><OPENINGRATE>850.00/Kgs</OPENINGRATE>
     <GSTDETAILS.LIST><APPLICABLEFROM>20170701</APPLICABLEFROM><HSNCODE>74081990</HSNCODE><TAXABILITY>Taxable</TAXABILITY>
      <STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>
       <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATE> 9</GSTRATE></RATEDETAILS.LIST>
       <RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATE> 18</GSTRATE></RATEDETAILS.LIST>
      </STATEWISEDETAILS.LIST></GSTDETAILS.LIST>
     <LANGUAGENAME.LIST><NAME.LIST TYPE="String"><NAME>Enamelled Copper Wire 0.5mm</NAME><NAME>CW-05</NAME></NAME.LIST></LANGUAGENAME.LIST>
     <BATCHALLOCATIONS.LIST><GODOWNNAME>Unit 2 Store</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><OPENINGBALANCE> 120 Kgs</OPENINGBALANCE><OPENINGVALUE>-102000.00</OPENINGVALUE><OPENINGRATE>850.00/Kgs</OPENINGRATE></BATCHALLOCATIONS.LIST>
     <BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><OPENINGBALANCE> 30 Kgs</OPENINGBALANCE><OPENINGVALUE>-25500.00</OPENINGVALUE><OPENINGRATE>850.00/Kgs</OPENINGRATE></BATCHALLOCATIONS.LIST>
   </STOCKITEM></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="Insulating Varnish" RESERVEDNAME=""><PARENT>&#4; Primary</PARENT><BASEUNITS>Ltr</BASEUNITS>
     <ISBATCHWISEON>Yes</ISBATCHWISEON><ISPERISHABLEON>Yes</ISPERISHABLEON>
     <BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>V-2603</BATCHNAME><MFDON P="1-Mar-2026">1-Mar-2026</MFDON><EXPIRYPERIOD P="31-Mar-2027">31-Mar-2027</EXPIRYPERIOD><OPENINGBALANCE> 40 Ltr</OPENINGBALANCE><OPENINGVALUE>-12000.00</OPENINGVALUE><OPENINGRATE>300.00/Ltr</OPENINGRATE></BATCHALLOCATIONS.LIST>
   </STOCKITEM></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><GROUP NAME="Hyderabad Creditors"><PARENT>Sundry Creditors</PARENT></GROUP></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Sharma Polymers" RESERVEDNAME="">
     <ADDRESS.LIST TYPE="String"><ADDRESS>Plot 14, IDA Jeedimetla</ADDRESS><ADDRESS>Hyderabad</ADDRESS></ADDRESS.LIST>
     <MAILINGNAME.LIST TYPE="String"><MAILINGNAME>Sharma Polymers Pvt Ltd</MAILINGNAME></MAILINGNAME.LIST>
     <PARENT>Hyderabad Creditors</PARENT><LEDSTATENAME>Telangana</LEDSTATENAME><PINCODE>500055</PINCODE><COUNTRYNAME>India</COUNTRYNAME>
     <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PARTYGSTIN>36AABCS1234E1ZU</PARTYGSTIN><INCOMETAXNUMBER>AABCS1234E</INCOMETAXNUMBER>
     <BILLCREDITPERIOD>45 Days</BILLCREDITPERIOD><LEDGERMOBILE>9848012345</LEDGERMOBILE><LEDGERCONTACT>R. Sharma</LEDGERCONTACT>
     <OPENINGBALANCE>125000.00</OPENINGBALANCE>
   </LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Patel Electricals"><PARENT>Sundry Debtors</PARENT>
     <LEDMAILINGDETAILS.LIST><APPLICABLEFROM>20240401</APPLICABLEFROM><ADDRESS.LIST TYPE="String"><ADDRESS>12 Ring Road</ADDRESS><ADDRESS>Surat</ADDRESS></ADDRESS.LIST><STATE>Gujarat</STATE><PINCODE>395002</PINCODE><COUNTRY>India</COUNTRY></LEDMAILINGDETAILS.LIST>
     <LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20240401</APPLICABLEFROM><GSTREGISTRATIONTYPE>Unregistered/Consumer</GSTREGISTRATIONTYPE></LEDGSTREGDETAILS.LIST>
   </LEDGER></TALLYMESSAGE>
   <TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Cash"><PARENT>Cash-in-Hand</PARENT></LEDGER></TALLYMESSAGE>
  </REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>`;

const utf16 = (s: string) => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    out[2 + i * 2] = s.charCodeAt(i) & 0xff;
    out[3 + i * 2] = s.charCodeAt(i) >> 8;
  }
  return out;
};

describe('Tally import', () => {
  it('previews every master type', async () => {
    const res = await a.client.upload('/imports/tally/preview?includeOpeningStock=true', 'Master.xml', utf16(TALLY_XML), 'text/xml');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sections = Object.fromEntries(res.body.sections.map((s: any) => [s.key, s]));
    expect(Object.keys(sections)).toEqual(['units', 'groups', 'warehouses', 'items', 'parties', 'opening_stock']);
    expect(sections.units.rows.map((r: any) => [r.label, r.status])).toEqual([
      ['Kgs → KG', 'skipped'],
      ['Coil → COIL', 'created'],
    ]);
    expect(sections.groups.rows.map((r: any) => r.label)).toEqual(['COPPER-PRODUCTS · Copper Products', 'WIRES · Wires']);
    // The varnish has no GST anywhere in Tally.
    const varnish = sections.items.rows.find((r: any) => r.label.includes('Varnish'));
    expect(varnish.errors[0]).toMatchObject({ column: 'gst_rate' });
    expect(res.body.ignored).toEqual({ ledgers: 1, compoundUnits: 1 });
    expect(res.body.committed).toBe(false);
  });

  it('imports with a default GST rate, including opening stock per godown', async () => {
    const res = await a.client.upload('/imports/tally/commit?includeOpeningStock=true&defaultGstRate=18&post=true&defaultItemType=raw_material', 'Master.xml', utf16(TALLY_XML), 'text/xml');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.summary.errors, JSON.stringify(res.body.sections.flatMap((s: any) => s.rows.filter((r: any) => r.errors.length)))).toBe(0);
    expect(res.body.committed).toBe(true);

    const wire = (await a.client.get('/masters/items?q=CW-05')).body.items[0];
    const full = (await a.client.get(`/masters/items/${wire.id}`)).body;
    expect(full).toMatchObject({ code: 'CW-05', hsnCode: '74081990', gstRate: '18.00', type: 'raw_material' });
    expect(full.conversions[0]).toMatchObject({ uom: 'COIL', factor: '25.000000' });
    const varnish = (await a.client.get('/masters/items?q=Varnish')).body.items[0];
    expect(varnish).toMatchObject({ gstRate: '18.00', trackBatch: true, baseUom: 'LTR' });

    const whs = (await a.client.get('/inventory/warehouses')).body;
    const unit2 = whs.find((w: any) => w.code === 'UNIT-2-STORE');
    expect(unit2).toBeTruthy();
    const stock = (await a.client.get(`/inventory/stock/${wire.id}`)).body.byWarehouse.map((w: any) => [w.code, w.qty, w.value]);
    expect(stock).toEqual([
      ['MAIN', '30.0000', '25500.00'],
      ['UNIT-2-STORE', '120.0000', '102000.00'],
    ]);
    const batches = (await a.client.get(`/inventory/batches?itemId=${varnish.id}`)).body;
    expect(batches[0]).toMatchObject({ batchNo: 'V-2603', expiryDate: '2027-03-31', mfgDate: '2026-03-01' });

    const parties = (await a.client.get('/masters/parties?q=Patel')).body.items;
    expect(parties[0]).toMatchObject({ isCustomer: true });
    const patel = (await a.client.get(`/masters/parties/${parties[0].id}`)).body;
    expect(patel.addresses[0]).toMatchObject({ line1: '12 Ring Road, Surat', city: 'Surat', stateCode: '24' });
    // Sharma Polymers was already imported from Excel (same GSTIN), so it is skipped.
    const sharma = res.body.sections.find((s: any) => s.key === 'parties').rows.find((r: any) => r.label.includes('Sharma'));
    expect(sharma.status).toBe('skipped');
  });

  it('rejects files that are not Tally XML', async () => {
    const res = await a.client.upload('/imports/tally/preview', 'x.xml', '<html></html>', 'text/xml');
    expect(res.status).toBe(400);
  });
});

describe('purchase requisition lines linked to items', () => {
  it('fills code and purchase unit from the item master', async () => {
    const resin = (await a.client.get('/masters/items?q=RM-PP-H110')).body.items[0];
    const uoms = Object.fromEntries((await a.client.get('/masters/uoms')).body.map((u: any) => [u.code, u.id]));
    const res = await a.client.post('/purchase/requisitions', {
      lines: [
        { itemId: resin.id, description: 'PP granules', uom: 'x', quantity: '8' },
        { description: 'Pallet wrap, one-off', uom: 'ROLL', quantity: '2' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.lines[0]).toMatchObject({ itemId: resin.id, itemCode: 'RM-PP-H110', uom: 'BAG', uomId: uoms.BAG });
    expect(res.body.lines[1]).toMatchObject({ itemId: null, uom: 'ROLL' });

    const bad = await a.client.post('/purchase/requisitions', { lines: [{ itemId: resin.id, uomId: uoms.LTR, description: 'PP granules', uom: 'LTR', quantity: '1' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toBe('lines.0.uomId');
  });
});
