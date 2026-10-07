import { Injectable } from '@nestjs/common';
import { DOC_TYPES, isDocType, type DocType, type Transaction } from '@nextgen/database';
import { sql, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import { DatabaseService } from '../../database/database.service';
import { WorkOrdersService } from '../manufacturing/work-orders.service';
import { BuilderService } from '../reports/builder/builder.service';
import { specSchema } from '../reports/builder/builder';
import { REPORTS, ReportsService } from '../reports/reports.service';

/** What the chat panel can show besides text. */
export type Block =
  | { kind: 'table'; title: string; columns: { key: string; label: string; type: string }[]; rows: Record<string, unknown>[]; totals?: Record<string, string>; more?: number; href?: string }
  | { kind: 'facts'; title: string; items: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }[]; href?: string };

export type Action =
  | { kind: 'navigate'; label: string; href: string }
  | { kind: 'draft'; label: string; docType: string; endpoint: string; body: Record<string, unknown>; summary: string[]; openPath: string };

export interface ToolResult {
  /** What the model reads (kept short). */
  content: string;
  blocks?: Block[];
  actions?: Action[];
  isError?: boolean;
}

/** Tool definitions for the model (Anthropic tool-use schema). */
export const TOOL_DEFS = [
  {
    name: 'run_report',
    description: 'Run one of the standard reports and get its rows and totals. Use list_reports first if unsure of the key. Dates are YYYY-MM-DD.',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, params: { type: 'object', additionalProperties: { type: 'string' }, description: 'e.g. {"from":"2026-10-01","to":"2026-10-07","partyId":"…"}' } }, required: ['key'] },
  },
  {
    name: 'list_reports',
    description: 'List the standard reports the user can run, with their keys and parameters.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'query_data',
    description:
      'Ask a flexible question of a dataset: pick fields, filters, a period and grouping. Datasets: sales_lines, purchase_lines, stock_on_hand, stock_movements, job_cards, production_receipts, inspections, receivables. Call describe_datasets for the fields.',
    input_schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        fields: { type: 'array', items: { type: 'string' } },
        filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string', enum: ['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'not_empty'] }, value: { type: 'string' } }, required: ['field', 'op'] } },
        period: { type: 'object', properties: { preset: { type: 'string', enum: ['all', 'today', 'last_7', 'last_30', 'last_90', 'mtd', 'last_month', 'qtd', 'fytd', 'last_fy', 'custom'] }, from: { type: 'string' }, to: { type: 'string' } } },
        group: { type: 'boolean' },
        sort: { type: 'object', properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'number' },
      },
      required: ['dataset', 'fields'],
    },
  },
  {
    name: 'describe_datasets',
    description: 'List the datasets the user can query and their fields (dimensions and measures).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_document',
    description: 'Find documents by number (e.g. "PO/26-27/0045", "45") or words in the title. Returns links.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, docType: { type: 'string', description: 'Optional, e.g. purchase_order, sales_invoice, work_order' } }, required: ['query'] },
  },
  {
    name: 'explain_document',
    description: 'Explain the state of one document: why it is waiting, blocked or rejected, who must act, credit, stock and compliance issues.',
    input_schema: { type: 'object', properties: { documentId: { type: 'string' }, number: { type: 'string' } } },
  },
  {
    name: 'navigate',
    description: 'Offer the user a button to open a screen of the app, e.g. /sales/orders/new or /reports/stock-summary.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, label: { type: 'string' } }, required: ['path', 'label'] },
  },
  {
    name: 'draft_document',
    description:
      'Prepare a draft sales order, purchase order, purchase requisition or work order from names the user gave. Nothing is created: the user sees a confirmation card and creates it themselves.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['sales_order', 'purchase_order', 'purchase_requisition', 'work_order'] },
        party: { type: 'string', description: 'Customer or vendor name or code (not for requisitions / work orders)' },
        lines: { type: 'array', items: { type: 'object', properties: { item: { type: 'string', description: 'Item code or name' }, qty: { type: 'string' }, rate: { type: 'string' } }, required: ['item', 'qty'] } },
        date: { type: 'string', description: 'Required-by / planned end date, YYYY-MM-DD' },
      },
      required: ['type', 'lines'],
    },
  },
  {
    name: 'hr_info',
    description:
      "People answers: the user's own leave balance, attendance this month and latest payslip; for HR, headcount and who is absent or on leave today; for managers, what is waiting for their approval.",
    input_schema: { type: 'object', properties: { topic: { type: 'string', enum: ['my_leave', 'my_attendance', 'my_payslip', 'headcount', 'absent_today', 'pending_approvals'] }, lang: { type: 'string', enum: ['en', 'hi'] } }, required: ['topic'] },
  },
] as const;

