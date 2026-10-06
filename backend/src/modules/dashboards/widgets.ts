import type { PermissionCode, Transaction } from '@nextgen/database';
import { sql, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';

export type Unit = 'money' | 'number' | 'percent' | 'qty';

export type WidgetData =
  | { kind: 'kpi'; value: string; unit: Unit; sub?: string; tone?: 'good' | 'bad' | 'neutral' }
  | { kind: 'series'; unit: Unit; points: { label: string; value: string }[] }
  | { kind: 'list'; unit: Unit; rows: { label: string; value: string; sub?: string; href?: string }[] };

export interface Ctx {
  auth: AuthContext;
  /** Today in India. */
  today: string;
  monthStart: string;
}

export interface WidgetDef {
  key: string;
  title: string;
  description: string;
  area: 'sales' | 'purchase' | 'stores' | 'production' | 'quality' | 'finance' | 'general';
  permission: PermissionCode | null;
  size: 1 | 2 | 3;
  /** Where clicking the widget goes. */
  href: string;
  compute: (tx: Transaction, c: Ctx) => Promise<WidgetData>;
}

const one = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows[0];
const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const s = (v: unknown) => (v === null || v === undefined ? '0' : String(v));
const POSTED = sql.raw(`d.status in ('approved', 'completed')`);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Same span of the previous month, for month-to-date comparisons. */
const lastMonthSpan = (c: Ctx) => {
  const start = new Date(`${c.monthStart}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const from = start.toISOString().slice(0, 10);
  const days = (Date.parse(`${c.today}T00:00:00Z`) - Date.parse(`${c.monthStart}T00:00:00Z`)) / 86_400_000;
  return { from, to: addDays(from, days) };
};
const change = (now: number, before: number) => (before > 0 ? `${now >= before ? '▲' : '▼'} ${Math.abs(Math.round(((now - before) / before) * 100))}% on last month` : undefined);

export const WIDGETS: WidgetDef[] = [
  // ---- Sales -------------------------------------------------------------------------------
  {
    key: 'sales-mtd',
    title: 'Sales this month',
    description: 'Taxable value invoiced since the 1st, against the same days last month.',
    area: 'sales',
    permission: 'sales.invoices.read',
    size: 1,
    href: '/reports/sales-register',
    compute: async (tx, c) => {
      const lm = lastMonthSpan(c);
      const r = await one<{ now: string; before: string }>(
        tx,
        sql`select coalesce(sum(si.taxable_total) filter (where d.doc_date between ${c.monthStart}::date and ${c.today}::date), 0) as now,
                   coalesce(sum(si.taxable_total) filter (where d.doc_date between ${lm.from}::date and ${lm.to}::date), 0) as before
            from sales_invoices si join documents d on d.id = si.id where ${POSTED} and d.doc_date >= ${lm.from}::date`,
      );
      return { kind: 'kpi', value: s(r.now), unit: 'money', sub: change(Number(r.now), Number(r.before)), tone: Number(r.now) >= Number(r.before) ? 'good' : 'bad' };
    },
  },
  {
    key: 'sales-today',
    title: 'Invoiced today',
    description: 'Taxable value and number of invoices today.',
    area: 'sales',
    permission: 'sales.invoices.read',
    size: 1,
    href: '/sales/invoices',
    compute: async (tx, c) => {
      const r = await one<{ v: string; n: string }>(tx, sql`select coalesce(sum(si.taxable_total), 0) as v, count(*) as n from sales_invoices si join documents d on d.id = si.id where ${POSTED} and d.doc_date = ${c.today}::date`);
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: `${r.n} invoice${r.n === '1' ? '' : 's'}` };
    },
  },
  {
    key: 'sales-trend',
    title: 'Sales by week',
    description: 'Taxable value invoiced in each of the last 12 weeks.',
    area: 'sales',
    permission: 'sales.invoices.read',
    size: 2,
    href: '/reports/sales-by-customer',
    compute: async (tx, c) => {
      const rows = await many<{ week: string; v: string }>(
        tx,
        sql`with w as (select generate_series(date_trunc('week', ${c.today}::date) - interval '11 weeks', date_trunc('week', ${c.today}::date), interval '1 week')::date as week)
            select to_char(w.week, 'DD Mon') as week, coalesce(sum(si.taxable_total), 0) as v
            from w left join documents d on date_trunc('week', d.doc_date)::date = w.week and d.doc_type = 'sales_invoice' and ${POSTED}
            left join sales_invoices si on si.id = d.id group by w.week order by w.week`,
      );
      return { kind: 'series', unit: 'money', points: rows.map((r) => ({ label: r.week, value: s(r.v) })) };
    },
  },
  {
    key: 'top-customers',
    title: 'Top customers this month',
    description: 'Highest invoiced customers since the 1st.',
    area: 'sales',
    permission: 'sales.invoices.read',
    size: 2,
    href: '/reports/sales-by-customer',
    compute: async (tx, c) => {
      const rows = await many<{ name: string; v: string; n: string }>(
        tx,
        sql`select pa.name, sum(si.taxable_total) as v, count(*) as n from sales_invoices si join documents d on d.id = si.id join parties pa on pa.id = si.customer_id
            where ${POSTED} and d.doc_date between ${c.monthStart}::date and ${c.today}::date group by pa.name order by v desc limit 5`,
      );
      return { kind: 'list', unit: 'money', rows: rows.map((r) => ({ label: r.name, value: s(r.v), sub: `${r.n} invoice${r.n === '1' ? '' : 's'}` })) };
    },
  },
  {
    key: 'orders-pending',
    title: 'Orders to deliver',
    description: 'Value of sales order lines not yet delivered.',
    area: 'sales',
    permission: 'sales.orders.read',
    size: 1,
    href: '/reports/pending-sales-orders',
    compute: async (tx, c) => {
      const r = await one<{ v: string; late: string }>(
        tx,
        sql`select coalesce(sum((l.qty - l.delivered_qty) * l.taxable_value / nullif(l.qty, 0)), 0) as v,
                   count(*) filter (where coalesce(l.delivery_date, so.expected_date) < ${c.today}::date) as late
            from sales_order_lines l join sales_orders so on so.id = l.order_id join documents d on d.id = so.id
            where d.status = 'approved' and so.closed_at is null and l.qty > l.delivered_qty`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: Number(r.late) ? `${r.late} line${r.late === '1' ? '' : 's'} late` : 'Nothing late', tone: Number(r.late) ? 'bad' : 'good' };
    },
  },
  {
    key: 'overdue-receivables',
    title: 'Overdue from customers',
    description: 'Invoices past their due date and not yet received.',
    area: 'sales',
    permission: 'sales.invoices.read',
    size: 1,
    href: '/reports/receivables-outstanding',
    compute: async (tx, c) => {
      const r = await one<{ v: string; all: string; n: string }>(
        tx,
        sql`select coalesce(sum(si.grand_total - si.received_amount - si.credited_amount) filter (where si.due_date < ${c.today}::date), 0) as v,
                   coalesce(sum(si.grand_total - si.received_amount - si.credited_amount), 0) as all,
                   count(*) filter (where si.due_date < ${c.today}::date) as n
            from sales_invoices si join documents d on d.id = si.id where ${POSTED} and si.grand_total - si.received_amount - si.credited_amount > 0.005`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: `${r.n} invoice${r.n === '1' ? '' : 's'} · ₹${Number(r.all).toLocaleString('en-IN', { maximumFractionDigits: 0 })} outstanding in all`, tone: Number(r.v) > 0 ? 'bad' : 'good' };
    },
  },
  {
    key: 'overdue-invoices',
    title: 'Most overdue invoices',
    description: 'The five invoices overdue the longest.',
    area: 'sales',
    permission: 'sales.invoices.read',
    size: 2,
    href: '/reports/receivables-outstanding',
    compute: async (tx, c) => {
      const rows = await many<{ id: string; number: string; name: string; v: string; days: number }>(
        tx,
        sql`select d.id, d.number, pa.name, si.grand_total - si.received_amount - si.credited_amount as v, ${c.today}::date - si.due_date as days
            from sales_invoices si join documents d on d.id = si.id join parties pa on pa.id = si.customer_id
            where ${POSTED} and si.due_date < ${c.today}::date and si.grand_total - si.received_amount - si.credited_amount > 0.005 order by si.due_date limit 5`,
      );
      return { kind: 'list', unit: 'money', rows: rows.map((r) => ({ label: `${r.name} · ${r.number}`, value: s(r.v), sub: `${r.days} days overdue`, href: `/sales/invoices/${r.id}` })) };
    },
  },
  // ---- Purchase ---------------------------------------------------------------------------
  {
    key: 'purchases-mtd',
    title: 'Purchases this month',
    description: 'Taxable value of vendor bills posted since the 1st.',
    area: 'purchase',
    permission: 'purchase.invoices.read',
    size: 1,
    href: '/reports/purchase-register',
    compute: async (tx, c) => {
      const lm = lastMonthSpan(c);
      const r = await one<{ now: string; before: string }>(
        tx,
        sql`select coalesce(sum(pi.taxable_total) filter (where d.doc_date between ${c.monthStart}::date and ${c.today}::date), 0) as now,
                   coalesce(sum(pi.taxable_total) filter (where d.doc_date between ${lm.from}::date and ${lm.to}::date), 0) as before
            from purchase_invoices pi join documents d on d.id = pi.id where ${POSTED} and d.doc_date >= ${lm.from}::date`,
      );
      return { kind: 'kpi', value: s(r.now), unit: 'money', sub: change(Number(r.now), Number(r.before)) };
    },
  },
  {
    key: 'pos-pending',
    title: 'Open purchase orders',
    description: 'Value still to be received, and lines past their expected date.',
    area: 'purchase',
    permission: 'purchase.orders.read',
    size: 1,
    href: '/reports/pending-purchase-orders',
    compute: async (tx, c) => {
      const r = await one<{ v: string; late: string }>(
        tx,
        sql`select coalesce(sum((l.qty - l.received_qty) * l.taxable_value / nullif(l.qty, 0)), 0) as v,
                   count(*) filter (where coalesce(l.delivery_date, po.expected_date) < ${c.today}::date) as late
            from purchase_order_lines l join purchase_orders po on po.id = l.po_id join documents d on d.id = po.id
            where d.status = 'approved' and po.closed_at is null and po.po_type <> 'service' and l.qty > l.received_qty`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: Number(r.late) ? `${r.late} line${r.late === '1' ? '' : 's'} overdue from vendors` : 'All on schedule', tone: Number(r.late) ? 'bad' : 'good' };
    },
  },
  {
    key: 'grni',
    title: 'Received, not billed',
    description: 'Goods in without the vendor’s bill.',
    area: 'purchase',
    permission: 'purchase.receipts.read',
    size: 1,
    href: '/reports/grn-pending-bill',
    compute: async (tx) => {
      const r = await one<{ v: string; n: string }>(
        tx,
        sql`select coalesce(sum((l.accepted_qty - l.billed_qty) * l.rate), 0) as v, count(distinct g.id) as n
            from goods_receipt_lines l join goods_receipts g on g.id = l.grn_id join documents d on d.id = g.id where ${POSTED} and l.accepted_qty > l.billed_qty`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: `${r.n} receipt${r.n === '1' ? '' : 's'}` };
    },
  },
  {
    key: 'bills-due-week',
    title: 'Bills due this week',
    description: 'Vendor bills overdue or due in the next 7 days.',
    area: 'purchase',
    permission: 'purchase.invoices.read',
    size: 1,
    href: '/reports/payables-outstanding',
    compute: async (tx, c) => {
      const r = await one<{ v: string; overdue: string }>(
        tx,
        sql`select coalesce(sum(pi.net_payable - pi.paid_amount - pi.debited_amount) filter (where pi.due_date <= ${addDays(c.today, 7)}::date), 0) as v,
                   coalesce(sum(pi.net_payable - pi.paid_amount - pi.debited_amount) filter (where pi.due_date < ${c.today}::date), 0) as overdue
            from purchase_invoices pi join documents d on d.id = pi.id where ${POSTED} and pi.net_payable - pi.paid_amount - pi.debited_amount > 0.005`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: Number(r.overdue) ? `₹${Number(r.overdue).toLocaleString('en-IN', { maximumFractionDigits: 0 })} already overdue` : 'Nothing overdue', tone: Number(r.overdue) ? 'bad' : 'neutral' };
    },
  },
  {
    key: 'msme-due',
    title: 'MSME bills near 45 days',
    description: 'Micro and small vendor bills within a week of the 43B(h) limit.',
    area: 'purchase',
    permission: 'purchase.invoices.read',
    size: 1,
    href: '/reports/msme-dues',
    compute: async (tx, c) => {
      const r = await one<{ n: string; v: string }>(
        tx,
        sql`select count(*) as n, coalesce(sum(pi.net_payable - pi.paid_amount - pi.debited_amount), 0) as v
            from purchase_invoices pi join documents d on d.id = pi.id
            where ${POSTED} and pi.vendor_msme in ('micro', 'small') and pi.net_payable - pi.paid_amount - pi.debited_amount > 0.005
              and coalesce(pi.supplier_invoice_date, d.doc_date) + 45 <= ${addDays(c.today, 7)}::date`,
      );
      return { kind: 'kpi', value: s(r.n), unit: 'number', sub: `₹${Number(r.v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} to pay`, tone: Number(r.n) ? 'bad' : 'good' };
    },
  },
  // ---- Stores ------------------------------------------------------------------------------
  {
    key: 'stock-value',
    title: 'Stock value',
    description: 'Inventory on hand at valuation.',
    area: 'stores',
    permission: 'inventory.stock.read',
    size: 1,
    href: '/reports/stock-summary',
    compute: async (tx) => {
      const r = await one<{ v: string; n: string }>(tx, sql`select coalesce(sum(value), 0) as v, count(distinct item_id) filter (where qty > 0) as n from stock_valuation`);
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: `${r.n} items in stock` };
    },
  },
  {
    key: 'below-reorder',
    title: 'Below reorder level',
    description: 'Items at or under reorder level, counting open orders.',
    area: 'stores',
    permission: 'inventory.stock.read',
    size: 1,
    href: '/reports/reorder',
    compute: async (tx) => {
      const r = await one<{ n: string }>(
        tx,
        sql`with oh as (select s.item_id, sum(s.qty) as qty from stock_balances s join warehouses w on w.id = s.warehouse_id where w.is_nettable group by s.item_id),
                 oo as (select l.item_id, sum(l.base_qty * (l.qty - l.received_qty) / nullif(l.qty, 0)) as qty from purchase_order_lines l join documents d on d.id = l.po_id join purchase_orders po on po.id = l.po_id
                        where d.status = 'approved' and po.closed_at is null and l.qty > l.received_qty group by l.item_id)
            select count(*) as n from items i left join oh on oh.item_id = i.id left join oo on oo.item_id = i.id
            where i.reorder_level is not null and i.is_active and coalesce(oh.qty, 0) + coalesce(oo.qty, 0) <= i.reorder_level`,
      );
      return { kind: 'kpi', value: s(r.n), unit: 'number', sub: 'items to reorder', tone: Number(r.n) ? 'bad' : 'good' };
    },
  },
  {
    key: 'slow-moving-value',
    title: 'Idle stock (90+ days)',
    description: 'Value of stock with no movement out for 90 days.',
    area: 'stores',
    permission: 'inventory.stock.read',
    size: 1,
    href: '/reports/slow-moving?days=90',
    compute: async (tx, c) => {
      const r = await one<{ v: string; n: string }>(
        tx,
        sql`with oh as (select item_id, sum(value) as value from stock_valuation group by item_id having sum(qty) > 0),
                 lo as (select item_id, max(posting_date) as d from stock_ledger where qty < 0 and not is_reversal group by item_id),
                 li as (select item_id, min(posting_date) as d from stock_ledger where qty > 0 group by item_id)
            select coalesce(sum(oh.value), 0) as v, count(*) as n from oh left join lo on lo.item_id = oh.item_id left join li on li.item_id = oh.item_id
            where ${c.today}::date - coalesce(lo.d, li.d) >= 90`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: `${r.n} item${r.n === '1' ? '' : 's'}`, tone: Number(r.v) > 0 ? 'bad' : 'good' };
    },
  },
  {
    key: 'expiring-batches',
    title: 'Expiring in 30 days',
    description: 'Batches in stock that expire within a month.',
    area: 'stores',
    permission: 'inventory.stock.read',
    size: 2,
    href: '/reports/batch-expiry?days=30',
    compute: async (tx, c) => {
      const rows = await many<{ code: string; batch: string; qty: string; days: number }>(
        tx,
        sql`select i.code, b.batch_no as batch, sum(s.qty) as qty, b.expiry_date - ${c.today}::date as days
            from stock_balances s join batches b on b.id = s.batch_key join items i on i.id = s.item_id
            where s.qty > 0 and b.expiry_date <= ${addDays(c.today, 30)}::date group by i.code, b.batch_no, b.expiry_date order by b.expiry_date limit 6`,
      );
      return { kind: 'list', unit: 'qty', rows: rows.map((r) => ({ label: `${r.code} · ${r.batch}`, value: s(r.qty), sub: r.days < 0 ? `expired ${-r.days} days ago` : `${r.days} days left` })) };
    },
  },
  // ---- Production --------------------------------------------------------------------------
  {
    key: 'wo-open',
    title: 'Open work orders',
    description: 'Released and in-progress orders, and how many are late.',
    area: 'production',
    permission: 'manufacturing.production.read',
    size: 1,
    href: '/reports/work-order-status',
    compute: async (tx, c) => {
      const r = await one<{ n: string; late: string }>(
        tx,
        sql`select count(*) as n, count(*) filter (where w.planned_end < ${c.today}::date) as late from work_orders w join documents d on d.id = w.id
            where d.status = 'approved' and w.stage in ('released', 'in_progress')`,
      );
      return { kind: 'kpi', value: s(r.n), unit: 'number', sub: Number(r.late) ? `${r.late} late` : 'None late', tone: Number(r.late) ? 'bad' : 'good' };
    },
  },
  {
    key: 'wo-late',
    title: 'Late work orders',
    description: 'Open orders past their planned end.',
    area: 'production',
    permission: 'manufacturing.production.read',
    size: 2,
    href: '/reports/work-order-status',
    compute: async (tx, c) => {
      const rows = await many<{ id: string; number: string; code: string; made: string; qty: string; days: number }>(
        tx,
        sql`select d.id, d.number, i.code, w.produced_qty as made, w.qty, ${c.today}::date - w.planned_end as days
            from work_orders w join documents d on d.id = w.id join items i on i.id = w.item_id
            where d.status = 'approved' and w.stage in ('released', 'in_progress') and w.planned_end < ${c.today}::date order by w.planned_end limit 6`,
      );
      return { kind: 'list', unit: 'qty', rows: rows.map((r) => ({ label: `${r.number} · ${r.code}`, value: s(r.made), sub: `of ${Number(r.qty)} · ${r.days} days late`, href: `/manufacturing/work-orders/${r.id}` })) };
    },
  },
  {
    key: 'output-today',
    title: 'Made today',
    description: 'Good quantity received from production today.',
    area: 'production',
    permission: 'manufacturing.production.read',
    size: 1,
    href: '/reports/production-by-item',
    compute: async (tx, c) => {
      const r = await one<{ q: string; v: string }>(
        tx,
        sql`select coalesce(sum(e.good_qty), 0) as q, coalesce(sum(e.output_value), 0) as v from production_entries e join documents d on d.id = e.id
            where ${POSTED} and e.kind = 'receipt' and d.doc_date = ${c.today}::date`,
      );
      return { kind: 'kpi', value: s(r.q), unit: 'qty', sub: `₹${Number(r.v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} at standard` };
    },
  },
  {
    key: 'output-trend',
    title: 'Output by day',
    description: 'Good quantity received from production over the last 14 days.',
    area: 'production',
    permission: 'manufacturing.production.read',
    size: 2,
    href: '/reports/production-by-item',
    compute: async (tx, c) => {
      const rows = await many<{ day: string; q: string }>(
        tx,
        sql`with g as (select generate_series(${addDays(c.today, -13)}::date, ${c.today}::date, interval '1 day')::date as day)
            select to_char(g.day, 'DD Mon') as day, coalesce(sum(e.good_qty), 0) as q
            from g left join documents d on d.doc_date = g.day and d.doc_type = 'production_entry' and ${POSTED}
            left join production_entries e on e.id = d.id and e.kind = 'receipt' group by g.day order by g.day`,
      );
      return { kind: 'series', unit: 'qty', points: rows.map((r) => ({ label: r.day, value: s(r.q) })) };
    },
  },
  {
    key: 'reject-rate-week',
    title: 'Reject rate (7 days)',
    description: 'Rejected share of everything booked on job cards in the last week.',
    area: 'production',
    permission: 'manufacturing.production.read',
    size: 1,
    href: '/manufacturing/scrap',
    compute: async (tx, c) => {
      const r = await one<{ good: string; rej: string }>(
        tx,
        sql`select coalesce(sum(good_qty), 0) as good, coalesce(sum(reject_qty), 0) as rej from job_cards
            where status = 'done' and (ended_at at time zone 'Asia/Kolkata')::date > ${addDays(c.today, -7)}::date`,
      );
      const total = Number(r.good) + Number(r.rej);
      const rate = total ? (Number(r.rej) / total) * 100 : 0;
      return { kind: 'kpi', value: rate.toFixed(2), unit: 'percent', sub: `${Number(r.rej)} of ${total} pieces`, tone: rate > 3 ? 'bad' : 'good' };
    },
  },
  {
    key: 'running-cards',
    title: 'Running now',
    description: 'Job cards started and not yet stopped.',
    area: 'production',
    permission: 'manufacturing.production.read',
    size: 1,
    href: '/manufacturing/shop-floor',
    compute: async (tx) => {
      const r = await one<{ n: string; wc: string }>(
        tx,
        sql`select count(*) as n, count(distinct o.work_center_id) as wc from job_cards c join work_order_operations o on o.id = c.operation_id where c.status = 'running'`,
      );
      return { kind: 'kpi', value: s(r.n), unit: 'number', sub: `at ${r.wc} work centre${r.wc === '1' ? '' : 's'}` };
    },
  },
  {
    key: 'wip-value',
    title: 'Work in progress',
    description: 'Value sitting in WIP on open work orders.',
    area: 'production',
    permission: 'manufacturing.production.read',
    size: 1,
    href: '/reports/wip-valuation',
    compute: async (tx) => {
      const r = await one<{ v: string; n: string }>(
        tx,
        sql`select coalesce(sum(w.material_cost + w.conversion_cost + w.subcontract_cost - w.output_value - w.byproduct_value - w.variance_value), 0) as v, count(*) as n
            from work_orders w join documents d on d.id = w.id where d.status = 'approved' and w.stage in ('released', 'in_progress', 'completed')`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: `on ${r.n} order${r.n === '1' ? '' : 's'}` };
    },
  },
  // ---- Quality -----------------------------------------------------------------------------
  {
    key: 'inspections-pending',
    title: 'Lots to inspect',
    description: 'Inspections waiting for a decision.',
    area: 'quality',
    permission: 'quality.inspections.read',
    size: 1,
    href: '/quality/inspections',
    compute: async (tx) => {
      const r = await one<{ n: string; incoming: string }>(
        tx,
        sql`select count(*) as n, count(*) filter (where q.stage = 'incoming') as incoming from quality_inspections q join documents d on d.id = q.id where d.status in ('draft', 'pending_approval')`,
      );
      return { kind: 'kpi', value: s(r.n), unit: 'number', sub: `${r.incoming} incoming`, tone: Number(r.n) ? 'bad' : 'good' };
    },
  },
  {
    key: 'supplier-reject-rate',
    title: 'Supplier rejects (30 days)',
    description: 'Share of incoming material rejected at inspection.',
    area: 'quality',
    permission: 'quality.inspections.read',
    size: 1,
    href: '/reports/supplier-quality',
    compute: async (tx, c) => {
      const r = await one<{ lot: string; rej: string }>(
        tx,
        sql`select coalesce(sum(q.lot_qty), 0) as lot, coalesce(sum(q.rejected_qty + q.rework_qty), 0) as rej from quality_inspections q join documents d on d.id = q.id
            where d.status = 'approved' and q.stage = 'incoming' and d.doc_date > ${addDays(c.today, -30)}::date`,
      );
      const rate = Number(r.lot) ? (Number(r.rej) / Number(r.lot)) * 100 : 0;
      return { kind: 'kpi', value: rate.toFixed(2), unit: 'percent', sub: `${Number(r.rej)} of ${Number(r.lot)} inspected`, tone: rate > 2 ? 'bad' : 'good' };
    },
  },
  {
    key: 'recent-rejections',
    title: 'Recent rejections',
    description: 'Latest lots rejected or partly rejected.',
    area: 'quality',
    permission: 'quality.inspections.read',
    size: 2,
    href: '/quality/inspections',
    compute: async (tx) => {
      const rows = await many<{ id: string; number: string; code: string; stage: string; rej: string }>(
        tx,
        sql`select d.id, d.number, i.code, q.stage, q.rejected_qty + q.rework_qty as rej from quality_inspections q join documents d on d.id = q.id join items i on i.id = q.item_id
            where d.status = 'approved' and q.result in ('rejected', 'partial') order by d.approved_at desc nulls last limit 6`,
      );
      return { kind: 'list', unit: 'qty', rows: rows.map((r) => ({ label: `${r.number} · ${r.code}`, value: s(r.rej), sub: r.stage.replace('_', '-'), href: `/quality/inspections/${r.id}` })) };
    },
  },
  // ---- Finance (reads the books; never creates them) -----------------------------------------
  {
    key: 'cash-bank',
    title: 'Cash and bank',
    description: 'Balance of all cash and bank accounts in the books.',
    area: 'finance',
    permission: 'accounting.accounts.read',
    size: 1,
    href: '/accounting/bank',
    compute: async (tx) => {
      const r = await one<{ v: string; n: string }>(
        tx,
        sql`select coalesce(sum(g.debit - g.credit), 0) as v, count(distinct a.id) as n from accounts a left join gl_entries g on g.account_id = a.id where a.account_type in ('bank', 'cash') and not a.is_group`,
      );
      return { kind: 'kpi', value: s(r.v), unit: 'money', sub: `${r.n} account${r.n === '1' ? '' : 's'}`, tone: Number(r.v) < 0 ? 'bad' : 'neutral' };
    },
  },
  {
    key: 'profit-mtd',
    title: 'Profit this month',
    description: 'Income less expenses booked since the 1st (before closing entries).',
    area: 'finance',
    permission: 'accounting.accounts.read',
    size: 1,
    href: '/accounting/statements',
    compute: async (tx, c) => {
      const r = await one<{ income: string; expense: string }>(
        tx,
        sql`select coalesce(sum(g.credit - g.debit) filter (where a.nature = 'income'), 0) as income, coalesce(sum(g.debit - g.credit) filter (where a.nature = 'expense'), 0) as expense
            from gl_entries g join accounts a on a.id = g.account_id where g.posting_date between ${c.monthStart}::date and ${c.today}::date and not exists (select 1 from journals j where j.id = g.voucher_id and j.kind = 'closing')`,
      );
      const profit = Number(r.income) - Number(r.expense);
      const margin = Number(r.income) ? (profit / Number(r.income)) * 100 : 0;
      return { kind: 'kpi', value: profit.toFixed(2), unit: 'money', sub: Number(r.income) ? `${margin.toFixed(1)}% of income` : 'No income booked yet', tone: profit >= 0 ? 'good' : 'bad' };
    },
  },
  // ---- General -----------------------------------------------------------------------------
  {
    key: 'my-approvals',
    title: 'Waiting for my approval',
    description: 'Documents you can approve now.',
    area: 'general',
    permission: null,
    size: 1,
    href: '/approvals',
    compute: async (tx, c) => {
      const r = await one<{ n: string; v: string }>(
        tx,
        sql`select count(distinct d.id) as n, coalesce(sum(d.amount), 0) as v from document_approvals a join documents d on d.id = a.document_id
            where a.status = 'pending' and d.status = 'pending_approval' and d.submitted_by is distinct from ${c.auth.userId}::uuid
              and (a.approver_user_id = ${c.auth.userId}::uuid or a.approver_role_id in (select role_id from membership_roles where membership_id = ${c.auth.membershipId}::uuid))`,
      );
      return { kind: 'kpi', value: s(r.n), unit: 'number', sub: Number(r.n) ? `₹${Number(r.v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} in all` : 'All clear', tone: Number(r.n) ? 'bad' : 'good' };
    },
  },
];

/** Starting layouts per role; widgets the viewer cannot see are dropped. */
export const PRESETS: Record<string, { name: string; widgets: string[] }> = {
  owner: { name: 'Owner', widgets: ['sales-mtd', 'profit-mtd', 'cash-bank', 'overdue-receivables', 'bills-due-week', 'stock-value', 'wo-open', 'reject-rate-week', 'sales-trend', 'top-customers', 'wo-late', 'my-approvals'] },
  plant: { name: 'Plant head', widgets: ['wo-open', 'output-today', 'reject-rate-week', 'running-cards', 'output-trend', 'wo-late', 'wip-value', 'inspections-pending', 'below-reorder'] },
  sales: { name: 'Sales', widgets: ['sales-mtd', 'sales-today', 'orders-pending', 'overdue-receivables', 'sales-trend', 'top-customers', 'overdue-invoices'] },
  purchase: { name: 'Purchase', widgets: ['purchases-mtd', 'pos-pending', 'grni', 'bills-due-week', 'msme-due', 'below-reorder', 'my-approvals'] },
  stores: { name: 'Stores', widgets: ['stock-value', 'below-reorder', 'slow-moving-value', 'grni', 'expiring-batches', 'pos-pending'] },
  production: { name: 'Production', widgets: ['output-today', 'running-cards', 'wo-open', 'reject-rate-week', 'output-trend', 'wo-late'] },
  finance: { name: 'Finance', widgets: ['cash-bank', 'profit-mtd', 'overdue-receivables', 'bills-due-week', 'msme-due', 'sales-trend', 'overdue-invoices'] },
  qa: { name: 'Quality', widgets: ['inspections-pending', 'supplier-reject-rate', 'reject-rate-week', 'recent-rejections'] },
  tv: { name: 'Shop-floor TV', widgets: ['output-today', 'running-cards', 'reject-rate-week', 'wo-open', 'output-trend', 'wo-late'] },
};
