import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { savedReports, type Transaction } from '@nextgen/database';
import { asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../../common/auth-context';
import { Decimal } from '../../../common/decimal';
import { todayIST } from '../../../common/fiscal-year';
import { loadPermissions } from '../../../common/guards';
import { optionalText } from '../../../common/validators';
import { DatabaseService } from '../../../database/database.service';
import { renderFile } from '../reports.service';
import { buildQuery, datasetOf, specSchema, type Spec } from './builder';
import { DATASETS } from './datasets';

export const savedReportSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
  shared: z.boolean().default(false),
  spec: specSchema,
});
export type SavedReportInput = z.infer<typeof savedReportSchema>;

const pad = (n: number) => String(n).padStart(2, '0');
const dateText = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v === null || v === undefined ? null : String(v));

/**
 * Report builder: users pick a dataset, fields, filters, a period and grouping; the query is
 * generated from the dataset definitions with bound values. Saved reports can be personal or
 * shared, run on screen, exported and scheduled.
 */
@Injectable()
export class BuilderService {
  constructor(private readonly database: DatabaseService) {}

  private async perms(auth: AuthContext) {
    return auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
  }

  async datasets(auth: AuthContext) {
    const perms = await this.perms(auth);
    return DATASETS.filter((d) => perms.has(d.permission)).map((d) => ({ key: d.key, title: d.title, description: d.description, hasDate: !!d.date, fields: d.fields.map(({ expr: _e, ...f }) => f) }));
  }

  async runSpec(auth: AuthContext, spec: Spec, title = 'Custom report', key = 'custom-report') {
    const ds = datasetOf(spec.dataset);
    if (!(await this.perms(auth)).has(ds.permission)) throw new ForbiddenException('You do not have access to this data');
    const { query, columns, period } = buildQuery(spec, todayIST());
    const res = await this.database.run(auth, (tx: Transaction) => tx.execute<Record<string, unknown>>(query));
    const rows = res.rows.slice(0, spec.limit).map((r) => {
      const out: Record<string, unknown> = {};
      for (const c of columns) out[c.key] = c.type === 'date' ? dateText(r[c.key]) : c.role === 'measure' ? (r[c.key] === null || r[c.key] === undefined ? null : String(r[c.key])) : r[c.key];
      return out;
    });
    const totals: Record<string, string> = {};
    for (const c of columns.filter((x) => x.total)) totals[c.key] = rows.reduce((s, r) => s.add(Decimal.from((r[c.key] as string | null) ?? '0')), Decimal.from('0')).toFixed(c.type === 'qty' ? 4 : 2);
    return { key, title, dataset: ds.title, params: period ?? {}, columns, rows, totals, truncated: res.rows.length > spec.limit, chart: null };
  }

  async exportSpec(auth: AuthContext, spec: Spec, format: 'xlsx' | 'csv', title?: string, key?: string) {
    return renderFile(await this.runSpec(auth, spec, title, key), format);
  }

  // ---- saved reports ------------------------------------------------------------------------

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select().from(savedReports).where(or(eq(savedReports.ownerId, auth.userId), isNull(savedReports.ownerId))).orderBy(asc(savedReports.name));
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, dataset: r.spec.dataset, shared: r.ownerId === null, mine: r.ownerId === auth.userId, updatedAt: r.updatedAt }));
    });
  }

  async get(auth: AuthContext, id: string) {
    const [r] = await this.database.run(auth, (tx) => tx.select().from(savedReports).where(eq(savedReports.id, id)));
    if (!r || (r.ownerId !== null && r.ownerId !== auth.userId)) throw new NotFoundException('Report not found');
    return { id: r.id, name: r.name, description: r.description, spec: r.spec as Spec, shared: r.ownerId === null, mine: r.ownerId === auth.userId };
  }

  async run(auth: AuthContext, id: string) {
    const r = await this.get(auth, id);
    return this.runSpec(auth, r.spec, r.name, `saved-${r.id}`);
  }

  async save(auth: AuthContext, id: string | null, input: SavedReportInput) {
    const perms = await this.perms(auth);
    if (input.shared && !perms.has('platform.customization.manage')) throw new ForbiddenException('Only administrators can share reports with everyone');
    const ds = datasetOf(input.spec.dataset);
    if (!perms.has(ds.permission)) throw new ForbiddenException('You do not have access to this data');
    buildQuery(input.spec, todayIST()); // validates fields, filters and sort
    return this.database.run(auth, async (tx) => {
      const values = { name: input.name, description: input.description, spec: input.spec, ownerId: input.shared ? null : auth.userId, updatedBy: auth.userId };
      if (id) {
        const [r] = await tx.select().from(savedReports).where(eq(savedReports.id, id));
        if (!r) throw new NotFoundException('Report not found');
        if (r.ownerId !== auth.userId && !(r.ownerId === null && perms.has('platform.customization.manage'))) throw new ForbiddenException('You cannot change this report');
        await tx.update(savedReports).set({ ...values, updatedAt: new Date() }).where(eq(savedReports.id, id));
        return { id };
      }
      const [row] = await tx.insert(savedReports).values({ ...values, tenantId: auth.tenantId, createdBy: auth.userId }).returning({ id: savedReports.id });
      return row;
    });
  }

  async remove(auth: AuthContext, id: string) {
    const perms = await this.perms(auth);
    await this.database.run(auth, async (tx) => {
      const [r] = await tx.select().from(savedReports).where(eq(savedReports.id, id));
      if (!r) throw new NotFoundException('Report not found');
      if (r.ownerId !== auth.userId && !(r.ownerId === null && perms.has('platform.customization.manage'))) throw new ForbiddenException('You cannot delete this report');
      await tx.delete(savedReports).where(eq(savedReports.id, id));
    });
  }
}
