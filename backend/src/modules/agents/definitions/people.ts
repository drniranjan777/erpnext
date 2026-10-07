import { sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '@nextgen/database';
import { statutoryDue, type AgentDefinition, type Finding } from '../framework';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

/** HR agent: unexplained absence streaks, habitual lateness, and probations ending without a decision. */
export const hrAgent: AgentDefinition = {
  code: 'hr',
  name: 'HR agent',
  description: 'Watches attendance for unexplained absences and habitual lateness, and probations ending without confirmation.',
  watches: ['Absent several days in a row without leave', 'Late on many days this month', 'Probation ending in a week'],
  defaultSchedule: 'daily',
  params: { absentDays: { default: 3, label: 'Absent in a row (days)' }, lateDays: { default: 5, label: 'Late on (days in 30)' } },
  async run({ tx, today, params }) {
    const out: Finding[] = [];
    const absent = await many<{ employeeId: string; code: string; name: string; days: number; since: string }>(
      tx,
      sql`with recent as (
            select a.employee_id, a.date, a.status, row_number() over (partition by a.employee_id order by a.date desc) as rn from attendance_days a
            where a.date between ${today}::date - 14 and ${today}::date - 1),
          streak as (select employee_id, count(*)::int as days, min(date)::text as since from recent r
            where r.status = 'absent' and not exists (select 1 from recent x where x.employee_id = r.employee_id and x.rn < r.rn and x.status <> 'absent' and x.status <> 'weekly_off' and x.status <> 'holiday')
            group by employee_id)
          select s.employee_id as "employeeId", e.code, e.full_name as name, s.days, s.since from streak s join employees e on e.id = s.employee_id
          where e.status = 'active' and s.days >= ${params.absentDays}::int`,
    );
    for (const a of absent) {
      out.push({
        kind: 'absence_streak',
        severity: a.days >= 5 ? 'critical' : 'warning',
        title: `${a.name} (${a.code}) absent ${a.days} days running`,
        body: `No leave on record since ${a.since}. Check on them, and record leave or start the absconding process.`,
        evidence: { days: a.days, since: a.since },
        dedupeKey: `absent:${a.employeeId}:${a.since}`,
        entityType: 'employee',
        entityId: a.employeeId,
        link: `/hr/employees/${a.employeeId}`,
        confidence: 0.9,
        permission: 'hr.attendance.manage',
        expiresInDays: 3,
      });
    }
    const late = await many<{ employeeId: string; code: string; name: string; days: number; minutes: number }>(
      tx,
      sql`select a.employee_id as "employeeId", e.code, e.full_name as name, count(*)::int as days, sum(a.late_minutes)::int as minutes
          from attendance_days a join employees e on e.id = a.employee_id where a.date > ${today}::date - 30 and a.late_minutes > 0 and e.status = 'active'
          group by a.employee_id, e.code, e.full_name having count(*) >= ${params.lateDays}::int`,
    );
    for (const l of late) {
      out.push({
        kind: 'habitual_late',
        severity: 'info',
        title: `${l.name} (${l.code}) late on ${l.days} days this month`,
        body: `${l.minutes} minutes in all. A word now may be enough; the attendance policy may also deduct for it.`,
        evidence: { days: l.days, minutes: l.minutes },
        dedupeKey: `late:${l.employeeId}:${today.slice(0, 7)}`,
        entityType: 'employee',
        entityId: l.employeeId,
        link: `/hr/employees/${l.employeeId}`,
        confidence: 0.8,
        permission: 'hr.attendance.read',
        expiresInDays: 14,
      });
    }
    const probation = await many<{ id: string; code: string; name: string; probationEnd: string }>(
      tx,
      sql`select id, code, full_name as name, probation_end::text as "probationEnd" from employees
          where status = 'active' and confirmed_on is null and probation_end between ${today}::date - 7 and ${today}::date + 7`,
    );
    for (const p of probation) {
      out.push({
        kind: 'probation_end',
        severity: p.probationEnd < today ? 'warning' : 'info',
        title: `${p.name}'s probation ${p.probationEnd < today ? 'ended' : 'ends'} on ${p.probationEnd}`,
        body: 'Confirm, extend or end it, so letters and benefits follow.',
        evidence: { probationEnd: p.probationEnd },
        dedupeKey: `probation:${p.id}`,
        entityType: 'employee',
        entityId: p.id,
        link: `/hr/employees/${p.id}`,
        confidence: 0.95,
        permission: 'hr.employees.manage',
        expiresInDays: 14,
      });
    }
    return out;
  },
};

/** Compliance agent: statutory due dates, licences to renew, and e-invoices that failed. */
export const complianceAgent: AgentDefinition = {
  code: 'compliance',
  name: 'Compliance agent',
  description: 'Reminds about GST, TDS, PF and ESI due dates, licences coming up for renewal, and e-invoices that did not generate.',
  watches: ['GSTR-1, GSTR-3B, TDS, PF / ESI due dates', 'Licences within their renewal lead time', 'Sales invoices whose e-invoice (IRN) failed'],
  defaultSchedule: 'daily',
  params: { aheadDays: { default: 5, label: 'Remind before a due date (days)' } },
  async run({ tx, today, params }) {
    const out: Finding[] = [];
    for (const d of statutoryDue(today, params.aheadDays)) {
      const days = Math.round((Date.parse(d.dueDate) - Date.parse(today)) / 86_400_000);
      out.push({
        kind: 'statutory_due',
        severity: days < 0 ? 'critical' : days <= 2 ? 'warning' : 'info',
        title: `${d.title} for ${d.period} ${days < 0 ? `was due ${-days} day(s) ago` : days === 0 ? 'is due today' : `is due on ${d.dueDate}`}`,
        body: days < 0 ? 'File or pay now: late fees and interest run from the due date.' : 'Check the figures are ready; extensions announced by the government are not reflected here.',
        evidence: { dueDate: d.dueDate, period: d.period, daysLeft: days },
        dedupeKey: `due:${d.code}:${d.dueDate}`,
        confidence: 0.9,
        permission: d.permission,
        expiresInDays: Math.max(1, days + 4),
      });
    }
    const licences = await many<{ id: string; name: string; number: string | null; validUntil: string; owner: string | null }>(
      tx,
      sql`select id, name, number, valid_until::text as "validUntil", owner from licences
          where valid_until is not null and valid_until - coalesce(renewal_lead_days, 30) <= ${today}::date`,
    );
    for (const l of licences) {
      const days = Math.round((Date.parse(l.validUntil) - Date.parse(today)) / 86_400_000);
      out.push({
        kind: 'licence_renewal',
        severity: days < 0 ? 'critical' : days <= 15 ? 'warning' : 'info',
        title: days < 0 ? `${l.name} expired ${-days} days ago` : `Renew ${l.name} (expires ${l.validUntil})`,
        body: `${l.number ? `Licence ${l.number}. ` : ''}${l.owner ? `Owner: ${l.owner}.` : ''}`.trim() || 'Start the renewal.',
        evidence: { validUntil: l.validUntil, daysLeft: days },
        dedupeKey: `licence:${l.id}:${l.validUntil}`,
        entityType: 'licence',
        entityId: l.id,
        link: '/hse',
        confidence: 0.98,
        permission: 'hse.register.read',
        expiresInDays: 7,
      });
    }
    const failed = await many<{ id: string; number: string; customer: string; error: string | null }>(
      tx,
      sql`select si.id, d.number, p.name as customer, si.irn_error as error from sales_invoices si join documents d on d.id = si.id join parties p on p.id = si.customer_id
          where d.status in ('approved', 'completed') and si.irn_status = 'failed' and si.irn is null`,
    );
    for (const f of failed) {
      out.push({
        kind: 'einvoice_failed',
        severity: 'critical',
        title: `E-invoice for ${f.number} (${f.customer}) failed`,
        body: `${f.error ?? 'The IRP rejected it.'} An invoice without an IRN is not valid for a B2B supply above the threshold; fix and generate it again.`,
        evidence: { error: f.error },
        dedupeKey: `irn:${f.id}`,
        entityType: 'sales_invoice',
        entityId: f.id,
        link: `/sales/invoices/${f.id}`,
        confidence: 1,
        permission: 'gst.einvoice.manage',
        expiresInDays: 7,
      });
    }
    return out;
  },
};
