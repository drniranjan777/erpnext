import { sql } from 'drizzle-orm';
import type { AgentDefinition, Finding } from '../framework';
import { many } from '../../../common/sql';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

/**
 * Sales agent: orders past their expected date, quotations about to lapse with no order, overdue
 * invoices to chase (one reminder per customer), and cross-sell from what similar customers buy.
 */
export const salesAgent: AgentDefinition = {
  code: 'sales',
  name: 'Sales agent',
  description: 'Follows up late orders, quotations about to lapse and overdue payments, and spots cross-sell openings.',
  watches: ['Orders past their expected date', 'Quotations nearing validity with no order', 'Overdue invoices per customer', 'Items bought together by other customers'],
  defaultSchedule: 'daily',
  params: {
    quoteDays: { default: 5, label: 'Quotation lapses within (days)' },
    overdueDays: { default: 7, label: 'Chase invoices overdue by (days)' },
    minPairs: { default: 3, label: 'Cross-sell: bought together by at least (customers)' },
  },
  async run({ tx, today, params }) {
    const out: Finding[] = [];

    const late = await many<{ id: string; number: string; customer: string; expectedDate: string; pending: string }>(
      tx,
      sql`select so.id, d.number, p.name as customer, so.expected_date::text as "expectedDate", sum((l.qty - l.delivered_qty) * l.rate)::text as pending
          from sales_orders so join documents d on d.id = so.id join parties p on p.id = so.customer_id join sales_order_lines l on l.order_id = so.id
          where d.status = 'approved' and so.closed_at is null and so.expected_date < ${today}::date and l.qty > l.delivered_qty
          group by so.id, d.number, p.name, so.expected_date`,
    );
    for (const o of late) {
      const days = Math.round((Date.parse(today) - Date.parse(o.expectedDate)) / 86_400_000);
      out.push({
        kind: 'order_late',
        severity: days > 7 ? 'critical' : 'warning',
        title: `Order ${o.number} for ${o.customer} is ${days} days late`,
        body: `${inr(Number(o.pending))} still to deliver against an expected date of ${o.expectedDate}. Update the customer or re-plan production.`,
        evidence: { expectedDate: o.expectedDate, daysLate: days, pendingValue: Number(o.pending) },
        dedupeKey: `solate:${o.id}`,
        entityType: 'sales_order',
        entityId: o.id,
        link: `/sales/orders/${o.id}`,
        confidence: 0.95,
        permission: 'sales.orders.read',
        expiresInDays: 3,
      });
    }

    const quotes = await many<{ id: string; number: string; customerId: string; customer: string; email: string | null; validUntil: string; amount: string }>(
      tx,
      sql`select q.id, d.number, q.customer_id as "customerId", p.name as customer, p.email, q.valid_until::text as "validUntil", d.amount::text as amount
          from sales_quotations q join documents d on d.id = q.id join parties p on p.id = q.customer_id
          where d.status = 'approved' and q.valid_until between ${today}::date and ${today}::date + ${params.quoteDays}::int
            and not exists (select 1 from sales_orders so join documents sd on sd.id = so.id where so.quotation_id = q.id and sd.status <> 'cancelled')`,
    );
    for (const q of quotes) {
      out.push({
        kind: 'quote_followup',
        severity: 'warning',
        title: `Quotation ${q.number} to ${q.customer} lapses on ${q.validUntil}`,
        body: `${inr(Number(q.amount))} with no order yet. A follow-up now often closes it, or extend the validity.`,
        evidence: { validUntil: q.validUntil, amount: Number(q.amount) },
        dedupeKey: `quote:${q.id}`,
        entityType: 'sales_quotation',
        entityId: q.id,
        link: `/sales/quotations/${q.id}`,
        action: q.email
          ? { type: 'email_party', label: `Email ${q.customer} a follow-up`, params: { partyId: q.customerId, subject: `Our quotation ${q.number}`, body: `Dear ${q.customer},\n\nOur quotation ${q.number} is valid until ${q.validUntil}. Please let us know if you would like us to go ahead, or if anything needs to change.\n\nThank you.` }, amount: null }
          : null,
        confidence: 0.8,
        permission: 'sales.quotations.read',
        expiresInDays: 5,
      });
    }

    const overdue = await many<{ customerId: string; customer: string; email: string | null; invoices: number; total: string; oldest: string; list: string }>(
      tx,
      sql`select si.customer_id as "customerId", p.name as customer, p.email, count(*)::int as invoices, sum(si.grand_total - si.received_amount - si.credited_amount)::text as total, min(si.due_date)::text as oldest,
                 string_agg(d.number || ' due ' || to_char(si.due_date, 'DD Mon YYYY') || ': ₹' || to_char(si.grand_total - si.received_amount - si.credited_amount, 'FM99,99,99,999.00'), E'\n' order by si.due_date) as list
          from sales_invoices si join documents d on d.id = si.id join parties p on p.id = si.customer_id
          where d.status in ('approved', 'completed') and si.due_date < ${today}::date - ${params.overdueDays}::int and si.grand_total - si.received_amount - si.credited_amount > 0
          group by si.customer_id, p.name, p.email`,
    );
    for (const c of overdue) {
      const days = Math.round((Date.parse(today) - Date.parse(c.oldest)) / 86_400_000);
      out.push({
        kind: 'payment_overdue',
        severity: days > 60 ? 'critical' : 'warning',
        title: `${c.customer} owes ${inr(Number(c.total))} overdue`,
        body: `${c.invoices} invoice(s), the oldest ${days} days past due.`,
        evidence: { invoices: c.invoices, overdue: Number(c.total), oldestDue: c.oldest, daysOverdue: days },
        dedupeKey: `overdue:${c.customerId}`,
        entityType: 'party',
        entityId: c.customerId,
        link: `/sales/receivables`,
        action: c.email
          ? { type: 'email_party', label: `Send ${c.customer} a payment reminder`, params: { partyId: c.customerId, subject: `Payment reminder: ${inr(Number(c.total))} overdue`, body: `Dear ${c.customer},\n\nOur records show these invoices are past their due date:\n${c.list}\n\nTotal overdue: ${inr(Number(c.total))}. If you have already paid, please share the payment details so we can update our books.\n\nThank you.` }, amount: null }
          : null,
        confidence: 0.95,
        permission: 'sales.invoices.read',
        expiresInDays: 7,
      });
    }

    // Cross-sell: pairs of items that at least N customers bought together; suggest the missing one.
    const pairs = await many<{ customerId: string; customer: string; has: string; hasCode: string; suggest: string; suggestCode: string; suggestName: string; buyers: number }>(
      tx,
      sql`with bought as (
            select distinct si.customer_id, l.item_id from sales_invoice_lines l join sales_invoices si on si.id = l.invoice_id join documents d on d.id = si.id
            where d.status in ('approved', 'completed') and d.doc_date > ${today}::date - 365),
          pairs as (select a.item_id as x, b.item_id as y, count(*)::int as buyers from bought a join bought b on a.customer_id = b.customer_id and a.item_id <> b.item_id group by 1, 2 having count(*) >= ${params.minPairs}::int)
          select distinct on (b.customer_id, p.y) b.customer_id as "customerId", c.name as customer, p.x as has, ix.code as "hasCode", p.y as suggest, iy.code as "suggestCode", iy.name as "suggestName", p.buyers
          from bought b join pairs p on p.x = b.item_id join parties c on c.id = b.customer_id join items ix on ix.id = p.x join items iy on iy.id = p.y
          where not exists (select 1 from bought z where z.customer_id = b.customer_id and z.item_id = p.y)
          order by b.customer_id, p.y, p.buyers desc limit 100`,
    );
    for (const p of pairs) {
      out.push({
        kind: 'cross_sell',
        severity: 'info',
        title: `Offer ${p.suggestCode} to ${p.customer}`,
        body: `${p.buyers} customers who buy ${p.hasCode} also buy ${p.suggestName}; ${p.customer} has not bought it from us.`,
        evidence: { buys: p.hasCode, suggest: p.suggestCode, customersBuyingBoth: p.buyers },
        dedupeKey: `xsell:${p.customerId}:${p.suggest}`,
        entityType: 'party',
        entityId: p.customerId,
        confidence: Math.min(0.9, 0.4 + p.buyers * 0.1),
        permission: 'sales.quotations.manage',
        expiresInDays: 30,
      });
    }
    return out;
  },
};
