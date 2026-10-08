import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Transaction } from '@nextgen/database';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { CLEARED, EXCLUDED, HISTORY, insertionOrder, remap, type ExportFile, type ForeignKey } from './tenant-copy';
import { many } from '../../common/sql';

const CHUNK = 1000;

export const importSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/, 'Lowercase letters, digits and dashes'),
  name: z.string().trim().min(2).max(120).optional(),
});

/**
 * Workspace export and import (for moving a workspace between installations or regions), and sandbox
 * workspaces copied from production. Everything runs as the application role under row-level
 * security: the export reads only the current workspace, and the import writes only the new one.
 */
@Injectable()
export class TenantDataService {
  private readonly region: string;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService<Env, true>,
  ) {
    this.region = config.get('DATA_REGION', { infer: true });
  }

  residency(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [t] = await many<{ settings: Record<string, unknown> }>(tx, sql`select settings from tenants where id = ${auth.tenantId}`);
      return { region: this.region, sandboxOf: (t?.settings?.sandboxOf as string) ?? null, note: 'All data of the workspace (database, files, backups) is stored in this region. Moving to another region is done by exporting the workspace and importing it on an installation in that region.' };
    });
  }

  private async tenantTables(tx: Transaction) {
    const rows = await many<{ table_name: string }>(
      tx,
      sql`select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
          where c.table_schema = 'public' and c.column_name = 'tenant_id' order by c.table_name`,
    );
    return rows.map((r) => r.table_name).filter((t) => !EXCLUDED.has(t));
  }

  /** Everything of the current workspace as one JSON document. */
  async exportData(auth: AuthContext, opts: { history: boolean }): Promise<ExportFile> {
    return this.database.run(auth, async (tx) => {
      const [t] = await many<{ id: string; name: string; slug: string; industry: string | null; settings: Record<string, unknown> }>(tx, sql`select id, name, slug, industry, settings from tenants where id = ${auth.tenantId}`);
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const name of await this.tenantTables(tx)) {
        if (!opts.history && HISTORY.has(name)) continue;
        const [r] = await many<{ rows: Record<string, unknown>[] | null }>(tx, sql`select json_agg(x) as rows from ${sql.identifier(name)} x`);
        if (r.rows?.length) tables[name] = r.rows;
      }
      const users = await many<{ id: string; email: string; fullName: string }>(tx, sql`select u.id, u.email, u.full_name as "fullName" from memberships m join users u on u.id = m.user_id`);
      return { format: 'nextgen-tenant-export', version: 1, exportedAt: new Date().toISOString(), tenant: t, users, tables };
    });
  }

  async exportFile(auth: AuthContext) {
    const data = await this.exportData(auth, { history: true });
    return { name: `${data.tenant.slug}-${data.exportedAt.slice(0, 10)}.nextgen.json.gz`, bytes: gzipSync(Buffer.from(JSON.stringify(data))) };
  }

  parseFile(buf: Buffer): ExportFile {
    let text: string;
    try {
      text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
    } catch {
      throw new BadRequestException('The file is not a workspace export');
    }
    const data = JSON.parse(text) as ExportFile;
    if (data.format !== 'nextgen-tenant-export' || data.version !== 1 || !data.tables) throw new BadRequestException('The file is not a workspace export');
    return data;
  }

  /**
   * A new workspace from an export: new ids for every row, users matched by email (the importer
   * stands in for people who are not on this installation), owned by the importer.
   */
  async importData(auth: AuthContext, data: ExportFile, target: { slug: string; name: string; settings?: Record<string, unknown> }) {
    const [taken] = await this.database.run({}, (tx) => many<{ exists: boolean }>(tx, sql`select tenant_slug_exists(${target.slug}) as exists`));
    if (taken.exists) throw new ConflictException('This workspace URL is already taken');
    // Users by email on this installation.
    const userMap = new Map<string, string>();
    for (const u of data.users) {
      const [found] = await this.database.run({}, (tx) => many<{ id: string }>(tx, sql`select id from auth_find_user_by_email(${u.email})`));
      userMap.set(u.id, found?.id ?? auth.userId);
    }
    const [{ id: tenantId }] = await this.database.run({}, (tx) => many<{ id: string }>(tx, sql`select uuidv7()::text as id`));
    return this.database.run({ tenantId, userId: auth.userId }, (tx) => this.importInto(tx, auth, data, target, tenantId, userMap)).catch((err: unknown) => {
      const cause = (err as { cause?: { message?: string; code?: string } }).cause;
      if (cause?.code === '42501') throw new BadRequestException(`The copy was refused by the database: ${cause.message}`);
      throw err;
    });
  }

  private async importInto(tx: Transaction, auth: AuthContext, data: ExportFile, target: { slug: string; name: string; settings?: Record<string, unknown> }, tenantId: string, userMap: Map<string, string>) {
    {
      const present = new Set(await this.tenantTables(tx));
      const tables = Object.keys(data.tables).filter((t) => present.has(t) && !EXCLUDED.has(t));
      const fks = await many<{ table: string; columns: string[]; refTable: string; nullable: boolean }>(
        tx,
        sql`select c.conrelid::regclass::text as "table", array_agg(a.attname order by k.n) as columns, c.confrelid::regclass::text as "refTable", bool_and(not a.attnotnull) as nullable
            from pg_constraint c cross join lateral unnest(c.conkey) with ordinality as k(attnum, n) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
            where c.contype = 'f' and c.connamespace = 'public'::regnamespace group by c.oid, c.conrelid, c.confrelid`,
      );
      const { order, deferred } = insertionOrder(tables, fks as ForeignKey[]);
      // References to rows that are not copied (jobs, sessions, billing…) are cleared.
      const kept = new Set([...tables, 'tenants', 'users', 'permissions', 'partners']);
      const dangling = (fks as ForeignKey[]).filter((f) => tables.includes(f.table) && !kept.has(f.refTable));
      const blocking = dangling.filter((d) => !d.nullable && data.tables[d.table].some((r) => d.columns.some((c) => r[c] != null)));
      if (blocking.length) throw new BadRequestException(`Rows refer to data that is not exported: ${blocking.map((d) => `${d.table}.${d.columns.join('/')}`).join(', ')}`);
      const clearedBy = new Map<string, string[]>();
      for (const d of dangling) clearedBy.set(d.table, [...(clearedBy.get(d.table) ?? []), ...d.columns]);
      const notNullDeferred = deferred.filter((d) => !d.nullable);
      if (notNullDeferred.length) throw new BadRequestException(`Cannot order ${notNullDeferred.map((d) => `${d.table}.${d.columns.join('/')}`).join(', ')}`);
      // New ids for every row id; the tenant id and user ids are mapped too.
      const ids = new Map<string, string>([[data.tenant.id, tenantId]]);
      const oldIds = tables.flatMap((t) => data.tables[t].map((r) => r.id).filter((v): v is string => typeof v === 'string'));
      for (let i = 0; i < oldIds.length; i += 5000) {
        const fresh = await many<{ id: string }>(tx, sql`select uuidv7()::text as id from generate_series(1, ${Math.min(5000, oldIds.length - i)})`);
        oldIds.slice(i, i + 5000).forEach((o, j) => ids.set(o, fresh[j].id));
      }
      for (const [o, n] of userMap) ids.set(o, n);
      // The workspace itself.
      await tx.execute(sql`insert into tenants (id, slug, name, status, industry, plan_code, trial_ends_at, settings) values (${tenantId}, ${target.slug}, ${target.name}, 'trial', ${data.tenant.industry}, 'trial', now() + interval '30 days', ${JSON.stringify({ ...data.tenant.settings, ...target.settings })}::jsonb)`);
      await tx.execute(sql`insert into subscriptions (tenant_id, plan_code, status, provider, current_period_start, current_period_end) values (${tenantId}, 'trial', 'trialing', 'none', now(), now() + interval '30 days')`);
      const deferredBy = new Map<string, string[]>();
      for (const d of deferred) deferredBy.set(d.table, [...(deferredBy.get(d.table) ?? []), ...d.columns]);
      const counts: Record<string, number> = {};
      const seenMembers = new Set<string>();
      for (const t of order) {
        let rows = data.tables[t].map((r) => remap(r, ids) as Record<string, unknown>);
        if (t === 'memberships') {
          // One membership per user (two exported people may map to the importer).
          rows = rows.filter((r) => !seenMembers.has(String(r.user_id)) && seenMembers.add(String(r.user_id)));
        }
        for (const c of CLEARED[t] ?? []) rows = rows.map((r) => ({ ...r, [c]: c === 'key' ? randomBytes(16).toString('hex') : null }));
        for (const c of clearedBy.get(t) ?? []) rows = rows.map((r) => ({ ...r, [c]: null }));
        const later = deferredBy.get(t) ?? [];
        const first = later.length ? rows.map((r) => ({ ...r, ...Object.fromEntries(later.map((c) => [c, null])) })) : rows;
        for (let i = 0; i < first.length; i += CHUNK) {
          try {
            await tx.execute(sql`insert into ${sql.identifier(t)} select * from json_populate_recordset(null::${sql.identifier(t)}, ${JSON.stringify(first.slice(i, i + CHUNK))}::json)`);
          } catch (err) {
            const cause = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message;
            throw new BadRequestException(`Copying ${t} failed: ${cause}`);
          }
        }
        counts[t] = rows.length;
      }
      for (const d of deferred) {
        const rows = data.tables[d.table].map((r) => remap(r, ids) as Record<string, unknown>).filter((r) => r.id && d.columns.some((c) => r[c] != null));
        for (const c of d.columns)
          for (let i = 0; i < rows.length; i += CHUNK) {
            const part = rows.slice(i, i + CHUNK).map((r) => ({ id: r.id, v: r[c] }));
            await tx.execute(sql`update ${sql.identifier(d.table)} t set ${sql.identifier(c)} = v.v from json_to_recordset(${JSON.stringify(part)}::json) as v(id uuid, v uuid) where t.id = v.id`);
          }
      }
      // The importer owns the new workspace.
      const [mine] = await many<{ id: string }>(tx, sql`select id from memberships where user_id = ${auth.userId} and tenant_id = ${tenantId}`);
      const membershipId = mine?.id ?? (await many<{ id: string }>(tx, sql`insert into memberships (tenant_id, user_id, is_owner, status) values (${tenantId}, ${auth.userId}, true, 'active') returning id`))[0].id;
      await tx.execute(sql`update memberships set is_owner = true, status = 'active' where id = ${membershipId}`);
      await tx.execute(sql`insert into membership_roles (tenant_id, membership_id, role_id) select ${tenantId}, ${membershipId}, r.id from roles r where r.name = 'Owner' and r.is_system on conflict do nothing`);
      await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, metadata) values (${tenantId}, ${auth.userId}, 'tenant.imported', 'tenant', ${tenantId}, ${JSON.stringify({ from: data.tenant.slug, exportedAt: data.exportedAt, tables: Object.keys(counts).length })}::jsonb)`);
      return { tenantId, slug: target.slug, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), deferred: deferred.length };
    }
  }

  /** A sandbox: a copy of this workspace (without high-volume history) for training and trying changes. */
  async sandbox(auth: AuthContext, slug: string) {
    const data = await this.exportData(auth, { history: false });
    return this.importData(auth, data, { slug, name: `${data.tenant.name} (sandbox)`, settings: { sandboxOf: data.tenant.slug, sandboxCreatedAt: new Date().toISOString() } });
  }
}
