import { sql } from 'drizzle-orm';
import { inPeriod, PERIOD, posted, type ReportDef } from '../report-types';

const wo = { path: '/manufacturing/work-orders', idKey: 'id' };
const istDate = (col: string) => sql.raw(`(${col} at time zone 'Asia/Kolkata')::date`);

export const PRODUCTION_REPORTS: ReportDef[] = [
  {
    kind: 'query',
    key: 'work-order-status',
    title: 'Work order status',
    category: 'production',
    description: 'Open work orders with progress and lateness.',
    permission: 'manufacturing.production.read',
    params: [{ key: 'stage', label: 'Stage', type: 'select', options: [{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }], default: 'open' }],
    columns: [
      { key: 'number', label: 'Work order', type: 'text', link: wo },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'stage', label: 'Stage', type: 'text' },
      { key: 'qty', label: 'Ordered', type: 'qty' },
      { key: 'produced', label: 'Made', type: 'qty' },
      { key: 'rejected', label: 'Rejected', type: 'qty' },
      { key: 'progress', label: 'Progress', type: 'percent' },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'daysLate', label: 'Days late', type: 'number' },
    ],
    query: (p) => sql`
      select d.id, d.number, i.code || ' ' || i.name as item, w.stage, w.qty, w.produced_qty as produced, w.rejected_qty as rejected,
             round(100 * w.produced_qty / nullif(w.qty, 0), 1) as progress, w.planned_end as due,
             case when w.stage in ('closed', 'completed') then null else greatest((now() at time zone 'Asia/Kolkata')::date - w.planned_end, 0) end as "daysLate"
      from work_orders w join documents d on d.id = w.id join items i on i.id = w.item_id
      where d.status <> 'draft' and w.stage <> 'cancelled' ${p.stage === 'all' ? sql`` : sql`and w.stage in ('released', 'in_progress', 'completed')`}
      order by w.priority, w.planned_end nulls last`,
  },
  {
    kind: 'query',
    key: 'plan-vs-actual',
    title: 'Production plan vs actual',
    category: 'production',
    description: 'Planned quantity and dates against what was made and when.',
    permission: 'manufacturing.production.read',
    params: PERIOD,
    columns: [
      { key: 'number', label: 'Work order', type: 'text', link: wo },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'planned', label: 'Planned', type: 'qty', total: true },
      { key: 'made', label: 'Made', type: 'qty', total: true },
      { key: 'yield', label: 'Achieved', type: 'percent' },
      { key: 'plannedEnd', label: 'Planned end', type: 'date' },
      { key: 'lastReceipt', label: 'Last receipt', type: 'date' },
      { key: 'onTime', label: 'On time', type: 'text' },
    ],
    query: (p) => sql`
      select d.id, d.number, i.code || ' ' || i.name as item, w.qty as planned, w.produced_qty as made, round(100 * w.produced_qty / nullif(w.qty, 0), 1) as yield,
             w.planned_end as "plannedEnd",
             (select max(ed.doc_date) from production_entries e join documents ed on ed.id = e.id where e.work_order_id = w.id and e.kind = 'receipt' and ed.status = 'approved') as "lastReceipt",
             case when w.planned_end is null then '—'
                  when (select max(ed.doc_date) from production_entries e join documents ed on ed.id = e.id where e.work_order_id = w.id and e.kind = 'receipt' and ed.status = 'approved') <= w.planned_end and w.produced_qty >= w.qty then 'Yes'
                  else 'No' end as "onTime"
      from work_orders w join documents d on d.id = w.id join items i on i.id = w.item_id
      where d.status in ('approved', 'completed') and coalesce(w.planned_end, d.doc_date) between ${p.from}::date and ${p.to}::date
      order by w.planned_end nulls last`,
  },
  {
    kind: 'query',
    key: 'production-by-item',
    title: 'Production by item',
    category: 'production',
    description: 'Good output received into stock, with its value.',
    permission: 'manufacturing.production.read',
    params: PERIOD,
    chart: { label: 'item', value: 'qty' },
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Made', type: 'qty', total: true },
      { key: 'rejected', label: 'Rejected at receipt', type: 'qty', total: true },
      { key: 'value', label: 'Value', type: 'money', total: true },
      { key: 'orders', label: 'Work orders', type: 'number' },
    ],
    query: (p) => sql`
      select i.code, i.name as item, sum(e.good_qty) as qty, sum(e.reject_qty) as rejected, sum(e.output_value) as value, count(distinct e.work_order_id) as orders
      from production_entries e join documents d on d.id = e.id join work_orders w on w.id = e.work_order_id join items i on i.id = w.item_id
      where ${posted('d')} and ${inPeriod('d', p)} and e.kind = 'receipt' group by i.code, i.name order by qty desc`,
  },
  {
    kind: 'query',
    key: 'material-consumption',
    title: 'Material consumption',
    category: 'production',
    description: 'Materials issued to production (net of returns), per item.',
    permission: 'manufacturing.production.read',
    params: PERIOD,
    chart: { label: 'item', value: 'value' },
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Consumed', type: 'qty', total: true },
      { key: 'value', label: 'Value', type: 'money', total: true },
      { key: 'orders', label: 'Work orders', type: 'number' },
    ],
    query: (p) => sql`
      select i.code, i.name as item, sum(case when e.kind = 'return' then -l.qty else l.qty end) as qty,
             sum(case when e.kind = 'return' then -l.amount else l.amount end) as value, count(distinct e.work_order_id) as orders
      from production_entry_lines l join production_entries e on e.id = l.entry_id join documents d on d.id = e.id join items i on i.id = l.item_id
      where ${posted('d')} and ${inPeriod('d', p)} and l.kind = 'material' group by i.code, i.name order by value desc`,
  },
  {
    kind: 'query',
    key: 'job-card-log',
    title: 'Job card log',
    category: 'production',
    description: 'Every finished sitting: operator, time and quantities.',
    permission: 'manufacturing.production.read',
    params: PERIOD,
    columns: [
      { key: 'ended', label: 'Date', type: 'date' },
      { key: 'number', label: 'Work order', type: 'text', link: wo },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'workCenter', label: 'Work centre', type: 'text' },
      { key: 'operator', label: 'Operator', type: 'text' },
      { key: 'minutes', label: 'Minutes', type: 'number', total: true },
      { key: 'good', label: 'Good', type: 'qty', total: true },
      { key: 'rejected', label: 'Rejected', type: 'qty', total: true },
      { key: 'reason', label: 'Reject reason', type: 'text' },
      { key: 'cost', label: 'Cost', type: 'money', total: true },
    ],
    query: (p) => sql`
      select d.id, ${istDate('c.ended_at')} as ended, d.number, o.seq || ' ' || o.name as operation, wc.code as "workCenter", c.operator_name as operator,
             c.minutes, c.good_qty as good, c.reject_qty as rejected, c.reject_reason as reason,
             c.labour_cost + c.machine_cost + c.overhead_cost + c.subcontract_cost as cost
      from job_cards c join work_order_operations o on o.id = c.operation_id join work_centers wc on wc.id = o.work_center_id join documents d on d.id = c.work_order_id
      where c.status = 'done' and ${istDate('c.ended_at')} between ${p.from}::date and ${p.to}::date order by c.ended_at`,
  },
  {
    kind: 'query',
    key: 'oee',
    title: 'OEE by work centre',
    category: 'production',
    description: 'Availability × performance × quality, from job cards against capacity (Monday–Saturday).',
    permission: 'manufacturing.production.read',
    params: PERIOD,
    chart: { label: 'workCenter', value: 'oee' },
    columns: [
      { key: 'workCenter', label: 'Work centre', type: 'text' },
      { key: 'available', label: 'Capacity (min)', type: 'number' },
      { key: 'run', label: 'Booked (min)', type: 'number' },
      { key: 'availability', label: 'Availability', type: 'percent' },
      { key: 'performance', label: 'Performance', type: 'percent' },
      { key: 'quality', label: 'Quality', type: 'percent' },
      { key: 'oee', label: 'OEE', type: 'percent' },
    ],
    query: (p) => sql`
      with days as (select count(*) as n from generate_series(${p.from}::date, ${p.to}::date, interval '1 day') g where extract(isodow from g) < 7),
      c as (
        select o.work_center_id, sum(c.minutes) as run, sum(o.run_minutes * (c.good_qty + c.reject_qty)) as std, sum(c.good_qty) as good, sum(c.good_qty + c.reject_qty) as made
        from job_cards c join work_order_operations o on o.id = c.operation_id
        where c.status = 'done' and not o.is_subcontract and ${istDate('c.ended_at')} between ${p.from}::date and ${p.to}::date group by o.work_center_id
      )
      select wc.code || ' ' || wc.name as "workCenter", round(days.n * wc.hours_per_day * 60 * wc.units) as available, c.run,
             round(100 * c.run / nullif(days.n * wc.hours_per_day * 60 * wc.units, 0), 1) as availability,
             round(100 * c.std / nullif(c.run, 0), 1) as performance,
             round(100 * c.good / nullif(c.made, 0), 1) as quality,
             round(100 * (c.run / nullif(days.n * wc.hours_per_day * 60 * wc.units, 0)) * least(c.std / nullif(c.run, 0), 1) * (c.good / nullif(c.made, 0)), 1) as oee
      from c join work_centers wc on wc.id = c.work_center_id cross join days order by oee desc nulls last`,
  },
  {
    kind: 'query',
    key: 'wip-valuation',
    title: 'Work in progress',
    category: 'production',
    description: 'What sits in WIP on each open work order.',
    permission: 'manufacturing.production.read',
    params: [],
    columns: [
      { key: 'number', label: 'Work order', type: 'text', link: wo },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'materials', label: 'Materials', type: 'money', total: true },
      { key: 'conversion', label: 'Time and job work', type: 'money', total: true },
      { key: 'output', label: 'Output taken', type: 'money', total: true },
      { key: 'wip', label: 'WIP', type: 'money', total: true },
    ],
    query: () => sql`
      select d.id, d.number, i.code || ' ' || i.name as item, w.material_cost as materials, w.conversion_cost + w.subcontract_cost as conversion,
             w.output_value + w.byproduct_value as output,
             w.material_cost + w.conversion_cost + w.subcontract_cost - w.output_value - w.byproduct_value - w.variance_value as wip
      from work_orders w join documents d on d.id = w.id join items i on i.id = w.item_id
      where d.status = 'approved' and w.stage in ('released', 'in_progress', 'completed') order by wip desc`,
  },
  {
    kind: 'query',
    key: 'production-variance',
    title: 'Production variances',
    category: 'production',
    description: 'Variances written off when work orders were closed.',
    permission: 'manufacturing.production.read',
    params: PERIOD,
    columns: [
      { key: 'number', label: 'Work order', type: 'text', link: wo },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'closed', label: 'Closed', type: 'date' },
      { key: 'made', label: 'Made', type: 'qty' },
      { key: 'standard', label: 'At standard', type: 'money', total: true },
      { key: 'actual', label: 'Actual', type: 'money', total: true },
      { key: 'variance', label: 'Variance', type: 'money', total: true },
    ],
    query: (p) => sql`
      select d.id, d.number, i.code || ' ' || i.name as item, ${istDate('w.closed_at')} as closed, w.produced_qty as made,
             round(w.std_unit_cost * w.produced_qty, 2) as standard,
             w.material_cost + w.conversion_cost + w.subcontract_cost - w.byproduct_value as actual, w.variance_value as variance
      from work_orders w join documents d on d.id = w.id join items i on i.id = w.item_id
      where w.stage = 'closed' and ${istDate('w.closed_at')} between ${p.from}::date and ${p.to}::date order by abs(w.variance_value) desc`,
  },
  {
    kind: 'query',
    key: 'tool-life',
    title: 'Tool and mould life',
    category: 'production',
    description: 'Shots used against expected life and the service interval.',
    permission: 'manufacturing.engineering.read',
    params: [],
    columns: [
      { key: 'code', label: 'Tool', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'text' },
      { key: 'shots', label: 'Shots used', type: 'number' },
      { key: 'life', label: 'Life (shots)', type: 'number' },
      { key: 'lifeUsed', label: 'Life used', type: 'percent' },
      { key: 'sinceService', label: 'Since service', type: 'number' },
      { key: 'serviceDue', label: 'Service due', type: 'text' },
    ],
    query: () => sql`
      select t.code, t.name, t.kind, t.shots_used as shots, t.life_shots as life, round(100.0 * t.shots_used / nullif(t.life_shots, 0), 1) as "lifeUsed",
             t.shots_used - t.last_maintenance_at as "sinceService",
             case when t.maintenance_every is not null and t.shots_used - t.last_maintenance_at >= t.maintenance_every then 'Yes' else 'No' end as "serviceDue"
      from tools t where t.status <> 'retired' order by "lifeUsed" desc nulls last`,
  },
];