/** App areas the copilot may link to. */
const ROUTE = /^\/(dashboard|dashboards|approvals|sales|purchase|inventory|manufacturing|quality|accounting|gst|reports|masters|assets|job-work|settings|hr|payroll)(\/[a-z0-9\-/]*)?(\?[a-zA-Z0-9=&\-_.%]*)?$/;

const DRAFTS = {
  sales_order: { endpoint: '/sales/orders', path: '/sales/orders', permission: 'sales.orders.manage', party: 'customer' },
  purchase_order: { endpoint: '/purchase/orders', path: '/purchase/orders', permission: 'purchase.orders.manage', party: 'vendor' },
  purchase_requisition: { endpoint: '/purchase/requisitions', path: '/purchase/requisitions', permission: 'purchase.requisitions.manage', party: null },
  work_order: { endpoint: '/manufacturing/work-orders', path: '/manufacturing/work-orders', permission: 'manufacturing.production.manage', party: null },
} as const;

const short = (v: unknown) => JSON.stringify(v).slice(0, 6000);
const money = (v: unknown) => `₹${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * The copilot's hands. Every tool runs as the signed-in user, inside their row security and
 * permissions; nothing here writes business data (drafts are proposals the user creates).
 */
@Injectable()
export class CopilotTools {
  constructor(
    private readonly database: DatabaseService,
    private readonly reports: ReportsService,
    private readonly builder: BuilderService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  private async perms(auth: AuthContext) {
    return auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
  }

  async run(auth: AuthContext, name: string, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case 'run_report':
          return await this.runReport(auth, String(input.key ?? ''), (input.params as Record<string, string>) ?? {});
        case 'list_reports':
          return await this.listReports(auth);
        case 'query_data':
          return await this.queryData(auth, input);
        case 'describe_datasets':
          return { content: short(await this.builder.datasets(auth)) };
        case 'find_document':
          return await this.findDocument(auth, String(input.query ?? ''), input.docType ? String(input.docType) : undefined);
        case 'explain_document':
          return await this.explain(auth, input.documentId ? String(input.documentId) : undefined, input.number ? String(input.number) : undefined);
        case 'navigate':
          return this.navigate(String(input.path ?? ''), String(input.label ?? 'Open'));
        case 'draft_document':
          return await this.draft(auth, input);
        case 'hr_info':
          return await this.hrInfo(auth, String(input.topic ?? ''), input.lang === 'hi' ? 'hi' : 'en');
        default:
          return { content: `Unknown tool ${name}`, isError: true };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      return { content: `Error: ${msg}`, isError: true };
    }
  }

  /** HR answers, each limited to what the user may see: their own record, or HR / manager views. */
  async hrInfo(auth: AuthContext, topic: string, lang: 'en' | 'hi'): Promise<ToolResult> {
    const hi = lang === 'hi';
    const perms = await this.perms(auth);
    return this.database.run(auth, async (tx) => {
      const rows = async <T extends Record<string, unknown>>(q: SQL) => (await tx.execute<T>(q)).rows;
      const [me] = await rows<{ id: string; fullName: string; gender: string | null }>(sql`select id, full_name as "fullName", gender from employees where user_id = ${auth.userId} and status <> 'exited' limit 1`);
      const needSelf = (): ToolResult => ({ content: hi ? 'आपका लॉगिन किसी कर्मचारी रिकॉर्ड से जुड़ा नहीं है।' : 'Your login is not linked to an employee record, so I cannot look up your own details.', isError: true });
      const today = todayIST();
      switch (topic) {
        case 'my_leave': {
          if (!me) return needSelf();
          const bal = await rows<{ name: string; balance: number }>(
            sql`select t.name, coalesce(sum(l.days), 0)::float8 as balance from leave_types t left join leave_ledger l on l.leave_type_id = t.id and l.employee_id = ${me.id}
                where t.is_active and (t.gender is null or t.gender = ${me.gender}) group by t.name order by t.name`,
          );
          const line = bal.map((b) => `${b.name} ${b.balance}`).join(', ');
          return {
            content: bal.length ? (hi ? `आपकी छुट्टियाँ: ${line}।` : `Your leave balance: ${line}.`) : hi ? 'अभी कोई छुट्टी का प्रकार नहीं है।' : 'No leave types are set up yet.',
            blocks: [{ kind: 'facts', title: hi ? 'छुट्टी शेष' : 'Leave balance', items: bal.map((b) => ({ label: b.name, value: String(b.balance) })), href: '/hr/leave' }],
            actions: [{ kind: 'navigate', label: hi ? 'छुट्टी के लिए आवेदन' : 'Apply for leave', href: '/hr/leave' }],
          };
        }
        case 'my_attendance': {
          if (!me) return needSelf();
          const [a] = await rows<{ present: number; absent: number; late: number; leave: number }>(
            sql`select coalesce(sum(case status when 'present' then 1 when 'half_day' then 0.5 else 0 end), 0)::float8 as present,
                       count(*) filter (where status in ('absent', 'missed_punch'))::int as absent, count(*) filter (where late_minutes > 0)::int as late,
                       coalesce(sum(leave_days), 0)::float8 as leave
                from attendance_days where employee_id = ${me.id} and date >= date_trunc('month', ${today}::date) and date <= ${today}`,
          );
          return {
            content: hi ? `इस महीने: ${a.present} दिन उपस्थित, ${a.absent} अनुपस्थित, ${a.leave} छुट्टी, ${a.late} बार देर से।` : `This month: ${a.present} days present, ${a.absent} absent, ${a.leave} on leave, late ${a.late} time(s).`,
            actions: [{ kind: 'navigate', label: hi ? 'हाज़िरी लगाएँ' : 'Punch', href: '/hr/punch' }],
          };
        }
        case 'my_payslip': {
          if (!me) return needSelf();
          const [p] = await rows<{ id: string; month: string; gross: string; net: string }>(sql`select p.id, p.month, p.gross, p.net from payslips p join payroll_runs r on r.id = p.run_id where p.employee_id = ${me.id} and r.status <> 'draft' order by p.month desc limit 1`);
          if (!p) return { content: hi ? 'अभी कोई वेतन पर्ची नहीं है।' : 'No payslip yet.' };
          return { content: hi ? `${p.month} का वेतन: कुल ${money(p.gross)}, हाथ में ${money(p.net)}।` : `Pay for ${p.month}: gross ${money(p.gross)}, net ${money(p.net)}.`, actions: [{ kind: 'navigate', label: hi ? 'वेतन पर्ची' : 'Open payslips', href: '/payroll/my' }] };
        }
        case 'headcount': {
          if (!perms.has('hr.employees.read')) return { content: hi ? 'आपके पास कर्मचारियों को देखने की अनुमति नहीं है।' : 'You do not have access to employee records.', isError: true };
          const by = await rows<{ key: string; n: number }>(sql`select coalesce(d.name, '—') as key, count(*)::int as n from employees e left join hr_departments d on d.id = e.department_id where e.status <> 'exited' group by 1 order by 2 desc`);
          const total = by.reduce((s, r) => s + r.n, 0);
          return {
            content: hi ? `कुल ${total} कर्मचारी।` : `${total} people on the rolls.`,
            blocks: [{ kind: 'facts', title: hi ? 'विभाग अनुसार' : 'By department', items: by.map((r) => ({ label: r.key, value: String(r.n) })), href: '/hr' }],
          };
        }
        case 'absent_today': {
          if (!perms.has('hr.attendance.read')) return { content: hi ? 'आपके पास हाज़िरी देखने की अनुमति नहीं है।' : 'You do not have access to attendance.', isError: true };
          const list = await rows<{ fullName: string; status: string }>(
            sql`select e.full_name as "fullName",
                       case when exists (select 1 from leave_applications l where l.employee_id = e.id and l.status = 'approved' and ${today} between l.from_date and l.to_date) then 'on leave' else 'not punched in' end as status
                from employees e
                where e.status <> 'exited' and e.date_of_joining <= ${today}
                  and not exists (select 1 from attendance_punches p where p.employee_id = e.id and p.punched_at >= (${today}::date)::timestamp at time zone 'Asia/Kolkata')
                order by 2, 1 limit 200`,
          );
          return {
            content: list.length ? (hi ? `आज ${list.length} लोग नहीं आए या छुट्टी पर हैं।` : `${list.length} people have not punched in today or are on leave.`) : hi ? 'आज सब हाज़िर हैं।' : 'Everyone has punched in today.',
            blocks: list.length ? [{ kind: 'table', title: hi ? 'आज अनुपस्थित' : 'Not in today', columns: [{ key: 'fullName', label: 'Employee', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }], rows: list, href: '/hr/attendance' }] : [],
          };
        }
        case 'pending_approvals': {
          if (!me) return needSelf();
          const [n] = await rows<{ leave: number; regularisations: number; claims: number }>(
            sql`select (select count(*)::int from leave_applications a join employees e on e.id = a.employee_id where e.reports_to_id = ${me.id} and a.status = 'pending') as leave,
                       (select count(*)::int from attendance_regularisations r join employees e on e.id = r.employee_id where e.reports_to_id = ${me.id} and r.status = 'pending') as regularisations,
                       (select count(*)::int from hr_claims c join employees e on e.id = c.employee_id where e.reports_to_id = ${me.id} and c.status = 'pending') as claims`,
          );
          const total = n.leave + n.regularisations + n.claims;
          return {
            content: total
              ? hi
                ? `आपकी टीम के ${total} अनुरोध बाकी हैं: ${n.leave} छुट्टी, ${n.regularisations} हाज़िरी सुधार, ${n.claims} खर्च।`
                : `${total} requests from your team are waiting: ${n.leave} leave, ${n.regularisations} attendance corrections, ${n.claims} expense claims.`
              : hi
                ? 'आपके पास कोई अनुरोध बाकी नहीं है।'
                : 'Nothing from your team is waiting for you.',
            actions: total ? [{ kind: 'navigate', label: hi ? 'अनुरोध देखें' : 'Review requests', href: '/hr/me' }] : [],
          };
        }
        default:
          return { content: `Unknown HR topic ${topic}`, isError: true };
      }
    });
  }

  async listReports(auth: AuthContext): Promise<ToolResult> {
    const perms = await this.perms(auth);
    const list = REPORTS.filter((r) => r.kind === 'query' && perms.has(r.permission)).map((r) => (r.kind === 'query' ? { key: r.key, title: r.title, params: r.params.map((p) => p.key) } : null));
    return { content: short(list) };
  }

  async runReport(auth: AuthContext, key: string, params: Record<string, string>): Promise<ToolResult> {
    const r = await this.reports.run(auth, key, params);
    const rows = r.rows.slice(0, 15);
    const qs = new URLSearchParams(Object.entries(r.params).filter(([, v]) => !!v) as [string, string][]).toString();
    return {
      content: short({ title: r.title, params: r.params, rowCount: r.rows.length, totals: r.totals, rows: r.rows.slice(0, 25) }),
      blocks: [{ kind: 'table', title: r.title, columns: r.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })), rows, totals: r.totals, more: Math.max(0, r.rows.length - rows.length), href: `/reports/${key}${qs ? `?${qs}` : ''}` }],
    };
  }

  async queryData(auth: AuthContext, input: Record<string, unknown>): Promise<ToolResult> {
    const spec = specSchema.parse({ ...input, limit: Math.min(Number(input.limit ?? 200), 1000) });
    const r = await this.builder.runSpec(auth, spec, 'Your question');
    const rows = r.rows.slice(0, 15);
    return {
      content: short({ dataset: spec.dataset, period: r.params, rowCount: r.rows.length, totals: r.totals, rows: r.rows.slice(0, 25) }),
      blocks: [{ kind: 'table', title: r.dataset, columns: r.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })), rows, totals: r.totals, more: Math.max(0, r.rows.length - rows.length) }],
    };
  }

  async findDocument(auth: AuthContext, query: string, docType?: string): Promise<ToolResult> {
    const perms = await this.perms(auth);
    const readable = (Object.keys(DOC_TYPES) as DocType[]).filter((t) => perms.has(DOC_TYPES[t].readPermission) && (!docType || t === docType));
    if (!readable.length) return { content: 'No documents of that kind are visible to you.', isError: true };
    const q = query.trim();
    const digits = /^\d+$/.test(q) ? q : null;
    const rows = await this.database.run(auth, (tx: Transaction) =>
      tx.execute<{ id: string; doc_type: string; number: string | null; title: string | null; status: string; doc_date: string; amount: string | null }>(sql`
        select id, doc_type, number, title, status, doc_date::text as doc_date, amount from documents
        where doc_type in ${readable} and (
          number ilike ${`%${q}%`} or title ilike ${`%${q}%`}
          ${digits ? sql`or number ~ ${`(^|/)0*${digits}$`}` : sql``}
        )
        order by (number ilike ${q}) desc, created_at desc limit 8`),
    );
    const found = rows.rows.map((r) => ({ id: r.id, type: r.doc_type, label: isDocType(r.doc_type) ? DOC_TYPES[r.doc_type].label : r.doc_type, number: r.number ?? 'Draft', title: r.title, status: r.status, date: r.doc_date, amount: r.amount, href: isDocType(r.doc_type) ? `${DOC_TYPES[r.doc_type].path}/${r.id}` : null }));
    if (!found.length) return { content: `Nothing found for "${q}".` };
    return {
      content: short(found),
      actions: found.slice(0, 3).filter((f) => f.href).map((f) => ({ kind: 'navigate' as const, label: `Open ${f.label} ${f.number}`, href: f.href! })),
    };
  }

  navigate(path: string, label: string): ToolResult {
    if (!ROUTE.test(path)) return { content: `${path} is not a screen the copilot can open.`, isError: true };
    return { content: `Offered a button to open ${path}.`, actions: [{ kind: 'navigate', label: label.slice(0, 60), href: path }] };
  }

  // ---- explanations ------------------------------------------------------------------------

  async explain(auth: AuthContext, documentId?: string, number?: string): Promise<ToolResult> {
    const perms = await this.perms(auth);
    return this.database.run(auth, async (tx) => {
      const [doc] = (
        await tx.execute<{ id: string; doc_type: string; number: string | null; status: string; doc_date: string; title: string | null; amount: string | null; cancel_reason: string | null; company_id: string; current_step: number | null }>(
          documentId
            ? sql`select id, doc_type, number, status, doc_date::text as doc_date, title, amount, cancel_reason, company_id, current_step from documents where id = ${documentId}::uuid`
            : sql`select id, doc_type, number, status, doc_date::text as doc_date, title, amount, cancel_reason, company_id, current_step from documents where upper(number) = upper(${number ?? ''}) order by created_at desc limit 1`,
        )
      ).rows;
      if (!doc || !isDocType(doc.doc_type) || !perms.has(DOC_TYPES[doc.doc_type].readPermission)) return { content: 'Document not found, or you cannot see it.', isError: true };
      const def = DOC_TYPES[doc.doc_type];
      const items: { label: string; value: string; tone?: 'good' | 'bad' | 'neutral' }[] = [{ label: 'Status', value: doc.status.replace('_', ' '), tone: doc.status === 'approved' || doc.status === 'completed' ? 'good' : doc.status === 'rejected' || doc.status === 'cancelled' ? 'bad' : 'neutral' }];

      if (doc.status === 'pending_approval') {
        const steps = (
          await tx.execute<{ step_no: number; name: string; role: string | null; who: string | null }>(sql`
            select a.step_no, a.name, r.name as role, u.full_name as who from document_approvals a
            left join roles r on r.id = a.approver_role_id left join users u on u.id = a.approver_user_id
            where a.document_id = ${doc.id}::uuid and a.status = 'pending' order by a.step_no`)
        ).rows;
        for (const s of steps) items.push({ label: `Waiting at step ${s.step_no}`, value: `${s.name}: ${s.who ?? (s.role ? `anyone with the ${s.role} role` : 'an approver')}`, tone: 'bad' });
      }
      if (doc.status === 'rejected') {
        const [act] = (await tx.execute<{ message: string; comment: string | null }>(sql`select message, data->>'comment' as comment from document_activity where document_id = ${doc.id}::uuid and kind = 'rejected' order by created_at desc limit 1`)).rows;
        if (act) items.push({ label: 'Rejected', value: act.comment ? `${act.message}: “${act.comment}”` : act.message, tone: 'bad' });
      }
      if (doc.status === 'cancelled' && doc.cancel_reason) items.push({ label: 'Cancelled because', value: doc.cancel_reason, tone: 'bad' });
      const [lock] = (await tx.execute<{ locked_until: string | null }>(sql`select locked_until::text from accounting_settings where company_id = ${doc.company_id}::uuid`)).rows;
      if (lock?.locked_until && doc.doc_date <= lock.locked_until && doc.status !== 'approved' && doc.status !== 'completed') items.push({ label: 'Period locked', value: `The books are locked up to ${lock.locked_until}; posting on ${doc.doc_date} will be refused`, tone: 'bad' });

      switch (doc.doc_type) {
        case 'sales_order': {
          const [so] = (await tx.execute<{ credit: Record<string, unknown> | null; override: string | null; closed: string | null }>(sql`select credit_check as credit, credit_override_reason as override, closed_at::text as closed from sales_orders where id = ${doc.id}::uuid`)).rows;
          if (so?.credit) items.push({ label: 'Credit check', value: so.credit.exceeded ? `Over the limit: exposure ${money(so.credit.exposure)} against ${money(so.credit.limit)}${so.override ? ` (overridden: ${so.override})` : ''}` : `Within limit (${money(so.credit.exposure)} of ${money(so.credit.limit)})`, tone: so.credit.exceeded && !so.override ? 'bad' : 'good' });
          const [p] = (await tx.execute<{ ordered: string; delivered: string; invoiced: string }>(sql`select sum(qty) as ordered, sum(delivered_qty) as delivered, sum(invoiced_qty) as invoiced from sales_order_lines where order_id = ${doc.id}::uuid`)).rows;
          if (p) items.push({ label: 'Progress', value: `${Number(p.delivered)} of ${Number(p.ordered)} delivered, ${Number(p.invoiced)} invoiced` });
          if (so?.closed) items.push({ label: 'Short-closed', value: so.closed.slice(0, 10) });
          break;
        }
        case 'sales_invoice': {
          const [si] = (await tx.execute<{ irn_status: string | null; irn_error: string | null; out: string; due: string | null; eway: string | null }>(sql`select irn_status, irn_error, grand_total - received_amount - credited_amount as out, due_date::text as due, eway_bill_no as eway from sales_invoices where id = ${doc.id}::uuid`)).rows;
          if (si?.irn_status) items.push({ label: 'E-invoice', value: si.irn_error ? `${si.irn_status}: ${si.irn_error}` : si.irn_status, tone: si.irn_error ? 'bad' : 'good' });
          if (si && Number(si.out) > 0.005) items.push({ label: 'Outstanding', value: `${money(si.out)}${si.due ? `, due ${si.due}${si.due < todayIST() ? ' (overdue)' : ''}` : ''}`, tone: si.due && si.due < todayIST() ? 'bad' : 'neutral' });
          else if (si) items.push({ label: 'Outstanding', value: 'Fully received', tone: 'good' });
          break;
        }
        case 'purchase_invoice': {
          const [pi] = (await tx.execute<{ match: string; variance: string; note: string | null; out: string; due: string | null; msme: string | null }>(sql`select match_type as match, rate_variance as variance, variance_note as note, net_payable - paid_amount - debited_amount as out, due_date::text as due, vendor_msme as msme from purchase_invoices where id = ${doc.id}::uuid`)).rows;
          if (pi) {
            items.push({ label: 'Matching', value: `${pi.match}${Number(pi.variance) ? `, rate variance ${money(pi.variance)}${pi.note ? ` (${pi.note})` : ''}` : ''}`, tone: Number(pi.variance) ? 'bad' : 'good' });
            items.push({ label: 'To pay', value: Number(pi.out) > 0.005 ? `${money(pi.out)}${pi.due ? ` by ${pi.due}` : ''}${pi.msme && pi.msme !== 'medium' ? ' (MSME: 45-day rule applies)' : ''}` : 'Paid', tone: Number(pi.out) > 0.005 && pi.due && pi.due < todayIST() ? 'bad' : 'neutral' });
          }
          break;
        }
        case 'purchase_order': {
          const [p] = (await tx.execute<{ ordered: string; received: string; billed: string }>(sql`select sum(qty) as ordered, sum(received_qty) as received, sum(billed_qty) as billed from purchase_order_lines where po_id = ${doc.id}::uuid`)).rows;
          if (p) items.push({ label: 'Progress', value: `${Number(p.received)} of ${Number(p.ordered)} received, ${Number(p.billed)} billed` });
          break;
        }
        case 'work_order': {
          const [wo] = (await tx.execute<{ stage: string; qty: string; produced: string; planned_end: string | null }>(sql`select stage, qty, produced_qty as produced, planned_end::text from work_orders where id = ${doc.id}::uuid`)).rows;
          if (wo) items.push({ label: 'Stage', value: `${wo.stage.replace('_', ' ')}: ${Number(wo.produced)} of ${Number(wo.qty)} made${wo.planned_end && wo.planned_end < todayIST() && !['completed', 'closed'].includes(wo.stage) ? `, late since ${wo.planned_end}` : ''}`, tone: wo.planned_end && wo.planned_end < todayIST() && !['completed', 'closed'].includes(wo.stage) ? 'bad' : 'neutral' });
          if (wo && ['planned', 'released', 'in_progress'].includes(wo.stage)) {
            const av = await this.workOrders.availabilityTx(tx, doc.id);
            const short = av.lines.filter((l) => Number(l.short) > 0);
            items.push({ label: 'Materials', value: short.length ? `Short of ${short.map((s) => `${s.code} ${Number(s.short)} ${s.uom}`).join(', ')}` : 'Everything still to issue is in stock', tone: short.length ? 'bad' : 'good' });
          }
          const [qi] = (await tx.execute<{ n: string }>(sql`select count(*) as n from quality_inspections q join documents d on d.id = q.id where q.work_order_id = ${doc.id}::uuid and d.status = 'draft'`)).rows;
          if (Number(qi?.n)) items.push({ label: 'Inspections', value: `${qi.n} lot(s) waiting for a quality decision`, tone: 'bad' });
          break;
        }
        case 'quality_inspection': {
          const [q] = (await tx.execute<{ result: string; suggestion: string | null; defectives: number; accept_no: number; reject_no: number }>(sql`select result, suggestion, defectives, accept_no, reject_no from quality_inspections where id = ${doc.id}::uuid`)).rows;
          if (q) items.push({ label: 'Inspection', value: `${q.defectives} defective sample(s) against accept ${q.accept_no} / reject ${q.reject_no}${q.suggestion ? `: readings say ${q.suggestion}` : ''}; result ${q.result}` });
          break;
        }
      }
      const href = `${def.path}/${doc.id}`;
      return {
        content: short({ document: `${def.label} ${doc.number ?? 'draft'}`, date: doc.doc_date, amount: doc.amount, facts: items }),
        blocks: [{ kind: 'facts', title: `${def.label} ${doc.number ?? '(draft)'}`, items, href }],
        actions: [{ kind: 'navigate', label: `Open ${doc.number ?? 'the draft'}`, href }],
      };
    });
  }

  // ---- drafts --------------------------------------------------------------------------------

  async draft(auth: AuthContext, input: Record<string, unknown>): Promise<ToolResult> {
    const type = String(input.type) as keyof typeof DRAFTS;
    const d = DRAFTS[type];
    if (!d) return { content: 'I can draft sales orders, purchase orders, purchase requisitions and work orders.', isError: true };
    if (!(await this.perms(auth)).has(d.permission)) return { content: 'You do not have permission to create that document.', isError: true };
    const lines = (Array.isArray(input.lines) ? input.lines : []) as { item: string; qty: string; rate?: string }[];
    if (!lines.length) return { content: 'Say which items and how many.', isError: true };
    return this.database.run(auth, async (tx) => {
      const problems: string[] = [];
      let party: { id: string; name: string } | null = null;
      if (d.party) {
        const name = String(input.party ?? '').trim();
        const flag = d.party === 'customer' ? sql.raw('is_customer') : sql.raw('is_vendor');
        const found = name ? (await tx.execute<{ id: string; name: string }>(sql`select id, name from parties where ${flag} and is_active and deleted_at is null and (code ilike ${name} or name ilike ${`%${name}%`}) order by (code ilike ${name}) desc, length(name) limit 3`)).rows : [];
        if (found.length === 1 || (found[0] && found[0].name.toLowerCase() === name.toLowerCase())) party = found[0];
        else problems.push(found.length ? `Which ${d.party}: ${found.map((f) => f.name).join(', ')}?` : `No ${d.party} matches "${name || '(none given)'}".`);
      }
      const resolved: { id: string; code: string; name: string; uom: string; lastRate: string | null; rateSource: string; qty: string; rate?: string }[] = [];
      for (const l of lines) {
        const term = String(l.item ?? '').trim();
        const found = (await tx.execute<{ id: string; code: string; name: string; uom: string; lastRate: string | null; rateSource: string }>(sql`select i.id, i.code, i.name, u.code as uom, coalesce(i.last_purchase_rate, i.standard_cost)::text as "lastRate", case when i.last_purchase_rate is not null then 'last price' else 'standard cost' end as "rateSource" from items i join uoms u on u.id = i.base_uom_id where i.is_active and i.deleted_at is null and (i.code ilike ${term} or i.name ilike ${`%${term}%`}) order by (i.code ilike ${term}) desc, length(i.name) limit 3`)).rows;
        const qty = String(l.qty ?? '').replace(/[,\s]/g, '');
        if (!/^\d+(\.\d+)?$/.test(qty) || Number(qty) <= 0) problems.push(`Quantity for "${term}" is not a number.`);
        if (found.length === 1 || (found[0] && (found[0].code.toLowerCase() === term.toLowerCase() || found[0].name.toLowerCase() === term.toLowerCase()))) resolved.push({ ...found[0], qty, rate: l.rate ? String(l.rate).replace(/[₹,\s]/g, '') : undefined });
        else problems.push(found.length ? `Which item for "${term}": ${found.map((f) => `${f.code} ${f.name}`).join(', ')}?` : `No item matches "${term}".`);
      }
      if (problems.length) return { content: `Cannot draft yet. ${problems.join(' ')}`, isError: true };
      const date = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : undefined;
      let body: Record<string, unknown>;
      if (type === 'sales_order') body = { customerId: party!.id, expectedDate: date ?? null, lines: resolved.map((r) => ({ itemId: r.id, qty: r.qty, ...(r.rate ? { rate: r.rate } : {}) })) };
      else if (type === 'purchase_order') body = { vendorId: party!.id, expectedDate: date ?? null, lines: resolved.map((r) => ({ itemId: r.id, qty: r.qty, rate: r.rate ?? (r.lastRate ? String(Number(r.lastRate)) : '0') })) };
      else if (type === 'purchase_requisition') body = { requiredBy: date ?? null, lines: resolved.map((r) => ({ itemId: r.id, itemCode: r.code, description: r.name, uom: r.uom, quantity: r.qty, estimatedRate: r.rate ?? (r.lastRate ? String(Number(r.lastRate)) : null) })) };
      else {
        if (resolved.length !== 1) return { content: 'A work order makes one item; name just one.', isError: true };
        const [store] = (await tx.execute<{ id: string }>(sql`select id from warehouses where is_active and type = 'store' order by code limit 1`)).rows;
        if (!store) return { content: 'Set up a store first.', isError: true };
        body = { itemId: resolved[0].id, qty: resolved[0].qty, sourceWarehouseId: store.id, targetWarehouseId: store.id, plannedEnd: date ?? null };
      }
      const label = { sales_order: 'sales order', purchase_order: 'purchase order', purchase_requisition: 'purchase requisition', work_order: 'work order' }[type];
      const summary = [...(party ? [`${d.party === 'customer' ? 'Customer' : 'Vendor'}: ${party.name}`] : []), ...resolved.map((r) => `${r.code} ${r.name} × ${r.qty} ${r.uom}${r.rate ? ` @ ₹${r.rate}` : type === 'purchase_order' && r.lastRate ? ` @ ₹${Number(r.lastRate)} (${r.rateSource})` : ''}`), ...(date ? [`Date: ${date}`] : [])];
      return {
        content: `Prepared a draft ${label} for the user to confirm: ${summary.join('; ')}. It is not created until they press Create draft.`,
        actions: [{ kind: 'draft', label: `Create draft ${label}`, docType: type, endpoint: d.endpoint, body, summary, openPath: d.path }],
      };
    });
  }
}
