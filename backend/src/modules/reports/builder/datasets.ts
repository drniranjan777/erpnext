import type { PermissionCode } from '@nextgen/database';
import type { ColumnType } from '../report-types';

export type FieldRole = 'dimension' | 'measure';

export interface DatasetField {
  key: string;
  label: string;
  type: ColumnType;
  role: FieldRole;
  /** SQL expression over the dataset's FROM; never built from user input. */
  expr: string;
  /** Measures: the default aggregate when grouping. */
  agg?: 'sum' | 'avg' | 'min' | 'max' | 'count';
}

export interface Dataset {
  key: string;
  title: string;
  description: string;
  permission: PermissionCode;
  from: string;
  where: string;
  /** Column the period filters on (blank = no period). */
  date: string | null;
  fields: DatasetField[];
}

const IST_TODAY = `(now() at time zone 'Asia/Kolkata')::date`;
const d = (key: string, label: string, expr: string, type: ColumnType = 'text'): DatasetField => ({ key, label, type, role: 'dimension', expr });
const m = (key: string, label: string, expr: string, type: ColumnType = 'money', agg: DatasetField['agg'] = 'sum'): DatasetField => ({ key, label, type, role: 'measure', expr, agg });

const SALES_FROM = `sales_invoice_lines l join sales_invoices si on si.id = l.invoice_id join documents doc on doc.id = si.id join parties pa on pa.id = si.customer_id join items i on i.id = l.item_id left join item_groups g on g.id = i.group_id`;
const PURCHASE_FROM = `purchase_invoice_lines l join purchase_invoices pi on pi.id = l.pi_id join documents doc on doc.id = pi.id join parties pa on pa.id = pi.vendor_id join items i on i.id = l.item_id left join item_groups g on g.id = i.group_id`;
const POSTED = `doc.status in ('approved', 'completed')`;

