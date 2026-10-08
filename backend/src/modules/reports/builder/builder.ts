import { BadRequestException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { fiscalYearOf } from '../../../common/fiscal-year';
import type { ReportColumn } from '../report-types';
import { DATASETS, type Dataset, type DatasetField } from './datasets';

const OPS = ['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'not_empty'] as const;
const PERIODS = ['all', 'today', 'last_7', 'last_30', 'last_90', 'mtd', 'last_month', 'qtd', 'fytd', 'last_fy', 'custom'] as const;
const AGGS = ['sum', 'avg', 'min', 'max', 'count'] as const;

export const specSchema = z.object({
  dataset: z.string().max(40),
  fields: z.array(z.string().max(40)).min(1, 'Pick at least one field').max(30),
  filters: z
    .array(z.object({ field: z.string().max(40), op: z.enum(OPS), value: z.union([z.string().max(200), z.array(z.string().max(200)).max(50)]).optional() }))
    .max(20)
    .default([]),
  period: z.object({ preset: z.enum(PERIODS).default('fytd'), from: z.iso.date().optional(), to: z.iso.date().optional() }).default({ preset: 'fytd' }),
  group: z.boolean().default(false),
  aggregates: z.record(z.string().max(40), z.enum(AGGS)).default({}),
  sort: z.object({ field: z.string().max(40), dir: z.enum(['asc', 'desc']) }).nullable().default(null),
  limit: z.number().int().min(1).max(10_000).default(1000),
});
export type Spec = z.infer<typeof specSchema>;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const prevMonth = (d: string) => {
  const t = new Date(`${monthStart(d)}T00:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() - 1);
  const from = t.toISOString().slice(0, 10);
  return { from, to: addDays(monthStart(d), -1) };
};

/** A relative period as dates, against today in India. */
export function periodRange(p: Spec['period'], today: string): { from: string; to: string } | null {
  switch (p.preset) {
    case 'all':
      return null;
    case 'today':
      return { from: today, to: today };
    case 'last_7':
      return { from: addDays(today, -6), to: today };
    case 'last_30':
      return { from: addDays(today, -29), to: today };
    case 'last_90':
      return { from: addDays(today, -89), to: today };
    case 'mtd':
      return { from: monthStart(today), to: today };
    case 'last_month':
      return prevMonth(today);
    case 'qtd': {
      // Indian quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
      const m = Number(today.slice(5, 7));
      const qStart = [1, 4, 7, 10].filter((x) => x <= m).at(-1)!;
      return { from: `${today.slice(0, 4)}-${String(qStart).padStart(2, '0')}-01`, to: today };
    }
    case 'fytd':
      return { from: fiscalYearOf(today).start, to: today };
    case 'last_fy': {
      const fy = fiscalYearOf(addDays(fiscalYearOf(today).start, -1));
      return { from: fy.start, to: fy.end };
    }
    case 'custom':
      if (!p.from || !p.to) throw new BadRequestException({ message: 'Give both dates of the period', errors: [{ path: 'period.from', message: 'Give both dates of the period' }] });
      if (p.from > p.to) throw new BadRequestException({ message: 'The period ends before it starts', errors: [{ path: 'period.to', message: 'The period ends before it starts' }] });
      return { from: p.from, to: p.to };
  }
}

export function datasetOf(key: string): Dataset {
  const ds = DATASETS.find((x) => x.key === key);
  if (!ds) throw new BadRequestException({ message: 'Unknown dataset', errors: [{ path: 'dataset', message: 'Unknown dataset' }] });
  return ds;
}

const NUMERIC = new Set(['number', 'qty', 'money', 'percent']);
const cast = (f: DatasetField) => (f.type === 'date' ? sql.raw('::date') : NUMERIC.has(f.type) ? sql.raw('::numeric') : sql.raw('::text'));

function condition(f: DatasetField, op: (typeof OPS)[number], value: string | string[] | undefined): SQL {
  const e = sql.raw(`(${f.expr})`);
  const one = Array.isArray(value) ? value[0] : value;
  const need = () => {
    if (one === undefined || one === '') throw new BadRequestException({ message: `${f.label}: give a value to filter on`, errors: [{ path: 'filters', message: `${f.label}: give a value to filter on` }] });
    if (NUMERIC.has(f.type) && !/^-?\d+(\.\d+)?$/.test(one)) throw new BadRequestException({ message: `${f.label}: a number`, errors: [{ path: 'filters', message: `${f.label}: a number` }] });
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(one)) throw new BadRequestException({ message: `${f.label}: a date`, errors: [{ path: 'filters', message: `${f.label}: a date` }] });
    return one;
  };
  const textual = f.type === 'text' ? sql`${e}::text` : e;
  switch (op) {
    case 'eq':
      return sql`${textual} = ${need()}${cast(f)}`;
    case 'ne':
      return sql`${textual} is distinct from ${need()}${cast(f)}`;
    case 'contains':
      return sql`${e}::text ilike ${`%${need().replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`;
    case 'gt':
      return sql`${e} > ${need()}${cast(f)}`;
    case 'gte':
      return sql`${e} >= ${need()}${cast(f)}`;
    case 'lt':
      return sql`${e} < ${need()}${cast(f)}`;
    case 'lte':
      return sql`${e} <= ${need()}${cast(f)}`;
    case 'in': {
      const list = (Array.isArray(value) ? value : (value ?? '').split(',')).map((v) => v.trim()).filter(Boolean);
      if (!list.length) throw new BadRequestException({ message: `${f.label}: list the values`, errors: [{ path: 'filters', message: `${f.label}: list the values` }] });
      return sql`${e}::text in ${list}`;
    }
    case 'empty':
      return sql`(${e} is null or ${e}::text = '')`;
    case 'not_empty':
      return sql`(${e} is not null and ${e}::text <> '')`;
  }
}

/**
 * Builds the query for a report-builder spec. Field expressions come from the dataset
 * definitions; everything the user typed is a bound parameter.
 */
export function buildQuery(spec: Spec, today: string): { query: SQL; columns: (ReportColumn & { role: string; agg?: string })[]; period: { from: string; to: string } | null } {
  const ds = datasetOf(spec.dataset);
  const field = (k: string, path: string) => {
    const f = ds.fields.find((x) => x.key === k);
    if (!f) throw new BadRequestException({ message: `Unknown field ${k}`, errors: [{ path, message: `Unknown field ${k}` }] });
    return f;
  };
  const fields = [...new Set(spec.fields)].map((k) => field(k, 'fields'));
  const dims = fields.filter((f) => f.role === 'dimension');
  const grouping = spec.group && fields.some((f) => f.role === 'measure');
  const select = fields.map((f) => {
    if (grouping && f.role === 'measure') {
      const agg = spec.aggregates[f.key] ?? f.agg ?? 'sum';
      const expr = agg === 'count' ? 'count(*)' : `${agg}(${f.expr})`;
      return sql.raw(`${expr} as "${f.key}"`);
    }
    return sql.raw(`${f.expr} as "${f.key}"`);
  });
  const where: SQL[] = [sql.raw(`(${ds.where})`)];
  const period = ds.date ? periodRange(spec.period, today) : null;
  if (period && ds.date) where.push(sql`${sql.raw(ds.date)} between ${period.from}::date and ${period.to}::date`);
  for (const flt of spec.filters) where.push(condition(field(flt.field, 'filters'), flt.op, flt.value));
  const sortField = spec.sort ? field(spec.sort.field, 'sort') : null;
  if (sortField && !fields.includes(sortField)) throw new BadRequestException({ message: 'Sort by a field that is shown', errors: [{ path: 'sort', message: 'Sort by a field that is shown' }] });
  const order = sortField ? sql.raw(`order by "${sortField.key}" ${spec.sort!.dir} nulls last`) : grouping && dims.length ? sql.raw(`order by ${dims.map((x) => `"${x.key}"`).join(', ')}`) : sql``;
  const groupBy = grouping && dims.length ? sql.raw(`group by ${dims.map((x) => x.expr).join(', ')}`) : sql``;
  const query = sql`select ${sql.join(select, sql`, `)} from ${sql.raw(ds.from)} where ${sql.join(where, sql` and `)} ${groupBy} ${order} limit ${spec.limit + 1}`;
  const columns = fields.map((f) => {
    const agg = grouping && f.role === 'measure' ? (spec.aggregates[f.key] ?? f.agg ?? 'sum') : undefined;
    const type = agg === 'count' ? 'number' : f.type;
    return { key: f.key, label: agg && agg !== 'sum' ? `${f.label} (${agg})` : f.label, type, role: f.role, agg, total: f.role === 'measure' && (!grouping || agg === 'sum' || agg === 'count') && f.agg !== 'avg' && f.agg !== 'max' };
  });
  return { query, columns, period };
}
