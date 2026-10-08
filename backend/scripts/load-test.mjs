#!/usr/bin/env node
/**
 * Load test: concurrent users hitting the busiest read endpoints, with p50 / p95 / p99 per
 * endpoint against the 300 ms budget. Creates a throwaway "e2e-load-…" workspace (remove it
 * afterwards with `npm run purge:test-tenants -w database`).
 *
 *   node scripts/load-test.mjs [--users 50] [--seconds 30] [--budget 300] [--set core|enterprise|all] [--api http://localhost:4000/api/v1]
 */
import { randomBytes } from 'node:crypto';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const API = arg('api', process.env.API_URL ?? 'http://localhost:4000/api/v1');
const USERS = Number(arg('users', 50));
const SECONDS = Number(arg('seconds', 30));
const BUDGET = Number(arg('budget', 300));
const SET = arg('set', 'all');

const id = randomBytes(3).toString('hex');
async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ---- a small workspace with something to read ---------------------------------------------
const password = `Pw-${randomBytes(9).toString('base64url')}9a`;
const signup = await call('POST', '/auth/signup', null, { workspaceName: `Load ${id}`, slug: `e2e-load-${id}`, companyName: `Load ${id} Pvt Ltd`, industry: 'engineering', fullName: 'Load Tester', email: `e2e-load-${id}@test.local`, password });
if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
const token = signup.body.accessToken;
const uoms = (await call('GET', '/masters/uoms', token)).body;
const nos = uoms.find((u) => u.code === 'NOS').id;
const whs = (await call('GET', '/inventory/warehouses', token)).body;
const lines = [];
for (let i = 0; i < 40; i++) {
  const it = await call('POST', '/masters/items', token, { name: `Load item ${i}`, type: 'raw_material', baseUomId: nos, gstRate: 18, hsnCode: '73181500' });
  lines.push({ itemId: it.body.id, qty: String(100 + i), rate: String(5 + i) });
}
const entry = await call('POST', '/inventory/stock-entries', token, { purpose: 'opening_stock', toWarehouseId: whs.find((w) => w.code === 'MAIN').id, lines });
await call('POST', `/inventory/stock-entries/${entry.body.id}/submit`, token, { version: entry.body.version });

const CORE = [
  '/auth/me',
  '/masters/items?limit=50',
  '/inventory/warehouses',
  '/purchase/orders?limit=50',
  '/sales/orders?limit=50',
  '/dashboards/view?preset=owner',
  '/reports/stock-summary',
  '/reports/stock-movement',
  '/manufacturing/shop-floor',
  '/documents/approvals/inbox',
];
// Phases 12–15: agents, regulated packs, enterprise finance, projects, PLM, marketplace, POS.
const ENTERPRISE = [
  '/mobile/summary',
  '/projects',
  '/finance/treasury',
  '/finance/intercompany/reconciliation',
  '/esg/brsr',
  '/esg/footprint',
  '/compliance/materials',
  '/plm/items',
  '/doc-store/files',
  '/apps',
  '/automations',
  '/pos/terminals',
  '/textile/orders',
  '/food/haccp',
  '/hse/sds',
  '/ai/inbox',
];
const ENDPOINTS = SET === 'core' ? CORE : SET === 'enterprise' ? ENTERPRISE : [...CORE, ...ENTERPRISE];

// ---- run -----------------------------------------------------------------------------------
const samples = new Map(ENDPOINTS.map((e) => [e, []]));
const errors = new Map(ENDPOINTS.map((e) => [e, 0]));
const stopAt = Date.now() + SECONDS * 1000;
console.log(`Load test: ${USERS} users × ${SECONDS}s against ${API} (budget p95 < ${BUDGET} ms)`);
await Promise.all(
  Array.from({ length: USERS }, async (_, u) => {
    let i = u;
    while (Date.now() < stopAt) {
      const path = ENDPOINTS[i++ % ENDPOINTS.length];
      const t0 = performance.now();
      try {
        const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
        await res.arrayBuffer();
        if (!res.ok) errors.set(path, errors.get(path) + 1);
      } catch {
        errors.set(path, errors.get(path) + 1);
      }
      samples.get(path).push(performance.now() - t0);
    }
  }),
);

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};
let worst = 0;
let total = 0;
const rows = ENDPOINTS.map((e) => {
  const xs = samples.get(e);
  total += xs.length;
  const p95 = pct(xs, 95);
  worst = Math.max(worst, p95);
  return { endpoint: e, requests: xs.length, errors: errors.get(e), p50: Math.round(pct(xs, 50)), p95: Math.round(p95), p99: Math.round(pct(xs, 99)), ok: p95 <= BUDGET ? 'yes' : 'NO' };
});
console.table(rows);
console.log(`${total} requests, ${(total / SECONDS).toFixed(0)} req/s. Worst p95 ${Math.round(worst)} ms.`);
console.log(`Workspace e2e-load-${id} was created for this run; remove it with: npm run purge:test-tenants -w database`);
process.exit(worst <= BUDGET && [...errors.values()].every((n) => n === 0) ? 0 : 1);
