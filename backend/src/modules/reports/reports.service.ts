import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { fiscalYearOf, todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import { DatabaseService } from '../../database/database.service';
import { toCsv } from '../compliance/gst-reports.service';
import { relativeDate } from './builder/schedule-time';
import { INVENTORY_REPORTS } from './catalogue/inventory';
import { LINK_REPORTS } from './catalogue/links';
import { PRODUCTION_REPORTS, QUALITY_REPORTS } from './catalogue/production';
import { PURCHASE_REPORTS } from './catalogue/purchase';
import { SALES_REPORTS } from './catalogue/sales';
import { CATEGORIES, type Params, type QueryReport, type ReportColumn, type ReportDef, type ReportParam } from './report-types';

/** Rows returned to the screen and in exports; beyond this, narrow the filters. */
export const ROW_LIMIT = 10_000;

export const REPORTS: ReportDef[] = [...SALES_REPORTS, ...PURCHASE_REPORTS, ...INVENTORY_REPORTS, ...PRODUCTION_REPORTS, ...QUALITY_REPORTS, ...LINK_REPORTS];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC: ReportColumn['type'][] = ['number', 'qty', 'money', 'percent'];

const pad = (n: number) => String(n).padStart(2, '0');
/** pg parses `date` as local midnight; read it back the same way. */
const dateText = (v: unknown) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : v === null || v === undefined ? null : String(v));

export function resolveDefault(d: string | undefined, today = todayIST()) {
  if (d === 'today') return today;
  if (d && ['yesterday', 'week_start', 'prev_month_start', 'prev_month_end'].includes(d)) return relativeDate(d, today);
  if (d === 'fy_start') return fiscalYearOf(today).start;
  if (d === 'month_start') return `${today.slice(0, 8)}01`;
  return d;
}

/** Fills defaults and checks every parameter against its type. */
export function resolveParams(defs: ReportParam[], input: Params): Params {
  const out: Params = {};
  const errors: { path: string; message: string }[] = [];
  for (const d of defs) {
    const v = (input[d.key] ?? '').trim() || resolveDefault(d.default);
    if (!v) {
      if (d.required) errors.push({ path: d.key, message: `Choose the ${d.label.toLowerCase()}` });
      continue;
    }
    const ok =
      d.type === 'date' ? DATE.test(v) && !Number.isNaN(Date.parse(v)) : d.type === 'number' ? /^\d{1,5}$/.test(v) : d.type === 'select' ? !!d.options?.some((o) => o.value === v) : UUID.test(v);
    if (!ok) errors.push({ path: d.key, message: `${d.label}: not a valid value` });
    else out[d.key] = v;
  }
  if (out.from && out.to && out.from > out.to) errors.push({ path: 'to', message: 'The period ends before it starts' });
  if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
  return out;
}

/**
 * The report catalogue: standard reports as parameterised queries (run under the tenant's row
 * security), plus links to the screens that are reports in their own right.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  private async perms(auth: AuthContext) {
    return auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
  }

  async catalogue(auth: AuthContext) {
    const perms = await this.perms(auth);
    return {
      categories: CATEGORIES,
      reports: REPORTS.filter((r) => perms.has(r.permission)).map((r) =>
        r.kind === 'link'
          ? { kind: r.kind, key: r.key, title: r.title, category: r.category, description: r.description, href: r.href }
          : { kind: r.kind, key: r.key, title: r.title, category: r.category, description: r.description, params: r.params.map((p) => ({ ...p, default: resolveDefault(p.default) })), columns: r.columns, chart: r.chart ?? null },
      ),
    };
  }

  async find(auth: AuthContext, key: string): Promise<QueryReport> {
    const r = REPORTS.find((x) => x.key === key);
    if (!r || r.kind !== 'query') throw new NotFoundException('Report not found');
    if (!(await this.perms(auth)).has(r.permission)) throw new ForbiddenException('You do not have access to this report');
    return r;
  }

  async run(auth: AuthContext, key: string, input: Params) {
    const r = await this.find(auth, key);
    const params = resolveParams(r.params, input);
    const res = await this.database.run(auth, (tx) => tx.execute<Record<string, unknown>>(sql`${r.query(params)} limit ${ROW_LIMIT + 1}`));
    let rows = res.rows.slice(0, ROW_LIMIT).map((row) => {
      const out: Record<string, unknown> = { ...row };
      for (const c of r.columns) {
        const v = row[c.key];
        out[c.key] = c.type === 'date' ? dateText(v) : NUMERIC.includes(c.type) ? (v === null || v === undefined ? null : String(v)) : v;
      }
      return out;
    });
    if (r.post) rows = r.post(rows);
    const totals: Record<string, string> = {};
    for (const c of r.columns.filter((x) => x.total)) totals[c.key] = rows.reduce((s, row) => s.add(Decimal.from((row[c.key] as string | null) ?? '0')), Decimal.from('0')).toFixed(c.type === 'qty' ? 4 : 2);
    return { key: r.key, title: r.title, params, columns: r.columns, rows, totals, truncated: res.rows.length > ROW_LIMIT, chart: r.chart ?? null };
  }

  async export(auth: AuthContext, key: string, input: Params, format: 'xlsx' | 'csv') {
    return renderFile(await this.run(auth, key, input), format);
  }
}

export interface RenderableResult {
  key: string;
  title: string;
  params: Record<string, string | undefined>;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals: Record<string, string>;
}

/** A report result as an Excel workbook or CSV file. */
export async function renderFile(data: RenderableResult, format: 'xlsx' | 'csv') {
  const stamp = [data.params.from, data.params.to].filter(Boolean).join('_') || todayIST();
  const name = `${data.key}_${stamp}`;
  const cell = (c: ReportColumn, v: unknown) => (v === null || v === undefined ? '' : NUMERIC.includes(c.type) ? Number(v) : v);
  if (format === 'csv') {
    const body = toCsv(
      data.columns.map((c) => c.label),
      [...data.rows.map((row) => data.columns.map((c) => row[c.key] ?? '')), ...(Object.keys(data.totals).length ? [data.columns.map((c, i) => data.totals[c.key] ?? (i === 0 ? 'Total' : ''))] : [])],
    );
    return { name: `${name}.csv`, type: 'text/csv; charset=utf-8', body: Buffer.from(body, 'utf8') };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NextGen ERP';
  const ws = wb.addWorksheet(data.title.slice(0, 31));
  ws.addRow([data.title]).font = { bold: true, size: 13 };
  const filters = Object.entries(data.params).map(([k, v]) => `${k}: ${v}`).join('  ·  ');
  if (filters) ws.addRow([filters]).font = { color: { argb: 'FF666666' } };
  ws.addRow([]);
  const head = ws.addRow(data.columns.map((c) => c.label));
  head.font = { bold: true };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F7' } }));
  for (const row of data.rows) ws.addRow(data.columns.map((c) => cell(c, row[c.key])));
  if (Object.keys(data.totals).length) {
    const t = ws.addRow(data.columns.map((c, i) => (data.totals[c.key] !== undefined ? Number(data.totals[c.key]) : i === 0 ? 'Total' : '')));
    t.font = { bold: true };
  }
  data.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(48, Math.max(10, c.label.length + 2, ...data.rows.slice(0, 200).map((r) => String(r[c.key] ?? '').length + 2)));
    if (c.type === 'money') col.numFmt = '#,##,##0.00';
    else if (c.type === 'qty') col.numFmt = '#,##,##0.####';
    else if (c.type === 'percent') col.numFmt = '0.00"%"';
  });
  ws.views = [{ state: 'frozen', ySplit: head.number }];
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return { name: `${name}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: buf };
}
