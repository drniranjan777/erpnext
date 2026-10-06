import { sql } from 'drizzle-orm';
import { inPeriod, optional, PERIOD, posted, type ReportDef } from '../report-types';

const vendor = { key: 'partyId', label: 'Vendor', type: 'party' as const };
const item = { key: 'itemId', label: 'Item', type: 'item' as const };
const pi = { path: '/purchase/invoices', idKey: 'id' };

export const PURCHASE_REPORTS: ReportDef[] = [
  {
    kind: 'query',
    key: 'purchase-register',
    title: 'Purchase register',
    category: 'purchase',
    description: 'Every posted vendor bill with its GST split and TDS.',
    permission: 'purchase.invoices.read',
    params: [...PERIOD, vendor],
    columns: [
      { key: 'docDate', label: 'Posted', type: 'date' },
      { key: 'number', label: 'Bill', type: 'text', link: pi },
      { key: 'supplierInvoiceNo', label: 'Supplier invoice', type: 'text' },
      { key: 'supplierInvoiceDate', label: 'Invoice date', type: 'date' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'gstin', label: 'GSTIN', type: 'text' },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'cgst', label: 'CGST', type: 'money', total: true },
      { key: 'sgst', label: 'SGST', type: 'money', total: true },
      { key: 'igst', label: 'IGST', type: 'money', total: true },
      { key: 'tds', label: 'TDS', type: 'money', total: true },
      { key: 'total', label: 'Bill total', type: 'money', total: true },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pi.supplier_invoice_no as "supplierInvoiceNo", pi.supplier_invoice_date as "supplierInvoiceDate",
             pa.name as vendor, pi.vendor_gstin as gstin, pi.taxable_total as taxable, pi.cgst_total as cgst, pi.sgst_total as sgst, pi.igst_total as igst, pi.tds_amount as tds, pi.grand_total as total
      from purchase_invoices pi join documents d on d.id = pi.id join parties pa on pa.id = pi.vendor_id
      where ${posted('d')} and ${inPeriod('d', p)} ${optional('pi.vendor_id', p.partyId)} order by d.doc_date, d.number`,
  },
  {
    kind: 'query',
    key: 'pending-purchase-orders',
    title: 'Pending purchase orders',
    category: 'purchase',
    description: 'Order lines not yet received in full.',
    permission: 'purchase.orders.read',
    params: [vendor, item],
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Order', type: 'text', link: { path: '/purchase/orders', idKey: 'id' } },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'ordered', label: 'Ordered', type: 'qty' },
      { key: 'received', label: 'Received', type: 'qty' },
      { key: 'pending', label: 'Pending', type: 'qty', total: true },
      { key: 'value', label: 'Pending value', type: 'money', total: true },
      { key: 'due', label: 'Expected', type: 'date' },
      { key: 'daysLate', label: 'Days late', type: 'number' },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as vendor, i.code || ' ' || i.name as item, l.qty as ordered, l.received_qty as received,
             l.qty - l.received_qty as pending, round((l.qty - l.received_qty) * l.taxable_value / nullif(l.qty, 0), 2) as value,
             coalesce(l.delivery_date, po.expected_date) as due, greatest((now() at time zone 'Asia/Kolkata')::date - coalesce(l.delivery_date, po.expected_date), 0) as "daysLate"
      from purchase_order_lines l join purchase_orders po on po.id = l.po_id join documents d on d.id = po.id
      join parties pa on pa.id = po.vendor_id join items i on i.id = l.item_id
      where d.status = 'approved' and po.closed_at is null and po.po_type <> 'service' and l.qty > l.received_qty ${optional('po.vendor_id', p.partyId)} ${optional('l.item_id', p.itemId)}
      order by due nulls last, d.number`,
  },
  {
    kind: 'query',
    key: 'purchases-by-vendor',
    title: 'Purchases by vendor',
    category: 'purchase',
    description: 'Billed value per vendor, net of debit notes.',
    permission: 'purchase.invoices.read',
    params: PERIOD,
    chart: { label: 'vendor', value: 'net' },
    columns: [
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'bills', label: 'Bills', type: 'number', total: true },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'debited', label: 'Debit notes', type: 'money', total: true },
      { key: 'net', label: 'Net purchases', type: 'money', total: true },
      { key: 'share', label: 'Share', type: 'percent' },
    ],
    query: (p) => sql`
      with s as (
        select pi.vendor_id, count(*) as bills, sum(pi.taxable_total) as taxable, 0::numeric as debited
        from purchase_invoices pi join documents d on d.id = pi.id where ${posted('d')} and ${inPeriod('d', p)} group by pi.vendor_id
        union all
        select dn.vendor_id, 0, 0, sum(dn.taxable_total) from debit_notes dn join documents d on d.id = dn.id where ${posted('d')} and ${inPeriod('d', p)} group by dn.vendor_id
      ), g as (select vendor_id, sum(bills) as bills, sum(taxable) as taxable, sum(debited) as debited, sum(taxable) - sum(debited) as net from s group by vendor_id)
      select pa.name as vendor, g.bills, g.taxable, g.debited, g.net, round(100 * g.net / nullif(sum(g.net) over (), 0), 2) as share
      from g join parties pa on pa.id = g.vendor_id order by g.net desc`,
  },
  {
    kind: 'query',
    key: 'purchases-by-item',
    title: 'Purchases by item',
    category: 'purchase',
    description: 'Quantity and value billed per item, with average, lowest and highest rate.',
    permission: 'purchase.invoices.read',
    params: [...PERIOD, vendor],
    chart: { label: 'item', value: 'taxable' },
    columns: [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty', total: true },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'avgRate', label: 'Average rate', type: 'money' },
      { key: 'minRate', label: 'Lowest', type: 'money' },
      { key: 'maxRate', label: 'Highest', type: 'money' },
    ],
    query: (p) => sql`
      select i.code, i.name as item, sum(l.base_qty) as qty, sum(l.taxable_value) as taxable,
             round(sum(l.taxable_value) / nullif(sum(l.base_qty), 0), 2) as "avgRate",
             min(l.taxable_value / nullif(l.base_qty, 0))::numeric(18,2) as "minRate", max(l.taxable_value / nullif(l.base_qty, 0))::numeric(18,2) as "maxRate"
      from purchase_invoice_lines l join purchase_invoices pi on pi.id = l.pi_id join documents d on d.id = pi.id join items i on i.id = l.item_id
      where ${posted('d')} and ${inPeriod('d', p)} ${optional('pi.vendor_id', p.partyId)}
      group by i.code, i.name order by taxable desc`,
  },
  {
    kind: 'query',
    key: 'grn-pending-bill',
    title: 'Received, not billed',
    category: 'purchase',
    description: 'Goods receipts still waiting for the vendor’s bill (GRNI).',
    permission: 'purchase.receipts.read',
    params: [vendor],
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Receipt', type: 'text', link: { path: '/purchase/receipts', idKey: 'id' } },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'pending', label: 'To bill', type: 'qty', total: true },
      { key: 'value', label: 'Value', type: 'money', total: true },
      { key: 'days', label: 'Days since receipt', type: 'number' },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as vendor, i.code || ' ' || i.name as item, l.accepted_qty - l.billed_qty as pending,
             round((l.accepted_qty - l.billed_qty) * l.rate, 2) as value, (now() at time zone 'Asia/Kolkata')::date - d.doc_date as days
      from goods_receipt_lines l join goods_receipts g on g.id = l.grn_id join documents d on d.id = g.id
      join parties pa on pa.id = g.vendor_id join items i on i.id = l.item_id
      where ${posted('d')} and l.accepted_qty > l.billed_qty ${optional('g.vendor_id', p.partyId)} order by d.doc_date`,
  },
  {
    kind: 'query',
    key: 'debit-notes-register',
    title: 'Debit notes register',
    category: 'purchase',
    description: 'Returns to vendors and price reductions claimed.',
    permission: 'purchase.invoices.read',
    params: PERIOD,
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Debit note', type: 'text', link: { path: '/purchase/debit-notes', idKey: 'id' } },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'taxable', label: 'Taxable', type: 'money', total: true },
      { key: 'total', label: 'Total', type: 'money', total: true },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as vendor, dn.kind, dn.reason, dn.taxable_total as taxable, dn.grand_total as total
      from debit_notes dn join documents d on d.id = dn.id join parties pa on pa.id = dn.vendor_id
      where ${posted('d')} and ${inPeriod('d', p)} order by d.doc_date`,
  },
  {
    kind: 'query',
    key: 'payables-outstanding',
    title: 'Outstanding bills',
    category: 'purchase',
    description: 'Vendor bills not fully paid, by due date.',
    permission: 'purchase.invoices.read',
    params: [vendor],
    columns: [
      { key: 'docDate', label: 'Posted', type: 'date' },
      { key: 'number', label: 'Bill', type: 'text', link: pi },
      { key: 'supplierInvoiceNo', label: 'Supplier invoice', type: 'text' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'msme', label: 'MSME', type: 'text' },
      { key: 'outstanding', label: 'Outstanding', type: 'money', total: true },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'overdue', label: 'Days overdue', type: 'number' },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pi.supplier_invoice_no as "supplierInvoiceNo", pa.name as vendor, pi.vendor_msme as msme,
             pi.net_payable - pi.paid_amount - pi.debited_amount as outstanding, pi.due_date as due, greatest((now() at time zone 'Asia/Kolkata')::date - pi.due_date, 0) as overdue
      from purchase_invoices pi join documents d on d.id = pi.id join parties pa on pa.id = pi.vendor_id
      where ${posted('d')} and pi.net_payable - pi.paid_amount - pi.debited_amount > 0.005 ${optional('pi.vendor_id', p.partyId)}
      order by pi.due_date nulls last`,
  },
  {
    kind: 'query',
    key: 'msme-dues',
    title: 'MSME payments due (43B(h))',
    category: 'purchase',
    description: 'Unpaid bills of micro and small enterprises, against the 45-day limit.',
    permission: 'purchase.invoices.read',
    params: [],
    columns: [
      { key: 'number', label: 'Bill', type: 'text', link: pi },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'invoiceDate', label: 'Invoice date', type: 'date' },
      { key: 'outstanding', label: 'Outstanding', type: 'money', total: true },
      { key: 'limit', label: 'Pay by', type: 'date' },
      { key: 'daysLeft', label: 'Days left', type: 'number' },
    ],
    query: () => sql`
      select d.id, d.number, pa.name as vendor, pi.vendor_msme as category, coalesce(pi.supplier_invoice_date, d.doc_date) as "invoiceDate",
             pi.net_payable - pi.paid_amount - pi.debited_amount as outstanding, coalesce(pi.supplier_invoice_date, d.doc_date) + 45 as "limit",
             coalesce(pi.supplier_invoice_date, d.doc_date) + 45 - (now() at time zone 'Asia/Kolkata')::date as "daysLeft"
      from purchase_invoices pi join documents d on d.id = pi.id join parties pa on pa.id = pi.vendor_id
      where ${posted('d')} and pi.vendor_msme in ('micro', 'small') and pi.net_payable - pi.paid_amount - pi.debited_amount > 0.005
      order by "daysLeft"`,
  },
  {
    kind: 'query',
    key: 'purchase-price-history',
    title: 'Purchase price history',
    category: 'purchase',
    description: 'Every rate paid for an item, by vendor and date.',
    permission: 'purchase.invoices.read',
    params: [{ ...item, required: true }, ...PERIOD],
    chart: { label: 'docDate', value: 'rate' },
    columns: [
      { key: 'docDate', label: 'Date', type: 'date' },
      { key: 'number', label: 'Bill', type: 'text', link: pi },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty', total: true },
      { key: 'rate', label: 'Rate (base unit)', type: 'money' },
    ],
    query: (p) => sql`
      select d.id, d.doc_date as "docDate", d.number, pa.name as vendor, l.base_qty as qty, round(l.taxable_value / nullif(l.base_qty, 0), 2) as rate
      from purchase_invoice_lines l join purchase_invoices pi on pi.id = l.pi_id join documents d on d.id = pi.id join parties pa on pa.id = pi.vendor_id
      where ${posted('d')} and ${inPeriod('d', p)} and l.item_id = ${p.itemId}::uuid order by d.doc_date`,
  },
];
