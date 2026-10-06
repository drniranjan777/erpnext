import type { PermissionCode } from '@nextgen/database';
import { sql, type SQL } from 'drizzle-orm';

export type Category = 'sales' | 'purchase' | 'inventory' | 'production' | 'quality' | 'finance' | 'gst';
export const CATEGORIES: Record<Category, string> = { sales: 'Sales', purchase: 'Purchase', inventory: 'Inventory', production: 'Production', quality: 'Quality', finance: 'Finance', gst: 'GST' };

export type ColumnType = 'text' | 'date' | 'number' | 'qty' | 'money' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Summed in the totals row. */
  total?: boolean;
  /** Turns the cell into a link: `${path}/${row[idKey]}`. */
  link?: { path: string; idKey: string };
}

export type ParamType = 'date' | 'number' | 'item' | 'party' | 'warehouse' | 'select';

export interface ReportParam {
  key: string;
  label: string;
  type: ParamType;
  /** A named default ('fy_start', 'month_start', 'today') or a literal. */
  default?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}

export type Params = Record<string, string | undefined>;

export interface QueryReport {
  kind: 'query';
  key: string;
  title: string;
  category: Category;
  description: string;
  permission: PermissionCode;
  params: ReportParam[];
  columns: ReportColumn[];
  query: (p: Params) => SQL;
  /** Rows → rows, for labels SQL cannot produce (state names…). */
  post?: (rows: Record<string, unknown>[]) => Record<string, unknown>[];
  /** Suggested chart: category column and value column. */
  chart?: { label: string; value: string };
}

/** Reports that already have their own screen (statements, GST returns…). */
export interface LinkReport {
  kind: 'link';
  key: string;
  title: string;
  category: Category;
  description: string;
  permission: PermissionCode;
  href: string;
}

export type ReportDef = QueryReport | LinkReport;

/** Common period parameters. */
export const PERIOD: ReportParam[] = [
  { key: 'from', label: 'From', type: 'date', default: 'fy_start' },
  { key: 'to', label: 'To', type: 'date', default: 'today' },
];

/** Posted documents (approved, or completed when fully processed). */
export const posted = (alias: string) => sql.raw(`${alias}.status in ('approved', 'completed')`);
export const inPeriod = (alias: string, p: Params) => sql`${sql.raw(`${alias}.doc_date`)} between ${p.from}::date and ${p.to}::date`;
/** Optional equality filter on a uuid column. */
export const optional = (column: string, value: string | undefined) => (value ? sql`and ${sql.raw(column)} = ${value}::uuid` : sql``);