export const DATASETS: Dataset[] = [
  {
    key: 'sales_lines',
    title: 'Sales invoice lines',
    description: 'Every line of every posted sales invoice.',
    permission: 'sales.invoices.read',
    from: SALES_FROM,
    where: POSTED,
    date: 'doc.doc_date',
    fields: [
      d('date', 'Date', 'doc.doc_date', 'date'),
      d('month', 'Month', `to_char(doc.doc_date, 'YYYY-MM')`),
      d('invoice', 'Invoice', 'doc.number'),
      d('customer', 'Customer', 'pa.name'),
      d('state', 'Place of supply', 'si.place_of_supply'),
      d('itemCode', 'Item code', 'i.code'),
      d('item', 'Item', 'i.name'),
      d('group', 'Item group', `coalesce(g.name, 'Ungrouped')`),
      d('hsn', 'HSN', 'l.hsn_code'),
      d('gstRate', 'GST rate', `l.gst_rate::text || '%'`),
      m('qty', 'Quantity', 'l.base_qty', 'qty'),
      m('taxable', 'Taxable value', 'l.taxable_value'),
      m('tax', 'Tax', 'l.cgst_amount + l.sgst_amount + l.igst_amount + l.cess_amount'),
      m('total', 'Line total', 'l.line_total'),
      m('cost', 'Cost', 'coalesce(l.cost_value, 0)'),
      m('margin', 'Margin', 'l.taxable_value - coalesce(l.cost_value, 0)'),
      m('lines', 'Lines', '1', 'number', 'count'),
    ],
  },
  {
    key: 'purchase_lines',
    title: 'Purchase bill lines',
    description: 'Every line of every posted vendor bill.',
    permission: 'purchase.invoices.read',
    from: PURCHASE_FROM,
    where: POSTED,
    date: 'doc.doc_date',
    fields: [
      d('date', 'Date', 'doc.doc_date', 'date'),
      d('month', 'Month', `to_char(doc.doc_date, 'YYYY-MM')`),
      d('bill', 'Bill', 'doc.number'),
      d('vendor', 'Vendor', 'pa.name'),
      d('itemCode', 'Item code', 'i.code'),
      d('item', 'Item', 'i.name'),
      d('group', 'Item group', `coalesce(g.name, 'Ungrouped')`),
      d('itc', 'ITC', `case when l.itc_eligible then 'Eligible' else 'Ineligible' end`),
      m('qty', 'Quantity', 'l.base_qty', 'qty'),
      m('taxable', 'Taxable value', 'l.taxable_value'),
      m('tax', 'Tax', 'l.cgst_amount + l.sgst_amount + l.igst_amount + l.cess_amount'),
      m('rate', 'Rate', 'l.taxable_value / nullif(l.base_qty, 0)', 'money', 'avg'),
      m('lines', 'Lines', '1', 'number', 'count'),
    ],
  },
  {
    key: 'stock_on_hand',
    title: 'Stock on hand',
    description: 'Current quantity and value per item and warehouse.',
    permission: 'inventory.stock.read',
    from: `stock_valuation v join items i on i.id = v.item_id join warehouses w on w.id = v.warehouse_id left join item_groups g on g.id = i.group_id`,
    where: 'v.qty <> 0',
    date: null,
    fields: [
      d('itemCode', 'Item code', 'i.code'),
      d('item', 'Item', 'i.name'),
      d('group', 'Item group', `coalesce(g.name, 'Ungrouped')`),
      d('type', 'Item type', 'i.type::text'),
      d('abc', 'ABC class', `coalesce(i.abc_class, '—')`),
      d('warehouse', 'Warehouse', 'w.code'),
      m('qty', 'Quantity', 'v.qty', 'qty'),
      m('value', 'Value', 'v.value'),
    ],
  },
  {
    key: 'stock_movements',
    title: 'Stock movements',
    description: 'Every stock ledger movement, in and out.',
    permission: 'inventory.stock.read',
    from: `stock_ledger sl join items i on i.id = sl.item_id join warehouses w on w.id = sl.warehouse_id left join item_groups g on g.id = i.group_id`,
    where: 'not sl.is_reversal',
    date: 'sl.posting_date',
    fields: [
      d('date', 'Date', 'sl.posting_date', 'date'),
      d('month', 'Month', `to_char(sl.posting_date, 'YYYY-MM')`),
      d('voucherType', 'Document type', 'sl.voucher_type'),
      d('voucher', 'Document', 'sl.voucher_number'),
      d('itemCode', 'Item code', 'i.code'),
      d('item', 'Item', 'i.name'),
      d('group', 'Item group', `coalesce(g.name, 'Ungrouped')`),
      d('warehouse', 'Warehouse', 'w.code'),
      m('qtyIn', 'Quantity in', 'greatest(sl.qty, 0)', 'qty'),
      m('qtyOut', 'Quantity out', 'greatest(-sl.qty, 0)', 'qty'),
      m('valueIn', 'Value in', 'greatest(sl.value, 0)'),
      m('valueOut', 'Value out', 'greatest(-sl.value, 0)'),
    ],
  },
  {
    key: 'job_cards',
    title: 'Job cards',
    description: 'Finished sittings on the shop floor.',
    permission: 'manufacturing.production.read',
    from: `job_cards c join work_order_operations o on o.id = c.operation_id join work_centers wc on wc.id = o.work_center_id join documents doc on doc.id = c.work_order_id join work_orders wo on wo.id = c.work_order_id join items i on i.id = wo.item_id`,
    where: `c.status = 'done'`,
    date: `(c.ended_at at time zone 'Asia/Kolkata')::date`,
    fields: [
      d('date', 'Date', `(c.ended_at at time zone 'Asia/Kolkata')::date`, 'date'),
      d('month', 'Month', `to_char((c.ended_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM')`),
      d('workOrder', 'Work order', 'doc.number'),
      d('item', 'Item', 'i.code'),
      d('operation', 'Operation', `o.seq || ' ' || o.name`),
      d('workCenter', 'Work centre', 'wc.code'),
      d('operator', 'Operator', `coalesce(c.operator_name, '—')`),
      d('reason', 'Reject reason', `coalesce(nullif(c.reject_reason, ''), '—')`),
      m('minutes', 'Minutes', 'c.minutes', 'number'),
      m('good', 'Good', 'c.good_qty', 'qty'),
      m('rejected', 'Rejected', 'c.reject_qty', 'qty'),
      m('cost', 'Cost', 'c.labour_cost + c.machine_cost + c.overhead_cost + c.subcontract_cost'),
      m('cards', 'Job cards', '1', 'number', 'count'),
    ],
  },
  {
    key: 'production_receipts',
    title: 'Production receipts',
    description: 'Output received from work orders.',
    permission: 'manufacturing.production.read',
    from: `production_entries e join documents doc on doc.id = e.id join work_orders wo on wo.id = e.work_order_id join documents wd on wd.id = wo.id join items i on i.id = wo.item_id left join item_groups g on g.id = i.group_id`,
    where: `${POSTED} and e.kind = 'receipt'`,
    date: 'doc.doc_date',
    fields: [
      d('date', 'Date', 'doc.doc_date', 'date'),
      d('month', 'Month', `to_char(doc.doc_date, 'YYYY-MM')`),
      d('workOrder', 'Work order', 'wd.number'),
      d('kind', 'Order type', 'wo.kind'),
      d('itemCode', 'Item code', 'i.code'),
      d('item', 'Item', 'i.name'),
      d('group', 'Item group', `coalesce(g.name, 'Ungrouped')`),
      m('good', 'Good', 'e.good_qty', 'qty'),
      m('rejected', 'Rejected', 'e.reject_qty', 'qty'),
      m('value', 'Value', 'e.output_value'),
    ],
  },
  {
    key: 'inspections',
    title: 'Inspections',
    description: 'Decided quality inspections.',
    permission: 'quality.inspections.read',
    from: `quality_inspections q join documents doc on doc.id = q.id join items i on i.id = q.item_id left join goods_receipts gr on gr.id = q.source_doc_id left join parties pa on pa.id = gr.vendor_id`,
    where: `doc.status = 'approved'`,
    date: 'doc.doc_date',
    fields: [
      d('date', 'Date', 'doc.doc_date', 'date'),
      d('month', 'Month', `to_char(doc.doc_date, 'YYYY-MM')`),
      d('stage', 'Stage', 'q.stage'),
      d('result', 'Result', 'q.result'),
      d('itemCode', 'Item code', 'i.code'),
      d('vendor', 'Vendor', `coalesce(pa.name, '—')`),
      m('lot', 'Lot quantity', 'q.lot_qty', 'qty'),
      m('rejected', 'Rejected + rework', 'q.rejected_qty + q.rework_qty', 'qty'),
      m('defectives', 'Defective samples', 'q.defectives', 'number'),
      m('lots', 'Lots', '1', 'number', 'count'),
    ],
  },
  {
    key: 'receivables',
    title: 'Open invoices',
    description: 'Invoices not yet fully received.',
    permission: 'sales.invoices.read',
    from: `sales_invoices si join documents doc on doc.id = si.id join parties pa on pa.id = si.customer_id`,
    where: `${POSTED} and si.grand_total - si.received_amount - si.credited_amount > 0.005`,
    date: 'doc.doc_date',
    fields: [
      d('date', 'Invoice date', 'doc.doc_date', 'date'),
      d('invoice', 'Invoice', 'doc.number'),
      d('customer', 'Customer', 'pa.name'),
      d('due', 'Due date', 'si.due_date', 'date'),
      d(
        'bucket',
        'Age',
        `case when si.due_date is null or si.due_date >= ${IST_TODAY} then 'Not due' when ${IST_TODAY} - si.due_date <= 30 then '1–30 days' when ${IST_TODAY} - si.due_date <= 60 then '31–60 days' when ${IST_TODAY} - si.due_date <= 90 then '61–90 days' else 'Over 90 days' end`,
      ),
      m('outstanding', 'Outstanding', 'si.grand_total - si.received_amount - si.credited_amount'),
      m('daysOverdue', 'Days overdue', `greatest(${IST_TODAY} - si.due_date, 0)`, 'number', 'max'),
      m('invoices', 'Invoices', '1', 'number', 'count'),
    ],
  },
];
