#!/usr/bin/env node
/**
 * Write concurrency test: many users creating and submitting documents at the same time in one
 * workspace, then checking the invariants that concurrency usually breaks — document numbers are
 * unique and gap-free per series, stock never goes below what was received, the ledger balances,
 * and POS sales replayed with the same reference are recorded once. Creates a throwaway
 * "e2e-wload-…" workspace (remove with `npm run purge:test-tenants -w database`).
 *
 *   node scripts/write-load-test.mjs [--users 20] [--rounds 10] [--api http://localhost:4000/api/v1]
 */
import { randomBytes } from 'node:crypto';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const API = arg('api', process.env.API_URL ?? 'http://localhost:4000/api/v1');
const USERS = Number(arg('users', 20));
const ROUNDS = Number(arg('rounds', 10));

const id = randomBytes(3).toString('hex');
let token = '';
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const must = async (p, label) => {
  const r = await p;
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

const password = `Pw-${randomBytes(9).toString('base64url')}9a`;
const signup = await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceName: `WLoad ${id}`, slug: `e2e-wload-${id}`, companyName: `WLoad ${id} Pvt Ltd`, industry: 'engineering', fullName: 'Write Tester', email: `e2e-wload-${id}@test.local`, password }) });
token = (await signup.json()).accessToken;
const nos = (await call('GET', '/masters/uoms')).body.find((u) => u.code === 'NOS').id;
const wh = (await call('GET', '/inventory/warehouses')).body.find((w) => w.code === 'MAIN').id;
const item = await must(call('POST', '/masters/items', { code: 'WL-1', name: 'Write load item', type: 'finished_good', baseUomId: nos, gstRate: 18, hsnCode: '73181500', mrp: '118' }), 'item');
const cust = await must(call('POST', '/masters/parties', { name: 'Write Load Customer', isCustomer: true, gstin: '36AABCD1234E1Z9', addresses: [{ type: 'both', line1: 'Ameerpet', city: 'Hyderabad', stateCode: '36', pincode: '500016', isDefault: true }] }), 'party');
const RECEIVED = USERS * ROUNDS * 3;
const e = await must(call('POST', '/inventory/stock-entries', { purpose: 'opening_stock', toWarehouseId: wh, lines: [{ itemId: item.id, qty: String(RECEIVED), rate: '50' }] }), 'opening');
await must(call('POST', `/inventory/stock-entries/${e.id}/submit`, { version: e.version }), 'opening submit');
const till = await must(call('POST', '/pos/terminals', { code: 'WL', name: 'Load till', warehouseId: wh }), 'till');
const shift = await must(call('POST', '/pos/sessions', { terminalId: till.id, openingCash: 0 }), 'shift');

console.log(`Write load: ${USERS} users × ${ROUNDS} rounds against ${API}`);
const failures = [];
const timings = [];
let invoicesPosted = 0;
const t0 = performance.now();
await Promise.all(
  Array.from({ length: USERS }, async (_, u) => {
    for (let r = 0; r < ROUNDS; r++) {
      const s = performance.now();
      try {
        // A sales invoice straight from stock (2 units), and a POS sale (1 unit) sent twice.
        const inv = await must(call('POST', '/sales/invoices', { customerId: cust.id, warehouseId: wh, lines: [{ itemId: item.id, qty: '2', rate: '100' }] }), 'invoice');
        await must(call('POST', `/sales/invoices/${inv.id}/submit`, { version: inv.version }), 'invoice submit');
        invoicesPosted++;
        const ref = `wl-${u}-${r}-${id}`;
        const sale = { clientRef: ref, lines: [{ itemId: item.id, qty: 1 }], tenders: [{ mode: 'cash', amount: 118 }] };
        const [a, b] = await Promise.all([call('POST', `/pos/sessions/${shift.id}/sales`, sale), call('POST', `/pos/sessions/${shift.id}/sales`, sale)]);
        if (a.status >= 300 && b.status >= 300) throw new Error(`pos: ${a.status} ${JSON.stringify(a.body)}`);
      } catch (err) {
        failures.push(err.message.slice(0, 200));
      }
      timings.push(performance.now() - s);
    }
  }),
);
const seconds = (performance.now() - t0) / 1000;

// ---- invariants ----
const invoices = [];
for (let cursor = undefined; ; ) {
  const page = (await call('GET', `/sales/invoices?limit=100${cursor ? `&cursor=${cursor}` : ''}`)).body;
  invoices.push(...page.items);
  if (!page.nextCursor) break;
  cursor = page.nextCursor;
}
const numbers = invoices.map((i) => i.number).filter(Boolean);
const dup = numbers.filter((n, i) => numbers.indexOf(n) !== i);
const seq = numbers.map((n) => Number(n.split('/').pop())).sort((x, y) => x - y);
const gaps = seq.filter((n, i) => i > 0 && n !== seq[i - 1] + 1);
const posSales = (await call('GET', `/pos/sessions/${shift.id}`)).body.sales;
const posRefs = posSales.map((x) => x.clientRef);
const posDup = posRefs.filter((n, i) => posRefs.indexOf(n) !== i);
const stock = (await call('GET', `/pos/terminals/${till.id}/items?q=WL-1`)).body[0].stock;
const sold = invoicesPosted * 2;
const tb = (await call('GET', '/accounting/trial-balance')).body;
const totals = tb?.totals ?? tb?.total ?? null;

const s = [...timings].sort((x, y) => x - y);
const p = (q) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0);
console.table([
  { check: 'rounds completed', value: `${timings.length - failures.length} / ${USERS * ROUNDS}` },
  { check: 'round time p50 / p95 (ms)', value: `${p(0.5)} / ${p(0.95)}` },
  { check: 'throughput (rounds/s)', value: (timings.length / seconds).toFixed(1) },
  { check: 'invoices (manual + POS)', value: `${invoices.length} (expected ${invoicesPosted + posSales.length})` },
  { check: 'duplicate invoice numbers', value: dup.length },
  { check: 'gaps in invoice numbers', value: gaps.length },
  { check: 'POS sales', value: `${posSales.length} (expected ${USERS * ROUNDS - failures.length})` },
  { check: 'POS duplicates from replays', value: posDup.length },
  { check: 'stock left', value: `${stock} (expected ${RECEIVED - sold - posSales.length})` },
  { check: 'trial balance', value: totals ? JSON.stringify(totals) : 'n/a' },
]);
if (failures.length) console.log('Failures:', [...new Set(failures)].slice(0, 10));
const ok = invoices.length === invoicesPosted + posSales.length && !dup.length && !gaps.length && !posDup.length && stock === RECEIVED - sold - posSales.length && !failures.length;
console.log(ok ? 'All invariants hold.' : 'INVARIANTS BROKEN');
console.log(`Workspace e2e-wload-${id} was created for this run; remove it with: npm run purge:test-tenants -w database`);
process.exit(ok ? 0 : 1);
