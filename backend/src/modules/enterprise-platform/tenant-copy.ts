/**
 * Pure parts of copying a workspace: which tables travel, the order to insert them in (parents
 * before children, breaking cycles with columns filled in afterwards), and re-keying every row so
 * the copy has its own ids.
 */

/** Never copied: sessions, credentials and secrets, delivery queues, billing, and values unique across workspaces. */
export const EXCLUDED = new Set([
  'auth_sessions',
  'api_keys',
  'webhook_endpoints',
  'webhook_deliveries',
  'jobs',
  'notifications',
  'notification_deliveries',
  'billing_events',
  'saas_invoices',
  'subscriptions',
  'data_requests',
  'app_installations',
  'connector_runs',
  'scim_tokens',
  'sso_settings',
  'tenant_branding',
  'invitations',
  'portal_sessions',
  'mfa_recovery_codes',
]);

/** High-volume history left out of sandbox copies (kept in full exports). */
export const HISTORY = new Set(['audit_logs', 'iot_readings', 'energy_minutes', 'automation_runs', 'ai_usage']);

/** Columns cleared in a copy because their values are unique across all workspaces. */
export const CLEARED: Record<string, string[]> = { tms_trips: ['driver_token_hash'], portal_users: ['invite_token_hash', 'password_hash'], crm_web_forms: ['key'] };

export interface ForeignKey {
  table: string;
  columns: string[];
  refTable: string;
  nullable: boolean;
}

/**
 * Insertion order: a table comes after the tables it references. A reference that closes a cycle
 * (including a table referencing itself) is deferred: inserted empty and filled in afterwards — only
 * possible for nullable columns, so those are preferred when breaking cycles.
 */
export function insertionOrder(tables: string[], fks: ForeignKey[]) {
  const set = new Set(tables);
  const edges = fks.filter((f) => set.has(f.table) && set.has(f.refTable));
  const deferred: ForeignKey[] = [];
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (t: string) => {
    if (state.get(t) === 'done') return;
    state.set(t, 'visiting');
    // Visit non-nullable references first so that cycles are broken on nullable ones where possible.
    const out = edges.filter((e) => e.table === t).sort((a, b) => Number(a.nullable) - Number(b.nullable));
    for (const e of out) {
      if (e.refTable === t || state.get(e.refTable) === 'visiting') {
        deferred.push(e);
        continue;
      }
      visit(e.refTable);
    }
    state.set(t, 'done');
    order.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return { order, deferred };
}

/** Replaces every id found in the map, anywhere in a value (columns, arrays, JSON documents). */
export function remap(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remap(v, ids)]));
  return value;
}

export interface ExportFile {
  format: 'nextgen-tenant-export';
  version: 1;
  exportedAt: string;
  tenant: { id: string; name: string; slug: string; industry: string | null; settings: Record<string, unknown> };
  users: { id: string; email: string; fullName: string }[];
  tables: Record<string, Record<string, unknown>[]>;
}
