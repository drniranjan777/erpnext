/**
 * Dev utility: removes workspaces left behind by interrupted test runs
 * (slugs starting with "rls-" or "e2e-"). Usage: npm run purge:test-tenants -w database
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { purgeTenants } from '../src/testing';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  try {
    const r = await pool.query<{ id: string }>("select id from tenants where slug like 'rls-%' or slug like 'e2e-%'");
    await purgeTenants(pool, r.rows.map((x) => x.id));
    await pool.query("delete from users u where (u.email like 'rls-%@test.local' or u.email like 'e2e-%@test.local') and not exists (select 1 from memberships m where m.user_id = u.id)");
    const left = await pool.query<{ slug: string }>('select slug from tenants order by created_at');
    console.log(`Purged ${r.rowCount} test workspace(s). Remaining: ${left.rows.map((x) => x.slug).join(', ')}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
