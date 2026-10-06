import { sql } from 'drizzle-orm';
import { optional, PERIOD, type ReportDef } from '../report-types';

const warehouse = { key: 'warehouseId', label: 'Warehouse', type: 'warehouse' as const };

export const INVENTORY_REPORTS: ReportDef[] = [
  {
    kind: 'query',
    key: 'stock-summary',
    title: 'Stock summary',
    category: 'inventory',
    description: 'Quantity and value on hand per item and warehouse.',
    permission: 'inventory.stock.read',
    params: [warehouse],
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'group', label: 'Group', type: 'text' },
      { key: 'warehouse', label: 'Warehouse', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty' },
      { key: 'uom', label: 'Unit', type: 'text' },
      { key: 'rate', label: 'Rate', type: 'money' },
      { key: 'value', label: 'Value', type: 'money', total: true },
    ],
    query: (p) => sql`
      select i.code, i.name as item, g.name as "group", w.code as warehouse, v.qty, u.code as uom,
             round(v.value / nullif(v.qty, 0), 2) as rate, v.value
      from stock_valuation v join items i on i.id = v.item_id join warehouses w on w.id = v.warehouse_id join uoms u on u.id = i.base_uom_id
      left join item_groups g on g.id = i.group_id
      where v.qty <> 0 ${optional('v.warehouse_id', p.warehouseId)} order by i.code, w.code`,
  },
  {
    kind: 'query',
    key: 'stock-by-group',
    title: 'Stock value by group',
    category: 'inventory',
    description: 'Inventory value per item group and type.',
    permission: 'inventory.stock.read',
    params: [],
    chart: { label: 'group', value: 'value' },
    columns: [
      { key: 'group', label: 'Group', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'items', label: 'Items', type: 'number', total: true },
      { key: 'value', label: 'Value', type: 'money', total: true },
      { key: 'share', label: 'Share', type: 'percent' },
    ],
    query: () => sql`
      select coalesce(g.name, 'Ungrouped') as "group", i.type, count(distinct i.id) as items, sum(v.value) as value,
             round(100 * sum(v.value) / nullif(sum(sum(v.value)) over (), 0), 2) as share
      from stock_valuation v join items i on i.id = v.item_id left join item_groups g on g.id = i.group_id
      where v.qty <> 0 group by g.name, i.type order by value desc`,
  },
  {
    kind: 'query',
    key: 'stock-movement',
    title: 'Stock movement',
    category: 'inventory',
    description: 'Opening, in, out and closing per item for a period.',
    permission: 'inventory.stock.read',
    params: [...PERIOD, warehouse],
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'opening', label: 'Opening', type: 'qty' },
      { key: 'inward', label: 'In', type: 'qty' },
      { key: 'outward', label: 'Out', type: 'qty' },
      { key: 'closing', label: 'Closing', type: 'qty' },
      { key: 'openingValue', label: 'Opening value', type: 'money', total: true },
      { key: 'inValue', label: 'In value', type: 'money', total: true },
      { key: 'outValue', label: 'Out value', type: 'money', total: true },
      { key: 'closingValue', label: 'Closing value', type: 'money', total: true },
    ],
    query: (p) => sql`
      select i.code, i.name as item,
             coalesce(sum(l.qty) filter (where l.posting_date < ${p.from}::date), 0) as opening,
             coalesce(sum(l.qty) filter (where l.posting_date between ${p.from}::date and ${p.to}::date and l.qty > 0), 0) as inward,
             coalesce(-sum(l.qty) filter (where l.posting_date between ${p.from}::date and ${p.to}::date and l.qty < 0), 0) as outward,
             coalesce(sum(l.qty) filter (where l.posting_date <= ${p.to}::date), 0) as closing,
             coalesce(sum(l.value) filter (where l.posting_date < ${p.from}::date), 0) as "openingValue",
             coalesce(sum(l.value) filter (where l.posting_date between ${p.from}::date and ${p.to}::date and l.qty > 0), 0) as "inValue",
             coalesce(-sum(l.value) filter (where l.posting_date between ${p.from}::date and ${p.to}::date and l.qty < 0), 0) as "outValue",
             coalesce(sum(l.value) filter (where l.posting_date <= ${p.to}::date), 0) as "closingValue"
      from stock_ledger l join items i on i.id = l.item_id
      where l.posting_date <= ${p.to}::date ${optional('l.warehouse_id', p.warehouseId)}
      group by i.code, i.name
      having sum(l.qty) filter (where l.posting_date <= ${p.to}::date) <> 0 or count(*) filter (where l.posting_date >= ${p.from}::date) > 0
      order by i.code`,
  },
  {
    kind: 'query',
    key: 'stock-ageing',
    title: 'Stock ageing',
    category: 'inventory',
    description: 'Stock on hand by age of receipt (first in, first out).',
    permission: 'inventory.stock.read',
    params: [warehouse],
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'warehouse', label: 'Warehouse', type: 'text' },
      { key: 'd30', label: '0–30 days', type: 'qty' },
      { key: 'd90', label: '31–90', type: 'qty' },
      { key: 'd180', label: '91–180', type: 'qty' },
      { key: 'older', label: 'Over 180', type: 'qty' },
      { key: 'value', label: 'Value', type: 'money', total: true },
      { key: 'olderValue', label: 'Value over 180 days', type: 'money', total: true },
    ],
    query: (p) => sql`
      with r as (
        select l.item_id, l.warehouse_id, l.posting_date, l.qty,
               coalesce(sum(l.qty) over (partition by l.item_id, l.warehouse_id order by l.posting_date desc, l.id desc rows between unbounded preceding and 1 preceding), 0) as before
        from stock_ledger l where l.qty > 0 and not l.is_reversal ${optional('l.warehouse_id', p.warehouseId)}
      ), a as (
        select r.item_id, r.warehouse_id, (now() at time zone 'Asia/Kolkata')::date - r.posting_date as age, greatest(0, least(r.qty, v.qty - r.before)) as left_qty, v.value / nullif(v.qty, 0) as rate
        from r join stock_valuation v on v.item_id = r.item_id and v.warehouse_id = r.warehouse_id where v.qty > 0
      )
      select i.code, i.name as item, w.code as warehouse,
             sum(left_qty) filter (where age <= 30) as d30, sum(left_qty) filter (where age between 31 and 90) as d90,
             sum(left_qty) filter (where age between 91 and 180) as d180, sum(left_qty) filter (where age > 180) as older,
             round(sum(left_qty * rate), 2) as value, round(coalesce(sum(left_qty * rate) filter (where age > 180), 0), 2) as "olderValue"
      from a join items i on i.id = a.item_id join warehouses w on w.id = a.warehouse_id
      where left_qty > 0 group by i.code, i.name, w.code order by "olderValue" desc, value desc`,
  },
  {
    kind: 'query',
    key: 'slow-moving',
    title: 'Slow and non-moving stock',
    category: 'inventory',
    description: 'Items in stock with no issue, sale or consumption for a number of days.',
    permission: 'inventory.stock.read',
    params: [{ key: 'days', label: 'No movement for (days)', type: 'number', default: '90' }],
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'On hand', type: 'qty' },
      { key: 'value', label: 'Value', type: 'money', total: true },
      { key: 'lastOut', label: 'Last out', type: 'date' },
      { key: 'idleDays', label: 'Days idle', type: 'number' },
    ],
    query: (p) => sql`
      with oh as (select item_id, sum(qty) as qty, sum(value) as value from stock_valuation group by item_id having sum(qty) > 0),
           lo as (select item_id, max(posting_date) as last_out from stock_ledger where qty < 0 and not is_reversal group by item_id),
           li as (select item_id, min(posting_date) as first_in from stock_ledger where qty > 0 group by item_id)
      select i.code, i.name as item, oh.qty, oh.value, lo.last_out as "lastOut", (now() at time zone 'Asia/Kolkata')::date - coalesce(lo.last_out, li.first_in) as "idleDays"
      from oh join items i on i.id = oh.item_id left join lo on lo.item_id = oh.item_id left join li on li.item_id = oh.item_id
      where (now() at time zone 'Asia/Kolkata')::date - coalesce(lo.last_out, li.first_in) >= ${Number(p.days ?? 90)}::int
      order by oh.value desc`,
  },
  {
    kind: 'query',
    key: 'batch-expiry',
    title: 'Batch expiry',
    category: 'inventory',
    description: 'Batches in stock that have expired or expire soon.',
    permission: 'inventory.stock.read',
    params: [{ key: 'days', label: 'Expiring within (days)', type: 'number', default: '60' }, warehouse],
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'batchNo', label: 'Batch', type: 'text' },
      { key: 'warehouse', label: 'Warehouse', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty' },
      { key: 'expiry', label: 'Expiry', type: 'date' },
      { key: 'daysLeft', label: 'Days left', type: 'number' },
    ],
    query: (p) => sql`
      select i.code, i.name as item, b.batch_no as "batchNo", w.code as warehouse, s.qty, b.expiry_date as expiry, b.expiry_date - (now() at time zone 'Asia/Kolkata')::date as "daysLeft"
      from stock_balances s join batches b on b.id = s.batch_key join items i on i.id = s.item_id join warehouses w on w.id = s.warehouse_id
      where s.qty > 0 and b.expiry_date is not null and b.expiry_date <= (now() at time zone 'Asia/Kolkata')::date + ${Number(p.days ?? 60)}::int ${optional('s.warehouse_id', p.warehouseId)}
      order by b.expiry_date`,
  },
  {
    kind: 'query',
    key: 'reorder',
    title: 'Reorder report',
    category: 'inventory',
    description: 'Items at or below their reorder level, counting open purchase orders.',
    permission: 'inventory.stock.read',
    params: [],
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'onHand', label: 'On hand', type: 'qty' },
      { key: 'onOrder', label: 'On order', type: 'qty' },
      { key: 'reorderLevel', label: 'Reorder level', type: 'qty' },
      { key: 'suggested', label: 'Suggested order', type: 'qty' },
      { key: 'leadTime', label: 'Lead time (days)', type: 'number' },
    ],
    query: () => sql`
      with oh as (select s.item_id, sum(s.qty) as qty from stock_balances s join warehouses w on w.id = s.warehouse_id where w.is_nettable group by s.item_id),
           oo as (select l.item_id, sum(l.base_qty * (l.qty - l.received_qty) / nullif(l.qty, 0)) as qty from purchase_order_lines l join documents d on d.id = l.po_id join purchase_orders po on po.id = l.po_id
                  where d.status = 'approved' and po.closed_at is null and l.qty > l.received_qty group by l.item_id)
      select i.code, i.name as item, coalesce(oh.qty, 0) as "onHand", coalesce(oo.qty, 0) as "onOrder", i.reorder_level as "reorderLevel",
             greatest(coalesce(i.reorder_qty, i.reorder_level - coalesce(oh.qty, 0) - coalesce(oo.qty, 0)), coalesce(i.min_order_qty, 0)) as suggested, i.lead_time_days as "leadTime"
      from items i left join oh on oh.item_id = i.id left join oo on oo.item_id = i.id
      where i.reorder_level is not null and i.is_active and coalesce(oh.qty, 0) + coalesce(oo.qty, 0) <= i.reorder_level
      order by i.code`,
  },
  {
    kind: 'query',
    key: 'serial-register',
    title: 'Serial number register',
    category: 'inventory',
    description: 'Every serial number with where it is now.',
    permission: 'inventory.stock.read',
    params: [{ key: 'itemId', label: 'Item', type: 'item' }],
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'serialNo', label: 'Serial', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'warehouse', label: 'Warehouse', type: 'text' },
      { key: 'lastDoc', label: 'Last document', type: 'text' },
    ],
    query: (p) => sql`
      select i.code, i.name as item, s.serial_no as "serialNo", s.status, w.code as warehouse, d.number as "lastDoc"
      from serial_numbers s join items i on i.id = s.item_id left join warehouses w on w.id = s.warehouse_id left join documents d on d.id = s.last_voucher_id
      where true ${optional('s.item_id', p.itemId)} order by i.code, s.serial_no`,
  },
];
