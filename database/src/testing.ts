import type { Pool } from 'pg';

/**
 * Deletes everything belonging to the given tenants (test/dev cleanup only;
 * runs as the owner role). Discovers every table with a tenant_id column and
 * deletes in dependency order by retrying tables blocked by foreign keys, so
 * new tables never need to be added by hand.
 */
export async function purgeTenants(pool: Pool, tenantIds: string[], userEmails: string[] = []) {
  if (!tenantIds.length) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'tenant_id'`,
    );
    let pending = rows.map((r) => r.table_name);
    for (let pass = 0; pending.length && pass < 20; pass++) {
      const blocked: string[] = [];
      for (const table of pending) {
        await client.query('savepoint purge');
        try {
          await client.query(`delete from "${table}" where tenant_id = any($1::uuid[])`, [tenantIds]);
          await client.query('release savepoint purge');
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code !== '23503' && code !== '23001') throw err; // only FK ordering issues (NO ACTION / RESTRICT) are retried
          await client.query('rollback to savepoint purge');
          blocked.push(table);
        }
      }
      pending = blocked;
    }
    if (pending.length) throw new Error(`Could not purge tables: ${pending.join(', ')}`);
    await client.query('delete from tenants where id = any($1::uuid[])', [tenantIds]);
    if (userEmails.length) {
      await client.query(
        'delete from users u where u.email = any($1::citext[]) and not exists (select 1 from memberships m where m.user_id = u.id)',
        [userEmails],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
