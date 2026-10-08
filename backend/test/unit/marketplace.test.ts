import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NextGenClient, NextGenError, verifyWebhook } from '../../../sdk/src/index';
import { holds, matches, pick, render } from '../../src/modules/marketplace/automation-rules';
import { fromIndiaMart, fromShopify, genericSignatureOk, sampleOrders, sandboxAwb, shopifySignatureOk, tallyMastersXml } from '../../src/modules/marketplace/connectors';

describe('automation rules', () => {
  const p = { event: 'document.approved', docType: 'purchase_order', amount: '125000.00', number: 'PO/26-27/0042', tags: 'urgent,capex' };
  it('evaluates conditions', () => {
    expect(pick({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(holds({ field: 'amount', op: 'gt', value: 100000 }, p)).toBe(true);
    expect(holds({ field: 'amount', op: 'lte', value: '100000' }, p)).toBe(false);
    expect(holds({ field: 'docType', op: 'in', value: ['purchase_order', 'sales_order'] }, p)).toBe(true);
    expect(holds({ field: 'docType', op: 'in', value: 'sales_order, sales_invoice' }, p)).toBe(false);
    expect(holds({ field: 'tags', op: 'contains', value: 'URGENT' }, p)).toBe(true);
    expect(holds({ field: 'missing', op: 'exists' }, p)).toBe(false);
    expect(matches([], p)).toBe(true);
    expect(matches([{ field: 'docType', op: 'eq', value: 'purchase_order' }, { field: 'amount', op: 'gte', value: 200000 }], p)).toBe(false);
  });

  it('renders placeholders', () => {
    expect(render('{{number}} approved for ₹{{ amount }}{{nope}}', p)).toBe('PO/26-27/0042 approved for ₹125000.00');
  });
});

describe('connectors', () => {
  it('maps Shopify orders and checks their signatures', () => {
    const o = fromShopify({ id: 5512, name: '#1042', email: 'asha@example.in', created_at: '2026-10-08T10:00:00+05:30', customer: { first_name: 'Asha', last_name: 'Nair' }, line_items: [{ sku: 'TEE-M', title: 'Tee M', quantity: 2, price: '499.00' }] });
    expect(o).toEqual({ id: '5512', name: '#1042', createdAt: '2026-10-08T10:00:00+05:30', customer: { name: 'Asha Nair', email: 'asha@example.in', phone: null }, lines: [{ sku: 'TEE-M', title: 'Tee M', qty: 2, price: 499 }] });
    const raw = Buffer.from(JSON.stringify({ id: 1 }));
    const sig = createHmac('sha256', 's3cret').update(raw).digest('base64');
    expect(shopifySignatureOk(raw, sig, 's3cret')).toBe(true);
    expect(shopifySignatureOk(raw, sig, 'other')).toBe(false);
    expect(shopifySignatureOk(raw, undefined, 's3cret')).toBe(false);
    expect(genericSignatureOk(raw, `sha256=${createHmac('sha256', 'k').update(raw).digest('hex')}`, 'k')).toBe(true);
  });

  it('maps IndiaMART leads, makes sandbox data and Tally XML', () => {
    expect(fromIndiaMart({ UNIQUE_QUERY_ID: '9001', SENDER_NAME: 'Ravi', SENDER_MOBILE: '+91-9876543210', QUERY_PRODUCT_NAME: 'Boxes' })).toMatchObject({ id: '9001', name: 'Ravi', phone: '+91 9876543210', product: 'Boxes' });
    const a = sampleOrders('shopify', ['A', 'B'], '2026-10-08');
    expect(sampleOrders('shopify', ['A', 'B'], '2026-10-08')).toEqual(a);
    expect(a[1].lines.map((l) => l.sku)).toEqual(['A', 'B']);
    expect(sandboxAwb('delhivery', 'd1').awb).toMatch(/^DL\d{10}$/);
    const xml = tallyMastersXml('Acme & Co', [{ name: 'Rao <Traders>', isCustomer: true, gstin: '36AABCD1234E1Z9', stateName: 'Telangana' }], [{ name: 'Bolt M8', uom: 'NOS', hsn: '73181500', gstRate: 18 }]);
    expect(xml).toContain('<SVCURRENTCOMPANY>Acme &amp; Co</SVCURRENTCOMPANY>');
    expect(xml).toContain('<LEDGER NAME="Rao &lt;Traders&gt;" ACTION="Create">');
    expect(xml).toContain('<PARENT>Sundry Debtors</PARENT>');
    expect(xml).toContain('<HSNCODE>73181500</HSNCODE>');
  });
});

describe('SDK', () => {
  it('verifies webhook signatures made by the server and refuses replays', async () => {
    const body = JSON.stringify({ event: 'document.approved' });
    const t = 1_790_000_000;
    const header = `t=${t},v1=${createHmac('sha256', 'whsec').update(`${t}.${body}`).digest('hex')}`;
    expect(await verifyWebhook(body, header, 'whsec', 300, t * 1000)).toBe(true);
    expect(await verifyWebhook(body, header, 'other', 300, t * 1000)).toBe(false);
    expect(await verifyWebhook(`${body} `, header, 'whsec', 300, t * 1000)).toBe(false);
    expect(await verifyWebhook(body, header, 'whsec', 300, (t + 600) * 1000)).toBe(false);
  });

  it('retries server errors, paginates and raises problem details', async () => {
    const calls: string[] = [];
    let n = 0;
    const fake = (async (url: URL) => {
      calls.push(`${url.pathname}${url.search}`);
      n++;
      if (n === 1) return new Response('', { status: 503, headers: { 'retry-after': '0' } });
      if (url.pathname.endsWith('/masters/items') && !url.searchParams.get('cursor')) return Response.json({ items: [{ id: '1' }, { id: '2' }], nextCursor: '2' });
      if (url.pathname.endsWith('/masters/items')) return Response.json({ items: [{ id: '3' }], nextCursor: null });
      return Response.json({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'API key lacks scope' }, { status: 403 });
    }) as unknown as typeof fetch;
    const erp = new NextGenClient({ apiKey: 'ngk_test_x', baseUrl: 'https://erp.example/api/v1/', fetch: fake });
    const ids: string[] = [];
    for await (const i of erp.paginate(erp.items.list, { q: 'bolt' })) ids.push(i.id);
    expect(ids).toEqual(['1', '2', '3']);
    expect(calls).toEqual(['/api/v1/masters/items?q=bolt', '/api/v1/masters/items?q=bolt', '/api/v1/masters/items?q=bolt&cursor=2']);
    await expect(erp.salesOrders.get('x')).rejects.toMatchObject({ status: 403, message: 'API key lacks scope' });
    await expect(erp.salesOrders.get('x')).rejects.toBeInstanceOf(NextGenError);
    expect(() => new NextGenClient({ apiKey: 'bad', baseUrl: 'x' })).toThrow('ngk_');
  });
});
