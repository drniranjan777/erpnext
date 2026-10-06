import { GST_STATES } from '@nextgen/database';
import { sql } from 'drizzle-orm';
import { inPeriod, optional, PERIOD, posted, type ReportDef } from '../report-types';

const party = { key: 'partyId', label: 'Customer', type: 'party' as const };
const item = { key: 'itemId', label: 'Item', type: 'item' as const };
const inv = { path: '/sales/invoices', idKey: 'id' };

export const SALES_REPORTS: ReportDef[] = [
  {
    kind: 'query',
    key: 'sales-register',
    title: 'Sales register',
    category: 'sales',
    description: 'Every posted invoice with its GST split.',
    permission: 'sales.invoices.read',
    params: [...PERIOD, party],
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Invoice', type: 'text', link: inv },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'pos', label: 'Place of supply', type: 'text' },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'cgst', label: 'CGST', type: 'money', total: true },
      { key: 'sgst', label: 'SGST', type: 'money', total: true },
      { key: 'igst', label: 'IGST', type: 'money', total: true },
      { key: 'cess', label: 'Cess', type: 'money', total: true },
      { key: 'total', label: 'Invoice total', type: 'money', total: true },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as customer, si.customer_gstin as gstin, si.place_of_supply as pos,
             si.taxable_total as taxable, si.cgst_total as cgst, si.sgst_total as sgst, si.igst_total as igst, si.cess_total as cess, si.grand_total as total
      from sales_invoices si join documents d on d.id = si.id join parties pa on pa.id = si.customer_id
      where ${posted('d')} and ${inPeriod('d', p)} ${optional('si.customer_id', p.partyId)}
      order by d.doc_date, d.number`,
    post: (rows) => rows.map((r) => ({ ...r, pos: r.pos ? `${r.pos} ${GST_STATES[r.pos as string] ?? ''}`.trim() : null })),
  },
  {
    kind: 'query',
    key: 'sales-by-customer',
    title: 'Sales by customer',
    category: 'sales',
    description: 'Invoiced value per customer, net of credit notes.',
    permission: 'sales.invoices.read',
    params: PERIOD,
    chart: { label: 'customer', value: 'net' },
    columns: [
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'invoices', label: 'Invoices', type: 'number', total: true },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'credited', label: 'Credit notes', type: 'money', total: true },
      { key: 'net', label: 'Net sales', type: 'money', total: true },
      { key: 'share', label: 'Share', type: 'percent' },
    ],
    query: (p) => sql`
      with s as (
        select si.customer_id, count(*) as invoices, sum(si.taxable_total) as taxable, 0::numeric as credited
        from sales_invoices si join documents d on d.id = si.id where ${posted('d')} and ${inPeriod('d', p)} group by si.customer_id
        union all
        select cn.customer_id, 0, 0, sum(cn.taxable_total) from credit_notes cn join documents d on d.id = cn.id where ${posted('d')} and ${inPeriod('d', p)} group by cn.customer_id
      ), g as (select customer_id, sum(invoices) as invoices, sum(taxable) as taxable, sum(credited) as credited, sum(taxable) - sum(credited) as net from s group by customer_id)
      select pa.name as customer, g.invoices, g.taxable, g.credited, g.net,
             round(100 * g.net / nullif(sum(g.net) over (), 0), 2) as share
      from g join parties pa on pa.id = g.customer_id order by g.net desc`,
  },
  {
    kind: 'query',
    key: 'sales-by-item',
    title: 'Sales by item',
    category: 'sales',
    description: 'Quantity and value invoiced per item, with the average rate.',
    permission: 'sales.invoices.read',
    params: [...PERIOD, party],
    chart: { label: 'item', value: 'taxable' },
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty', total: true },
      { key: 'uom', label: 'Unit', type: 'text' },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'avgRate', label: 'Average rate', type: 'money' },
    ],
    query: (p) => sql`
      select i.code, i.name as item, sum(l.base_qty) as qty, u.code as uom, sum(l.taxable_value) as taxable,
             round(sum(l.taxable_value) / nullif(sum(l.base_qty), 0), 2) as "avgRate"
      from sales_invoice_lines l join sales_invoices si on si.id = l.invoice_id join documents d on d.id = si.id
      join items i on i.id = l.item_id join uoms u on u.id = i.base_uom_id
      where ${posted('d')} and ${inPeriod('d', p)} ${optional('si.customer_id', p.partyId)}
      group by i.code, i.name, u.code order by taxable desc`,
  },
  {
    kind: 'query',
    key: 'sales-by-state',
    title: 'Sales by state',
    category: 'sales',
    description: 'Taxable value by place of supply.',
    permission: 'sales.invoices.read',
    params: PERIOD,
    chart: { label: 'state', value: 'taxable' },
    columns: [
      { key: 'state', label: 'State', type: 'text' },
      { key: 'invoices', label: 'Invoices', type: 'number', total: true },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'tax', label: 'Tax', type: 'money', total: true },
    ],
    query: (p) => sql`
      select coalesce(si.place_of_supply, '—') as state, count(*) as invoices, sum(si.taxable_total) as taxable, sum(si.tax_total) as tax
      from sales_invoices si join documents d on d.id = si.id where ${posted('d')} and ${inPeriod('d', p)}
      group by si.place_of_supply order by taxable desc`,
    post: (rows) => rows.map((r) => ({ ...r, state: GST_STATES[r.state as string] ? `${r.state} ${GST_STATES[r.state as string]}` : r.state })),
  },
  {
    kind: 'query',
    key: 'sales-margin',
    title: 'Margin by item',
    category: 'sales',
    description: 'Sales value against the stock cost of what was sold.',
    permission: 'sales.invoices.read',
    params: PERIOD,
    chart: { label: 'item', value: 'margin' },
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty', total: true },
      { key: 'sales', label: 'Sales', type: 'money', total: true },
      { key: 'cost', label: 'Cost', type: 'money', total: true },
      { key: 'margin', label: 'Margin', type: 'money', total: true },
      { key: 'marginPct', label: 'Margin %', type: 'percent' },
    ],
    query: (p) => sql`
      select i.code, i.name as item, sum(l.base_qty) as qty, sum(l.taxable_value) as sales,
             sum(coalesce(l.cost_value, l.unit_cost * l.base_qty, 0)) as cost,
             sum(l.taxable_value) - sum(coalesce(l.cost_value, l.unit_cost * l.base_qty, 0)) as margin,
             round(100 * (sum(l.taxable_value) - sum(coalesce(l.cost_value, l.unit_cost * l.base_qty, 0))) / nullif(sum(l.taxable_value), 0), 2) as "marginPct"
      from sales_invoice_lines l join documents d on d.id = l.invoice_id join items i on i.id = l.item_id
      where ${posted('d')} and ${inPeriod('d', p)} and i.type <> 'service'
      group by i.code, i.name order by margin desc`,
  },
  {
    kind: 'query',
    key: 'pending-sales-orders',
    title: 'Pending sales orders',
    category: 'sales',
    description: 'Order lines not yet delivered in full.',
    permission: 'sales.orders.read',
    params: [party, item],
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Order', type: 'text', link: { path: '/sales/orders', idKey: 'id' } },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'ordered', label: 'Ordered', type: 'qty' },
      { key: 'delivered', label: 'Delivered', type: 'qty' },
      { key: 'pending', label: 'Pending', type: 'qty', total: true },
      { key: 'value', label: 'Pending value', type: 'money', total: true },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'daysLate', label: 'Days late', type: 'number' },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as customer, i.code || ' ' || i.name as item, l.qty as ordered, l.delivered_qty as delivered,
             l.qty - l.delivered_qty as pending, round((l.qty - l.delivered_qty) * l.taxable_value / nullif(l.qty, 0), 2) as value,
             coalesce(l.delivery_date, so.expected_date) as due,
             greatest((now() at time zone 'Asia/Kolkata')::date - coalesce(l.delivery_date, so.expected_date), 0) as "daysLate"
      from sales_order_lines l join sales_orders so on so.id = l.order_id join documents d on d.id = so.id
      join parties pa on pa.id = so.customer_id join items i on i.id = l.item_id
      where d.status = 'approved' and so.closed_at is null and l.qty > l.delivered_qty ${optional('so.customer_id', p.partyId)} ${optional('l.item_id', p.itemId)}
      order by due nulls last, d.number`,
  },
  {
    kind: 'query',
    key: 'delivered-not-invoiced',
    title: 'Delivered, not invoiced',
    category: 'sales',
    description: 'Delivery challans still waiting for an invoice.',
    permission: 'sales.deliveries.read',
    params: [party],
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Delivery', type: 'text', link: { path: '/sales/deliveries', idKey: 'id' } },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'pending', label: 'To invoice', type: 'qty', total: true },
      { key: 'cost', label: 'Cost of goods', type: 'money', total: true },
      { key: 'days', label: 'Days since delivery', type: 'number' },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as customer, i.code || ' ' || i.name as item, l.qty - l.invoiced_qty as pending,
             round(coalesce(l.cost_value, 0) * (l.qty - l.invoiced_qty) / nullif(l.qty, 0), 2) as cost, (now() at time zone 'Asia/Kolkata')::date - d.doc_date as days
      from delivery_note_lines l join delivery_notes dn on dn.id = l.delivery_id join documents d on d.id = dn.id
      join parties pa on pa.id = dn.customer_id join items i on i.id = l.item_id
      where d.status = 'approved' and l.qty > l.invoiced_qty ${optional('dn.customer_id', p.partyId)}
      order by d.doc_date`,
  },
  {
    kind: 'query',
    key: 'credit-notes-register',
    title: 'Credit notes register',
    category: 'sales',
    description: 'Returns and price reductions given to customers.',
    permission: 'sales.invoices.read',
    params: PERIOD,
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Credit note', type: 'text', link: { path: '/sales/credit-notes', idKey: 'id' } },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'tax', label: 'Tax', type: 'money', total: true },
      { key: 'total', label: 'Total', type: 'money', total: true },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as customer, cn.kind, cn.reason, cn.taxable_total as taxable, cn.tax_total as tax, cn.grand_total as total
      from credit_notes cn join documents d on d.id = cn.id join parties pa on pa.id = cn.customer_id
      where ${posted('d')} and ${inPeriod('d', p)} order by d.doc_date, d.number`,
  },
  {
    kind: 'query',
    key: 'quotation-conversion',
    title: 'Quotation conversion',
    category: 'sales',
    description: 'Quotations sent and which became orders.',
    permission: 'sales.quotations.read',
    params: PERIOD,
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Quotation', type: 'text', link: { path: '/sales/quotations', idKey: 'id' } },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'value', label: 'Value', type: 'money', total: true },
      { key: 'order', label: 'Order', type: 'text' },
      { key: 'converted', label: 'Converted value', type: 'money', total: true },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as customer, q.taxable_total as value,
             (select string_agg(od.number, ', ') from sales_orders so join documents od on od.id = so.id where so.quotation_id = q.id and od.status <> 'cancelled') as "order",
             coalesce((select sum(so.taxable_total) from sales_orders so join documents od on od.id = so.id where so.quotation_id = q.id and od.status in ('approved', 'completed')), 0) as converted
      from sales_quotations q join documents d on d.id = q.id join parties pa on pa.id = q.customer_id
      where d.status <> 'draft' and d.status <> 'cancelled' and ${inPeriod('d', p)} order by d.doc_date`,
  },
  {
    kind: 'query',
    key: 'receivables-outstanding',
    title: 'Outstanding invoices',
    category: 'sales',
    description: 'Invoices not fully received, with days overdue.',
    permission: 'sales.invoices.read',
    params: [party],
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Invoice', type: 'text', link: inv },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'total', label: 'Invoice total', type: 'money', total: true },
      { key: 'outstanding', label: 'Outstanding', type: 'money', total: true },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'overdue', label: 'Days overdue', type: 'number' },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as customer, si.grand_total as total,
             si.grand_total - si.received_amount - si.credited_amount as outstanding, si.due_date as due,
             greatest((now() at time zone 'Asia/Kolkata')::date - si.due_date, 0) as overdue
      from sales_invoices si join documents d on d.id = si.id join parties pa on pa.id = si.customer_id
      where ${posted('d')} and si.grand_total - si.received_amount - si.credited_amount > 0.005 ${optional('si.customer_id', p.partyId)}
      order by si.due_date nulls last`,
  },
];