export const QUALITY_REPORTS: ReportDef[] = [
  {
    kind: 'query',
    key: 'inspection-register',
    title: 'Inspection register',
    category: 'quality',
    description: 'Every inspection decided, with sample and result.',
    permission: 'quality.inspections.read',
    params: PERIOD,
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Inspection', type: 'text', link: { path: '/quality/inspections', idKey: 'id' } },
      { key: 'stage', label: 'Stage', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'batchNo', label: 'Batch', type: 'text' },
      { key: 'lot', label: 'Lot', type: 'qty', total: true },
      { key: 'sample', label: 'Sample', type: 'number' },
      { key: 'defectives', label: 'Defectives', type: 'number' },
      { key: 'result', label: 'Result', type: 'text' },
      { key: 'rejected', label: 'Rejected + rework', type: 'qty', total: true },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, q.stage, i.code || ' ' || i.name as item, q.batch_no as "batchNo", q.lot_qty as lot, q.sample_size as sample,
             q.defectives, q.result, q.rejected_qty + q.rework_qty as rejected
      from quality_inspections q join documents d on d.id = q.id join items i on i.id = q.item_id
      where d.status = 'approved' and ${inPeriod('d', p)} order by d.doc_date, d.number`,
  },
  {
    kind: 'query',
    key: 'supplier-quality',
    title: 'Supplier quality',
    category: 'quality',
    description: 'Incoming inspection results per vendor.',
    permission: 'quality.inspections.read',
    params: PERIOD,
    chart: { label: 'vendor', value: 'rate' },
    columns: [
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'lots', label: 'Lots', type: 'number', total: true },
      { key: 'accepted', label: 'Lots accepted', type: 'number', total: true },
      { key: 'inspected', label: 'Quantity', type: 'qty', total: true },
      { key: 'rejected', label: 'Rejected', type: 'qty', total: true },
      { key: 'rate', label: 'Reject rate', type: 'percent' },
    ],
    query: (p) => sql`
      select pa.name as vendor, count(*) as lots, count(*) filter (where q.result = 'accepted') as accepted, sum(q.lot_qty) as inspected,
             sum(q.rejected_qty + q.rework_qty) as rejected, round(100 * sum(q.rejected_qty + q.rework_qty) / nullif(sum(q.lot_qty), 0), 2) as rate
      from quality_inspections q join documents d on d.id = q.id join goods_receipts g on g.id = q.source_doc_id join parties pa on pa.id = g.vendor_id
      where d.status = 'approved' and q.stage = 'incoming' and ${inPeriod('d', p)} group by pa.name order by rate desc`,
  },
];
