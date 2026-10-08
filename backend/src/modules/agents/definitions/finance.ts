import { sql } from 'drizzle-orm';
import type { AgentDefinition, Finding } from '../framework';
import { many } from '../../../common/sql';

const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

/**
 * Finance agent: MSME vendors due for payment (45 days under the MSMED Act; also a tax
 * disallowance under s.43B(h)), possible duplicate bills, bills far above a vendor's usual, and a
 * 30-day collections-versus-payments outlook.
 */
export const financeAgent: AgentDefinition = {
  code: 'finance',
  name: 'Finance agent',
  description: 'Watches payables and receivables: MSME payment deadlines, duplicate or unusual bills, and the month ahead.',
  watches: ['MSME bills nearing 45 days', 'Same vendor bill number twice, or same amount within days', 'Bills far above a vendor’s average', 'Collections vs payments due in 30 days'],
  defaultSchedule: 'daily',
  params: {
    msmeWarnDays: { default: 7, label: 'Warn before the MSME deadline (days)' },
    unusualTimes: { default: 3, label: 'Unusual bill: times the vendor average' },
  },
  async run({ tx, today, params }) {
    const out: Finding[] = [];

    const msme = await many<{ id: string; number: string; vendor: string; msme: string; invoiceDate: string; outstanding: string }>(
      tx,
      sql`select pi.id, d.number, p.name as vendor, coalesce(pi.vendor_msme, p.msme_category::text) as msme, coalesce(pi.supplier_invoice_date, d.doc_date)::text as "invoiceDate",
                 (pi.net_payable - pi.paid_amount - pi.debited_amount)::text as outstanding
          from purchase_invoices pi join documents d on d.id = pi.id join parties p on p.id = pi.vendor_id
          where d.status in ('approved', 'completed') and coalesce(pi.vendor_msme, p.msme_category::text) in ('micro', 'small') and pi.net_payable - pi.paid_amount - pi.debited_amount > 0
            and coalesce(pi.supplier_invoice_date, d.doc_date) + 45 <= ${today}::date + ${params.msmeWarnDays}::int`,
    );
    for (const m of msme) {
      const deadline = new Date(Date.parse(m.invoiceDate) + 45 * 86_400_000).toISOString().slice(0, 10);
      const left = Math.round((Date.parse(deadline) - Date.parse(today)) / 86_400_000);
      out.push({
        kind: 'msme_due',
        severity: left < 0 ? 'critical' : 'warning',
        title: left < 0 ? `${m.vendor} (${m.msme} MSME) is ${-left} days past the 45-day limit` : `Pay ${m.vendor} (${m.msme} MSME) by ${deadline}`,
        body: `Bill ${m.number}: ${inr(Number(m.outstanding))} outstanding. Paying an MSME vendor after 45 days attracts interest under the MSMED Act and the expense is disallowed for tax until paid (s.43B(h)).`,
        evidence: { invoiceDate: m.invoiceDate, deadline, daysLeft: left, outstanding: Number(m.outstanding), category: m.msme },
        dedupeKey: `msme:${m.id}`,
        entityType: 'purchase_invoice',
        entityId: m.id,
        link: `/purchase/invoices/${m.id}`,
        confidence: 0.98,
        permission: 'accounting.money.manage',
        expiresInDays: 3,
      });
    }

    const dupes = await many<{ id: string; number: string; otherNumber: string; vendor: string; reason: string; amount: string }>(
      tx,
      sql`select a.id, da.number, db.number as "otherNumber", p.name as vendor, case when a.supplier_invoice_no = b.supplier_invoice_no then 'same vendor bill number' else 'same amount within 10 days' end as reason, a.net_payable::text as amount
          from purchase_invoices a join documents da on da.id = a.id join purchase_invoices b on b.vendor_id = a.vendor_id and b.id < a.id join documents db on db.id = b.id join parties p on p.id = a.vendor_id
          where da.status in ('approved', 'completed', 'pending_approval', 'draft') and db.status in ('approved', 'completed') and da.doc_date > ${today}::date - 60
            and (lower(trim(a.supplier_invoice_no)) = lower(trim(b.supplier_invoice_no)) or (a.net_payable = b.net_payable and a.net_payable > 0 and abs(da.doc_date - db.doc_date) <= 10))`,
    );
    for (const d of dupes) {
      out.push({
        kind: 'duplicate_bill',
        severity: d.reason.startsWith('same vendor') ? 'critical' : 'warning',
        title: `Possible duplicate bill from ${d.vendor}: ${d.number ?? 'draft'} and ${d.otherNumber}`,
        body: `Both have the ${d.reason} (${inr(Number(d.amount))}). Check before paying.`,
        evidence: { reason: d.reason, amount: Number(d.amount), other: d.otherNumber },
        dedupeKey: `dupe:${d.id}`,
        entityType: 'purchase_invoice',
        entityId: d.id,
        link: `/purchase/invoices/${d.id}`,
        confidence: d.reason.startsWith('same vendor') ? 0.9 : 0.6,
        permission: 'accounting.money.manage',
        expiresInDays: 14,
      });
    }

    const unusual = await many<{ id: string; number: string; vendor: string; amount: string; avg: string }>(
      tx,
      sql`select a.id, d.number, p.name as vendor, a.net_payable::text as amount,
                 (select avg(x.net_payable) from purchase_invoices x join documents xd on xd.id = x.id where x.vendor_id = a.vendor_id and x.id <> a.id and xd.status in ('approved', 'completed') and xd.doc_date > d.doc_date - 365)::text as avg,
                 (select count(*) from purchase_invoices x join documents xd on xd.id = x.id where x.vendor_id = a.vendor_id and x.id <> a.id and xd.status in ('approved', 'completed')) as n
          from purchase_invoices a join documents d on d.id = a.id join parties p on p.id = a.vendor_id
          where d.status in ('approved', 'pending_approval') and d.doc_date > ${today}::date - 30`,
    );
    for (const u of unusual as (typeof unusual[number] & { n: string })[]) {
      if (!u.avg || Number(u.n) < 3 || Number(u.amount) <= Number(u.avg) * params.unusualTimes) continue;
      out.push({
        kind: 'unusual_bill',
        severity: 'warning',
        title: `Bill ${u.number} from ${u.vendor} is ${Math.round(Number(u.amount) / Number(u.avg))}× their usual`,
        body: `${inr(Number(u.amount))} against an average of ${inr(Number(u.avg))} over the last year.`,
        evidence: { amount: Number(u.amount), average: Number(u.avg) },
        dedupeKey: `unusual:${u.id}`,
        entityType: 'purchase_invoice',
        entityId: u.id,
        link: `/purchase/invoices/${u.id}`,
        confidence: 0.6,
        permission: 'accounting.money.manage',
        expiresInDays: 14,
      });
    }

    const [cash] = await many<{ receivable: string; payable: string; overdueIn: string }>(
      tx,
      sql`select (select coalesce(sum(si.grand_total - si.received_amount - si.credited_amount), 0) from sales_invoices si join documents d on d.id = si.id where d.status in ('approved', 'completed') and si.due_date <= ${today}::date + 30 and si.due_date >= ${today}::date)::text as receivable,
                 (select coalesce(sum(pi.net_payable - pi.paid_amount - pi.debited_amount), 0) from purchase_invoices pi join documents d on d.id = pi.id where d.status in ('approved', 'completed') and coalesce(pi.due_date, d.doc_date) <= ${today}::date + 30)::text as payable,
                 (select coalesce(sum(si.grand_total - si.received_amount - si.credited_amount), 0) from sales_invoices si join documents d on d.id = si.id where d.status in ('approved', 'completed') and si.due_date < ${today}::date)::text as "overdueIn"`,
    );
    const gap = Number(cash.payable) - Number(cash.receivable);
    if (gap > 0 && Number(cash.payable) > 0) {
      out.push({
        kind: 'cash_outlook',
        severity: gap > Number(cash.receivable) ? 'critical' : 'warning',
        title: `Payments due in 30 days exceed collections due by ${inr(gap)}`,
        body: `Due to pay: ${inr(Number(cash.payable))}. Due to collect: ${inr(Number(cash.receivable))}. Already overdue from customers: ${inr(Number(cash.overdueIn))}; chasing it closes the gap.`,
        evidence: { payable30: Number(cash.payable), receivable30: Number(cash.receivable), overdueReceivable: Number(cash.overdueIn) },
        dedupeKey: `cash:${today.slice(0, 7)}`,
        link: '/sales/receivables',
        confidence: 0.75,
        permission: 'accounting.money.manage',
        expiresInDays: 7,
      });
    }
    return out;
  },
};
