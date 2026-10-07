#!/usr/bin/env node
/**
 * MRP benchmark: a throwaway "e2e-mrp-…" workspace with 10,000 items in three levels
 * (2,000 finished goods → 1,000 sub-assemblies → 7,000 raw materials) and four months of
 * forecast on every finished good, then one MRP run through the API. Items and BOMs are
 * written straight into the database (owner connection from database/.env) because creating
 * 3,000 BOMs over HTTP would take longer than the run. Remove the workspace afterwards with
 * `npm run purge:test-tenants -w database`.
 *
 *   node scripts/mrp-bench.mjs [--fg 2000] [--sf 1000] [--rm 7000] [--budget 120] [--api http://localhost:4000/api/v1]
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const API = arg('api', process.env.API_URL ?? 'http://localhost:4000/api/v1');
const FG = Number(arg('fg', 2000));
const SF = Number(arg('sf', 1000));
const RM = Number(arg('rm', 7000));
const BUDGET = Number(arg('budget', 120));
const ownerUrl = process.env.DATABASE_OWNER_URL ?? readFileSync(join(import.meta.dirname, '..', '..', 'database', '.env'), 'utf8').match(/^DATABASE_OWNER_URL=(.*)$/m)?.[1];
if (!ownerUrl) throw new Error('DATABASE_OWNER_URL is not set');

const id = randomBytes(3).toString('hex');
async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const password = `Pw-${randomBytes(9).toString('base64url')}9a`;
const slug = `e2e-mrp-${id}`;
const signup = await call('POST', '/auth/signup', null, { workspaceName: `MRP ${id}`, slug, companyName: `MRP ${id} Pvt Ltd`, industry: 'engineering', fullName: 'MRP Bench', email: `${slug}@test.local`, password });
if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
const token = signup.body.accessToken;

const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const t0 = Date.now();
const c = await pool.connect();
try {
  const { rows: [t] } = await c.query(`select t.id as tenant, (select id from companies where tenant_id = t.id limit 1) as company, (select id from uoms where tenant_id = t.id and code = 'NOS') as nos from tenants t where t.slug = $1`, [slug]);
  const code = (p, n) => `'${p}' || lpad((${n})::text, 5, '0')`;
  await c.query('begin');
  await c.query(
    `insert into items (tenant_id, code, name, type, base_uom_id, lead_time_days, safety_stock)
     select $1::uuid, ${code('FG', 'g')}, 'Bench product ' || g, 'finished_good'::item_type, $2::uuid, 3, null::numeric from generate_series(1, $3::int) g
     union all select $1::uuid, ${code('SF', 'g')}, 'Bench sub-assembly ' || g, 'semi_finished'::item_type, $2::uuid, 2, null::numeric from generate_series(1, $4::int) g
     union all select $1::uuid, ${code('RM', 'g')}, 'Bench material ' || g, 'raw_material'::item_type, $2::uuid, 10, 5::numeric from generate_series(1, $5::int) g`,
    [t.tenant, t.nos, FG, SF, RM],
  );
  await c.query(`create temp table bench_bom on commit drop as select id as item_id, uuidv7() as bom_id, code::text as code, substr(code::text, 3)::int as n from items where tenant_id = $1 and (code like 'FG%' or code like 'SF%')`, [t.tenant]);
  await c.query(`insert into documents (id, tenant_id, company_id, doc_type, doc_date, status) select bom_id, $1, $2, 'bom', current_date, 'approved' from bench_bom`, [t.tenant, t.company]);
  await c.query(`insert into boms (id, tenant_id, item_id, quantity, is_default) select bom_id, $1, item_id, 1, true from bench_bom`, [t.tenant]);
  await c.query(
    `insert into bom_lines (tenant_id, bom_id, line_no, kind, item_id, qty, uom_id)
     select $1, b.bom_id, x.line_no, 'component', i.id, x.qty, $2
     from bench_bom b
     cross join lateral (
       select * from (values
         (1, case when b.code like 'FG%' then ${code('SF', `((b.n - 1) % ${SF}) + 1`)} else ${code('RM', `((b.n * 3) % ${RM}) + 1`)} end, 1.5),
         (2, case when b.code like 'FG%' then ${code('RM', `((b.n - 1) % ${RM}) + 1`)} end, 2.0),
         (3, case when b.code like 'FG%' then ${code('RM', `((b.n + 6) % ${RM}) + 1`)} end, 0.5)
       ) v(line_no, ccode, qty) where ccode is not null
     ) x
     join items i on i.tenant_id = $1 and i.code = x.ccode`,
    [t.tenant, t.nos],
  );
  await c.query(
    `insert into demand_forecasts (tenant_id, item_id, period, qty, stat_qty, method)
     select $1, i.id, to_char((now() at time zone 'Asia/Kolkata')::date + make_interval(months => m), 'YYYY-MM'), 50 + (substr(i.code::text, 3)::int % 20), null, 'bench'
     from items i cross join generate_series(0, 3) m where i.tenant_id = $1 and i.code like 'FG%'`,
    [t.tenant],
  );
  await c.query('commit');
  // A bulk load this size would be picked up by autovacuum; do it now so plans are realistic.
  await c.query('analyze items, documents, boms, bom_lines, demand_forecasts, planned_orders, mrp_item_plans, mrp_exceptions');
  console.log(`Seeded ${FG + SF + RM} items and ${FG + SF} BOMs in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) {
  await c.query('rollback');
  throw e;
} finally {
  c.release();
  await pool.end();
}

// Twice: the second run also replaces the first run's planned orders.
let secs = 0;
for (const n of [1, 2]) {
  const start = Date.now();
  const run = await call('POST', '/planning/mrp/runs', token, { horizonDays: 120 });
  const s = (Date.now() - start) / 1000;
  if (run.status !== 200) throw new Error(`MRP run failed: ${run.status} ${JSON.stringify(run.body)}`);
  const { items, plannedOrders, exceptions, loadMs, planMs, saveMs } = run.body.stats;
  console.log(`Run ${n}: ${s.toFixed(1)} s (budget ${BUDGET} s): ${items} items, ${plannedOrders} planned orders, ${exceptions} exceptions; load ${loadMs} ms, plan ${planMs} ms, save ${saveMs} ms`);
  secs = Math.max(secs, s);
}
console.log(secs <= BUDGET ? 'PASS' : 'FAIL');
process.exitCode = secs <= BUDGET ? 0 : 1;
