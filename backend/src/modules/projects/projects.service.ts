import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { projectCostLinks, projectMilestones, projectResources, projects, projectTime, projectWbs, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { SalesInvoicesService } from '../sales/invoices.service';
import { COST_TYPES, earnedValue, milestoneAmounts, r2, resourceLoad, rollUp, wbsCodeProblem, type CostType, type WbsFigures } from './project-rules';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const LINKABLE = ['purchase_order', 'purchase_invoice', 'stock_entry', 'journal_entry'];

export const projectSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(160),
  customerId: z.uuid().nullable().optional(),
  contractValue: z.number().min(0).default(0),
  billingItemId: z.uuid().nullable().optional(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  companyId: z.uuid().nullable().optional(),
});
export const statusSchema = z.object({ status: z.enum(['planning', 'active', 'closed']) });
export const wbsSchema = z.object({
  parentId: z.uuid().nullable().optional(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(160),
  plannedStart: z.iso.date(),
  plannedEnd: z.iso.date(),
  budgetMaterial: z.number().min(0).default(0),
  budgetLabour: z.number().min(0).default(0),
  budgetSubcontract: z.number().min(0).default(0),
  budgetOther: z.number().min(0).default(0),
});
export const progressSchema = z.object({ progressPct: z.number().min(0).max(100) });
export const milestoneSchema = z.object({ name: z.string().trim().min(2).max(160), wbsId: z.uuid().nullable().optional(), dueDate: z.iso.date(), pct: z.number().gt(0).max(100) });
export const linkSchema = z.object({ wbsId: z.uuid(), documentId: z.uuid(), costType: z.enum(COST_TYPES) });
export const resourceSchema = z.object({ wbsId: z.uuid().nullable().optional(), employeeId: z.uuid(), fromDate: z.iso.date(), toDate: z.iso.date(), hoursPerWeek: z.number().gt(0).max(80), costRate: z.number().min(0).default(0) });
export const timeSchema = z.object({ wbsId: z.uuid(), employeeId: z.uuid(), workDate: z.iso.date(), hours: z.number().gt(0).max(24), note: z.string().trim().max(300).nullable().optional() });
export const approveTimeSchema = z.object({ ids: z.array(z.uuid()).min(1).max(500), approve: z.boolean().default(true) });
export const loadQuery = z.object({ from: z.iso.date().optional(), weeks: z.coerce.number().int().min(1).max(26).default(8) });

const zero = (): Record<CostType, number> => ({ material: 0, labour: 0, subcontract: 0, other: 0 });

/**
 * Project systems: projects with a WBS, budgets by cost type, billing milestones invoiced through
 * sales invoices, purchase orders / invoices / stock issues / journals charged to WBS elements, time
 * booked and approved, resource load across projects, and earned value.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly invoices: SalesInvoicesService,
  ) {}

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; code: string; name: string; customer: string | null; contractValue: number; startDate: string; endDate: string; status: string }>(
        tx,
        sql`select p.id, p.code, p.name, c.name as customer, p.contract_value as "contractValue", p.start_date::text as "startDate", p.end_date::text as "endDate", p.status
            from projects p left join parties c on c.id = p.customer_id order by p.created_at desc`,
      );
      const out = [];
      for (const r of rows) {
        const f = await this.figures(tx, r.id);
        out.push({ ...r, ...earnedValue(f.wbs, todayIST()).total, billed: f.billed });
      }
      return out;
    });
  }

  create(auth: AuthContext, input: z.infer<typeof projectSchema>) {
    if (input.endDate < input.startDate) throw new BadRequestException('The project ends before it starts');
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(projects)
        .values({ tenantId: auth.tenantId, ...input, managerId: auth.userId })
        .onConflictDoNothing()
        .returning({ id: projects.id });
      if (!r) throw new ConflictException('A project with this code exists');
      return this.view(tx, r.id);
    });
  }

  setStatus(auth: AuthContext, id: string, status: string) {
    return this.database.run(auth, async (tx) => {
      await tx.update(projects).set({ status }).where(eq(projects.id, id));
      return this.view(tx, id);
    });
  }

  /** Actual and committed cost per WBS element and cost type, and what was billed. */
  private async figures(tx: Transaction, projectId: string) {
    const wbs = await tx.select().from(projectWbs).where(eq(projectWbs.projectId, projectId)).orderBy(projectWbs.sortOrder, projectWbs.code);
    const costs = await many<{ wbsId: string; costType: CostType; documentId: string; docType: string; number: string; status: string; actual: number; committed: number }>(
      tx,
      sql`select l.wbs_id as "wbsId", l.cost_type as "costType", l.document_id as "documentId", d.doc_type as "docType", d.number, d.status,
                 case d.doc_type
                   when 'purchase_invoice' then (select taxable_total from purchase_invoices where id = d.id)
                   when 'stock_entry' then (select coalesce(-sum(value), 0) from stock_ledger where voucher_id = d.id and qty < 0)
                   when 'journal_entry' then (select coalesce(sum(jl.debit), 0) from journal_lines jl join accounts a on a.id = jl.account_id where jl.journal_id = d.id and a.nature = 'expense')
                   else 0 end::float8 as actual,
                 case when d.doc_type = 'purchase_order' then greatest(0, (select taxable_total from purchase_orders where id = d.id)
                   - coalesce((select sum(pi.taxable_total) from purchase_invoices pi join documents pd on pd.id = pi.id where pi.po_id = d.id and pd.status not in ('draft', 'cancelled')), 0)) else 0 end::float8 as committed
          from project_cost_links l join documents d on d.id = l.document_id
          where l.project_id = ${projectId}`,
    );
    const time = await many<{ wbsId: string; hours: number; cost: number }>(
      tx,
      sql`select t.wbs_id as "wbsId", sum(t.hours)::float8 as hours,
                 sum(t.hours * coalesce((select max(r.cost_rate) from project_resources r where r.project_id = t.project_id and r.employee_id = t.employee_id), 0))::float8 as cost
          from project_time t where t.project_id = ${projectId} and t.status = 'approved' group by t.wbs_id`,
    );
    const [{ billed }] = await many<{ billed: number }>(tx, sql`select coalesce(sum(si.taxable_total), 0)::float8 as billed from project_milestones m join documents d on d.id = m.invoice_id join sales_invoices si on si.id = d.id where m.project_id = ${projectId} and d.status not in ('cancelled')`);
    const counted = costs.filter((c) => !['draft', 'cancelled'].includes(c.status));
    const figures: WbsFigures[] = wbs.map((w) => {
      const actual = zero();
      for (const c of counted.filter((x) => x.wbsId === w.id)) actual[c.costType] += c.actual;
      actual.labour += time.find((x) => x.wbsId === w.id)?.cost ?? 0;
      return {
        id: w.id,
        code: w.code,
        name: w.name,
        parentId: w.parentId,
        plannedStart: w.plannedStart,
        plannedEnd: w.plannedEnd,
        budget: { material: w.budgetMaterial, labour: w.budgetLabour, subcontract: w.budgetSubcontract, other: w.budgetOther },
        progressPct: w.progressPct,
        actual,
        committed: counted.filter((x) => x.wbsId === w.id).reduce((a, x) => a + x.committed, 0),
      };
    });
    return { wbs: figures, costs, time, billed: r2(billed) };
  }

  private async view(tx: Transaction, id: string) {
    const [p] = await tx.select().from(projects).where(eq(projects.id, id));
    if (!p) throw new NotFoundException('Project not found');
    const [customer] = p.customerId ? await many<{ name: string }>(tx, sql`select name from parties where id = ${p.customerId}`) : [];
    const f = await this.figures(tx, id);
    const ev = earnedValue(f.wbs, todayIST());
    const roll = rollUp(f.wbs);
    const ms = await tx.select().from(projectMilestones).where(eq(projectMilestones.projectId, id)).orderBy(projectMilestones.dueDate);
    const amounts = milestoneAmounts(p.contractValue, ms);
    const invoiceNos = ms.filter((m) => m.invoiceId).length ? await many<{ id: string; number: string; status: string }>(tx, sql`select id, number, status from documents where id in ${ms.filter((m) => m.invoiceId).map((m) => m.invoiceId!)}`) : [];
    const resources = await many(
      tx,
      sql`select r.id, r.wbs_id as "wbsId", r.employee_id as "employeeId", e.full_name as employee, r.from_date::text as "fromDate", r.to_date::text as "toDate", r.hours_per_week as "hoursPerWeek", r.cost_rate as "costRate"
          from project_resources r join employees e on e.id = r.employee_id where r.project_id = ${id} order by r.from_date`,
    );
    const timesheets = await many(
      tx,
      sql`select t.id, t.wbs_id as "wbsId", w.code as wbs, e.full_name as employee, t.work_date::text as "workDate", t.hours, t.note, t.status
          from project_time t join employees e on e.id = t.employee_id join project_wbs w on w.id = t.wbs_id where t.project_id = ${id} order by t.work_date desc limit 200`,
    );
    const revenueEarned = ev.total.bac > 0 ? r2((p.contractValue * ev.total.ev) / ev.total.bac) : 0;
    return {
      ...p,
      customer: customer?.name ?? null,
      wbs: f.wbs.map((w) => {
        const { id: _id, ...totals } = roll.find((r) => r.id === w.id)!;
        return { ...w, totals, evm: ev.rows.find((r) => r.id === w.id) ?? null };
      }),
      evm: ev.total,
      milestones: ms.map((m) => ({ ...m, amount: amounts.amounts[m.id], invoice: invoiceNos.find((i) => i.id === m.invoiceId) ?? null })),
      milestonePct: amounts.totalPct,
      costs: f.costs,
      resources,
      timesheets,
      billing: { billed: f.billed, revenueEarned, unbilled: r2(revenueEarned - f.billed), margin: r2(f.billed - ev.total.ac) },
    };
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.view(tx, id));
  }

  addWbs(auth: AuthContext, projectId: string, input: z.infer<typeof wbsSchema>) {
    if (input.plannedEnd < input.plannedStart) throw new BadRequestException('The element ends before it starts');
    return this.database.run(auth, async (tx) => {
      const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
      if (!p) throw new NotFoundException('Project not found');
      const [parent] = input.parentId ? await tx.select().from(projectWbs).where(and(eq(projectWbs.id, input.parentId), eq(projectWbs.projectId, projectId))) : [];
      if (input.parentId && !parent) throw new BadRequestException('Parent element not found in this project');
      const problem = wbsCodeProblem(input.code, parent?.code ?? null);
      if (problem) throw new BadRequestException(problem);
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int as n from project_wbs where project_id = ${projectId}`);
      const [r] = await tx
        .insert(projectWbs)
        .values({ tenantId: auth.tenantId, projectId, ...input, parentId: input.parentId ?? null, sortOrder: n })
        .onConflictDoNothing()
        .returning();
      if (!r) throw new ConflictException(`WBS ${input.code} exists`);
      return this.view(tx, projectId);
    });
  }

  progress(auth: AuthContext, wbsId: string, input: z.infer<typeof progressSchema>) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.update(projectWbs).set({ progressPct: input.progressPct }).where(eq(projectWbs.id, wbsId)).returning();
      if (!w) throw new NotFoundException('WBS element not found');
      return this.view(tx, w.projectId);
    });
  }

  addMilestone(auth: AuthContext, projectId: string, input: z.infer<typeof milestoneSchema>) {
    return this.database.run(auth, async (tx) => {
      const ms = await tx.select({ pct: projectMilestones.pct }).from(projectMilestones).where(eq(projectMilestones.projectId, projectId));
      if (ms.reduce((a, m) => a + m.pct, 0) + input.pct > 100.0001) throw new ConflictException('Milestones would add up to more than 100 % of the contract');
      await tx.insert(projectMilestones).values({ tenantId: auth.tenantId, projectId, ...input, wbsId: input.wbsId ?? null });
      return this.view(tx, projectId);
    });
  }

  achieve(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select().from(projectMilestones).where(eq(projectMilestones.id, id));
      if (!m) throw new NotFoundException('Milestone not found');
      if (m.status !== 'pending') throw new ConflictException(`The milestone is ${m.status}`);
      await tx.update(projectMilestones).set({ status: 'achieved', achievedOn: todayIST() }).where(eq(projectMilestones.id, id));
      return this.view(tx, m.projectId);
    });
  }

  /** Raise the draft sales invoice for an achieved milestone, on the project's billing item. */
  async bill(auth: AuthContext, id: string, meta: RequestMeta) {
    const { m, p } = await this.database.run(auth, async (tx) => {
      const [m] = await tx.select().from(projectMilestones).where(eq(projectMilestones.id, id));
      if (!m) throw new NotFoundException('Milestone not found');
      if (m.status !== 'achieved') throw new ConflictException(m.status === 'billed' ? 'Already billed' : 'Mark the milestone achieved first');
      const [p] = await tx.select().from(projects).where(eq(projects.id, m.projectId));
      if (!p.customerId || !p.billingItemId) throw new ConflictException('Set the customer and the billing item of the project first');
      return { m, p };
    });
    const amount = r2((p.contractValue * m.pct) / 100);
    const inv = await this.invoices.create(auth, { customerId: p.customerId!, companyId: p.companyId ?? undefined, withLut: false, notes: `Project ${p.code}: ${m.name}`, lines: [{ itemId: p.billingItemId!, qty: '1', rate: amount.toFixed(2), discountPct: null, description: `${p.code} ${p.name}: milestone ${m.name} (${m.pct} % of contract)` }] } as never, meta);
    return this.database.run(auth, async (tx) => {
      await tx.update(projectMilestones).set({ status: 'billed', invoiceId: (inv as { id: string }).id }).where(eq(projectMilestones.id, id));
      return this.view(tx, m.projectId);
    });
  }

  link(auth: AuthContext, projectId: string, input: z.infer<typeof linkSchema>) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.select({ id: projectWbs.id }).from(projectWbs).where(and(eq(projectWbs.id, input.wbsId), eq(projectWbs.projectId, projectId)));
      if (!w) throw new BadRequestException('WBS element not found in this project');
      const [d] = await many<{ docType: string }>(tx, sql`select doc_type as "docType" from documents where id = ${input.documentId}`);
      if (!d) throw new NotFoundException('Document not found');
      if (!LINKABLE.includes(d.docType)) throw new BadRequestException('Purchase orders, purchase invoices, stock entries and journals can be charged to a project');
      const [r] = await tx
        .insert(projectCostLinks)
        .values({ tenantId: auth.tenantId, projectId, ...input })
        .onConflictDoNothing()
        .returning();
      if (!r) throw new ConflictException('This document is already charged to a project');
      return this.view(tx, projectId);
    });
  }

  /** Documents that can be charged: by number. */
  searchDocuments(auth: AuthContext, q: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select d.id, d.doc_type as "docType", d.number, d.status, d.doc_date::text as "docDate", d.amount from documents d
            where d.doc_type in ${LINKABLE} and d.number ilike ${`%${q.replace(/[%_\\]/g, '')}%`} and d.status not in ('cancelled')
              and not exists (select 1 from project_cost_links l where l.document_id = d.id)
            order by d.doc_date desc limit 20`,
      ),
    );
  }

  addResource(auth: AuthContext, projectId: string, input: z.infer<typeof resourceSchema>) {
    if (input.toDate < input.fromDate) throw new BadRequestException('The assignment ends before it starts');
    return this.database.run(auth, async (tx) => {
      await tx.insert(projectResources).values({ tenantId: auth.tenantId, projectId, ...input, wbsId: input.wbsId ?? null });
      return this.view(tx, projectId);
    });
  }

  bookTime(auth: AuthContext, projectId: string, input: z.infer<typeof timeSchema>) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.select({ id: projectWbs.id }).from(projectWbs).where(and(eq(projectWbs.id, input.wbsId), eq(projectWbs.projectId, projectId)));
      if (!w) throw new BadRequestException('WBS element not found in this project');
      const [{ h }] = await many<{ h: number }>(tx, sql`select coalesce(sum(hours), 0)::float8 as h from project_time where employee_id = ${input.employeeId} and work_date = ${input.workDate} and status <> 'rejected'`);
      if (h + input.hours > 24) throw new ConflictException(`${h} hours are already booked on ${input.workDate}`);
      await tx.insert(projectTime).values({ tenantId: auth.tenantId, projectId, ...input, note: input.note ?? null });
      return this.view(tx, projectId);
    });
  }

  approveTime(auth: AuthContext, projectId: string, input: z.infer<typeof approveTimeSchema>) {
    return this.database.run(auth, async (tx) => {
      await tx.execute(sql`update project_time set status = ${input.approve ? 'approved' : 'rejected'}, approved_by = ${auth.userId} where project_id = ${projectId} and id in ${input.ids} and status = 'submitted'`);
      return this.view(tx, projectId);
    });
  }

  load(auth: AuthContext, q: z.infer<typeof loadQuery>) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ employeeId: string; employee: string; project: string; fromDate: string; toDate: string; hoursPerWeek: number }>(
        tx,
        sql`select r.employee_id as "employeeId", e.full_name as employee, p.code as project, r.from_date::text as "fromDate", r.to_date::text as "toDate", r.hours_per_week as "hoursPerWeek"
            from project_resources r join employees e on e.id = r.employee_id join projects p on p.id = r.project_id where p.status <> 'closed'`,
      );
      return resourceLoad(rows, q.from ?? todayIST(), q.weeks);
    });
  }
}
