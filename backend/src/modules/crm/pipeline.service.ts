import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { crmOpportunities, crmStages, crmTargets, crmTerritories, crmWebForms, parties, users, type Transaction } from '@nextgen/database';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { QuotationsService } from '../sales/quotations.service';
import { opportunityNextAction, type ActivityFacts, type OpportunityFacts } from './insight';
import { many } from '../../common/sql';

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');

export const opportunitySchema = z.object({
  title: z.string().trim().min(2).max(200),
  partyId: z.uuid(),
  stageId: z.uuid().optional(),
  amount: z.number().min(0).max(1e12).default(0),
  closeDate: z.iso.date().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  competitor: z.string().trim().max(120).nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  territoryId: z.uuid().nullable().optional(),
});
export const moveSchema = z.object({ stageId: z.uuid(), lostReason: z.string().trim().max(300).nullable().optional() });
export const quoteSchema = z.object({ lines: z.array(z.object({ itemId: z.uuid(), qty: z.union([z.string(), z.number()]), rate: z.union([z.string(), z.number()]).nullable().optional() })).min(1).max(100), validUntil: z.iso.date().nullable().optional() });
export const stageSchema = z.object({ name: z.string().trim().min(2).max(60), probability: z.number().int().min(0).max(100), sequence: z.number().int().min(1).max(99), kind: z.enum(['open', 'won', 'lost']).default('open'), isActive: z.boolean().default(true) });
export const territorySchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(2).max(80), parentId: z.uuid().nullable().optional(), stateCodes: z.array(z.string().regex(/^\d{2}$/)).max(40).default([]), ownerId: z.uuid().nullable().optional(), isActive: z.boolean().default(true) });
export const formSchema = z.object({ name: z.string().trim().min(2).max(80), source: z.enum(['web', 'whatsapp', 'email', 'exhibition', 'other']).default('web'), ownerId: z.uuid().nullable().optional(), isActive: z.boolean().default(true) });
export const targetSchema = z.object({ userId: z.uuid(), month, amount: z.number().min(0).max(1e12) });

const DEFAULT_STAGES = [
  { name: 'Qualification', probability: 10, sequence: 1, kind: 'open' },
  { name: 'Needs analysis', probability: 25, sequence: 2, kind: 'open' },
  { name: 'Proposal', probability: 50, sequence: 3, kind: 'open' },
  { name: 'Negotiation', probability: 75, sequence: 4, kind: 'open' },
  { name: 'Won', probability: 100, sequence: 8, kind: 'won' },
  { name: 'Lost', probability: 0, sequence: 9, kind: 'lost' },
];

/**
 * Opportunities through the pipeline stages, the weighted forecast, sales targets against won
 * business, and the CRM setup (territories, stages, web forms).
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly database: DatabaseService,
    private readonly quotations: QuotationsService,
  ) {}

  async ensureStages(tx: Transaction, tenantId: string) {
    const rows = await tx.select().from(crmStages).orderBy(asc(crmStages.sequence));
    if (rows.length) return rows;
    return tx.insert(crmStages).values(DEFAULT_STAGES.map((s) => ({ tenantId, ...s }))).returning();
  }

  stages(auth: AuthContext) {
    return this.database.run(auth, (tx) => this.ensureStages(tx, auth.tenantId));
  }

  saveStage(auth: AuthContext, id: string | null, input: z.infer<typeof stageSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.ensureStages(tx, auth.tenantId);
      if (id) {
        const [r] = await tx.update(crmStages).set(input).where(eq(crmStages.id, id)).returning();
        if (!r) throw new NotFoundException('Stage not found');
        return r;
      }
      return (await tx.insert(crmStages).values({ tenantId: auth.tenantId, ...input }).returning())[0];
    });
  }

  // ---- opportunities ----------------------------------------------------------------------

  list(auth: AuthContext, q: { status?: string; ownerId?: string; partyId?: string }) {
    return this.database.run(auth, async (tx) => {
      await this.ensureStages(tx, auth.tenantId);
      return many(
        tx,
        sql`select o.id, o.number, o.title, o.amount, o.close_date::text as "closeDate", o.status, o.stage_id as "stageId", s.name as stage, coalesce(o.probability, s.probability) as probability,
                   o.party_id as "partyId", p.name as party, o.owner_id as "ownerId", u.full_name as owner, o.quotation_id as "quotationId", o.lost_reason as "lostReason",
                   (select min(a.due_at) from crm_activities a where a.opportunity_id = o.id and a.done_at is null) as "nextActivity",
                   (o.close_date < (now() at time zone 'Asia/Kolkata')::date and o.status = 'open') as overdue
            from crm_opportunities o join crm_stages s on s.id = o.stage_id join parties p on p.id = o.party_id left join users u on u.id = o.owner_id
            where true ${q.status ? sql`and o.status = ${q.status}` : sql``} ${q.ownerId ? sql`and o.owner_id = ${q.ownerId}` : sql``} ${q.partyId ? sql`and o.party_id = ${q.partyId}` : sql``}
            order by s.sequence, o.close_date nulls last limit 1000`,
      );
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [o] = await many(
        tx,
        sql`select o.id, o.number, o.title, o.amount, o.close_date::text as "closeDate", o.status, o.stage_id as "stageId", s.name as stage, s.probability as "stageProbability", o.probability,
                   o.party_id as "partyId", p.name as party, o.owner_id as "ownerId", u.full_name as owner, o.lead_id as "leadId", l.number as "leadNumber", o.competitor, o.lost_reason as "lostReason",
                   o.quotation_id as "quotationId", q.number as "quotationNumber", q.status as "quotationStatus", o.territory_id as "territoryId", o.created_at as "createdAt", o.closed_at as "closedAt"
            from crm_opportunities o join crm_stages s on s.id = o.stage_id join parties p on p.id = o.party_id left join users u on u.id = o.owner_id
            left join crm_leads l on l.id = o.lead_id left join documents q on q.id = o.quotation_id
            where o.id = ${id}`,
      );
      if (!o) throw new NotFoundException('Opportunity not found');
      const activities = await many(
        tx,
        sql`select a.id, a.kind, a.subject, a.notes, a.due_at as "dueAt", a.done_at as "doneAt", a.outcome, u.full_name as owner from crm_activities a left join users u on u.id = a.owner_id
            where a.opportunity_id = ${id} order by coalesce(a.done_at, a.due_at, a.created_at) desc`,
      );
      return { ...o, activities, nextAction: opportunityNextAction(o as unknown as OpportunityFacts, activities as unknown as ActivityFacts[], new Date()) };
    });
  }

  create(auth: AuthContext, input: z.infer<typeof opportunitySchema>) {
    return this.database.run(auth, (tx) => this.createTx(tx, auth, { ...input, ownerId: input.ownerId ?? auth.userId }));
  }

  async createTx(tx: Transaction, auth: AuthContext, input: z.infer<typeof opportunitySchema> & { leadId?: string | null }) {
    const stages = await this.ensureStages(tx, auth.tenantId);
    const [p] = await tx.select({ id: parties.id, isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, input.partyId));
    if (!p?.isCustomer) throw new BadRequestException('Choose a customer');
    const stage = input.stageId ? stages.find((s) => s.id === input.stageId) : stages.find((s) => s.kind === 'open' && s.isActive);
    if (!stage || stage.kind !== 'open') throw new BadRequestException('Start the opportunity in an open stage');
    const number = await nextCode(tx, auth.tenantId, 'crm_opportunity', 'OP', 5);
    const [o] = await tx
      .insert(crmOpportunities)
      .values({ tenantId: auth.tenantId, number, title: input.title, partyId: input.partyId, leadId: input.leadId ?? null, stageId: stage.id, amount: input.amount.toFixed(2), closeDate: input.closeDate ?? null, probability: input.probability ?? null, competitor: input.competitor ?? null, ownerId: input.ownerId ?? auth.userId, territoryId: input.territoryId ?? null })
      .returning();
    return o;
  }

  update(auth: AuthContext, id: string, input: z.infer<typeof opportunitySchema>) {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(crmOpportunities).where(eq(crmOpportunities.id, id)).for('update');
      if (!o) throw new NotFoundException('Opportunity not found');
      if (o.status !== 'open') throw new ConflictException(`The opportunity is ${o.status}`);
      const { stageId: _s, ...rest } = input;
      return (await tx.update(crmOpportunities).set({ ...rest, amount: input.amount.toFixed(2), updatedAt: new Date() }).where(eq(crmOpportunities.id, id)).returning())[0];
    });
  }

  /** Drag on the board: an open stage, or Won / Lost (lost needs a reason). */
  move(auth: AuthContext, id: string, input: z.infer<typeof moveSchema>) {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(crmOpportunities).where(eq(crmOpportunities.id, id)).for('update');
      if (!o) throw new NotFoundException('Opportunity not found');
      const [s] = await tx.select().from(crmStages).where(eq(crmStages.id, input.stageId));
      if (!s || !s.isActive) throw new BadRequestException('Unknown stage');
      if (s.kind === 'lost' && !input.lostReason) throw new BadRequestException('Say why it was lost');
      const status = s.kind === 'open' ? 'open' : s.kind;
      await tx
        .update(crmOpportunities)
        .set({ stageId: s.id, status, lostReason: s.kind === 'lost' ? input.lostReason : null, closedAt: status === 'open' ? null : new Date(), updatedAt: new Date() })
        .where(eq(crmOpportunities.id, id));
      return { status, stage: s.name };
    });
  }

  /** A draft quotation for the opportunity's customer; the opportunity moves to the proposal stage. */
  quote(auth: AuthContext, id: string, input: z.infer<typeof quoteSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [o] = await tx.select().from(crmOpportunities).where(eq(crmOpportunities.id, id)).for('update');
      if (!o) throw new NotFoundException('Opportunity not found');
      if (o.status !== 'open') throw new ConflictException(`The opportunity is ${o.status}`);
      const q = await this.quotations.createTx(
        tx,
        auth,
        { customerId: o.partyId, validUntil: input.validUntil ?? null, customerEnquiryRef: o.number, withLut: false, lines: input.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), rate: l.rate === null || l.rate === undefined || l.rate === '' ? null : String(l.rate), discountPct: null })) } as Parameters<QuotationsService['createTx']>[2],
        meta,
      );
      const stages = await this.ensureStages(tx, auth.tenantId);
      const current = stages.find((s) => s.id === o.stageId);
      const proposal = stages.find((s) => s.kind === 'open' && s.isActive && s.probability >= 50);
      // The opportunity is valued before tax, like the pipeline.
      const amount = Number(q.taxableTotal ?? o.amount);
      await tx
        .update(crmOpportunities)
        .set({ quotationId: q.id, amount: amount.toFixed(2), stageId: proposal && current && current.sequence < proposal.sequence ? proposal.id : o.stageId, updatedAt: new Date() })
        .where(eq(crmOpportunities.id, id));
      return { quotationId: q.id, amount: amount.toFixed(2) };
    });
  }

  /** Open pipeline by month of expected close: total and weighted by probability. */
  forecast(auth: AuthContext, q: { ownerId?: string; from: string; to: string }) {
    return this.database.run(auth, async (tx) => {
      const byMonth = await many<{ month: string; count: number; total: number; weighted: number }>(
        tx,
        sql`select to_char(coalesce(o.close_date, (now() at time zone 'Asia/Kolkata')::date), 'YYYY-MM') as month, count(*)::int as count, sum(o.amount)::float8 as total,
                   round(sum(o.amount * coalesce(o.probability, s.probability) / 100.0), 2)::float8 as weighted
            from crm_opportunities o join crm_stages s on s.id = o.stage_id
            where o.status = 'open' ${q.ownerId ? sql`and o.owner_id = ${q.ownerId}` : sql``}
              and coalesce(o.close_date, (now() at time zone 'Asia/Kolkata')::date) between ${q.from}::date and ${q.to}::date
            group by 1 order by 1`,
      );
      const byStage = await many(
        tx,
        sql`select s.name as stage, s.sequence, count(o.id)::int as count, coalesce(sum(o.amount), 0)::float8 as total
            from crm_stages s left join crm_opportunities o on o.stage_id = s.id and o.status = 'open' ${q.ownerId ? sql`and o.owner_id = ${q.ownerId}` : sql``}
            where s.kind = 'open' and s.is_active group by s.name, s.sequence order by s.sequence`,
      );
      const [winRate] = await many<{ won: number; lost: number }>(
        tx,
        sql`select count(*) filter (where status = 'won')::int as won, count(*) filter (where status = 'lost')::int as lost from crm_opportunities
            where closed_at >= ${q.from}::date - interval '1 year' ${q.ownerId ? sql`and owner_id = ${q.ownerId}` : sql``}`,
      );
      return { byMonth, byStage, winRate: winRate.won + winRate.lost ? Math.round((winRate.won / (winRate.won + winRate.lost)) * 100) : null };
    });
  }

  // ---- targets ----------------------------------------------------------------------------

  /** Targets for a month against won opportunities closed in it, per salesperson. */
  targets(auth: AuthContext, m: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select u.id as "userId", u.full_name as name, coalesce(t.amount, 0)::float8 as target,
                   coalesce((select sum(o.amount) from crm_opportunities o where o.owner_id = u.id and o.status = 'won' and to_char(o.closed_at at time zone 'Asia/Kolkata', 'YYYY-MM') = ${m}), 0)::float8 as won,
                   coalesce((select sum(o.amount) from crm_opportunities o where o.owner_id = u.id and o.status = 'open' and to_char(o.close_date, 'YYYY-MM') = ${m}), 0)::float8 as pipeline
            from users u left join crm_targets t on t.user_id = u.id and t.month = ${m}
            where u.id in (select user_id from crm_targets where month = ${m} union select owner_id from crm_opportunities where owner_id is not null)
            order by u.full_name`,
      ),
    );
  }

  setTarget(auth: AuthContext, input: z.infer<typeof targetSchema>) {
    return this.database.run(auth, async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId));
      if (!u) throw new NotFoundException('User not found');
      const amount = input.amount.toFixed(2);
      return (await tx.insert(crmTargets).values({ tenantId: auth.tenantId, ...input, amount }).onConflictDoUpdate({ target: [crmTargets.tenantId, crmTargets.userId, crmTargets.month], set: { amount } }).returning())[0];
    });
  }

  // ---- setup ------------------------------------------------------------------------------

  territories(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select t.id, t.code, t.name, t.parent_id as "parentId", t.state_codes as "stateCodes", t.owner_id as "ownerId", u.full_name as owner, t.is_active as "isActive",
                   (select count(*)::int from crm_leads l where l.territory_id = t.id and l.status not in ('converted', 'lost', 'unqualified')) as "openLeads"
            from crm_territories t left join users u on u.id = t.owner_id order by t.code`,
      ),
    );
  }

  saveTerritory(auth: AuthContext, id: string | null, input: z.infer<typeof territorySchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, code: input.code.toUpperCase(), parentId: input.parentId ?? null, ownerId: input.ownerId ?? null };
      const [dup] = await tx.select({ id: crmTerritories.id }).from(crmTerritories).where(and(eq(crmTerritories.code, values.code), id ? ne(crmTerritories.id, id) : undefined));
      if (dup) throw new ConflictException(`Territory ${values.code} already exists`);
      // A state belongs to one territory, so assignment is unambiguous.
      for (const st of values.stateCodes) {
        const [clash] = await many<{ name: string }>(tx, sql`select name from crm_territories where ${st} = any(state_codes) and is_active ${id ? sql`and id <> ${id}` : sql``} limit 1`);
        if (clash) throw new ConflictException(`State ${st} is already in territory ${clash.name}`);
      }
      if (id) {
        const [r] = await tx.update(crmTerritories).set(values).where(eq(crmTerritories.id, id)).returning();
        if (!r) throw new NotFoundException('Territory not found');
        return r;
      }
      return (await tx.insert(crmTerritories).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  forms(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(crmWebForms).orderBy(asc(crmWebForms.name)));
  }

  saveForm(auth: AuthContext, id: string | null, input: z.infer<typeof formSchema>) {
    return this.database.run(auth, async (tx) => {
      if (id) {
        const [r] = await tx.update(crmWebForms).set({ ...input, ownerId: input.ownerId ?? null }).where(eq(crmWebForms.id, id)).returning();
        if (!r) throw new NotFoundException('Form not found');
        return r;
      }
      const key = `${auth.tenantId}.${randomBytes(18).toString('base64url')}`;
      return (await tx.insert(crmWebForms).values({ tenantId: auth.tenantId, ...input, ownerId: input.ownerId ?? null, key }).returning())[0];
    });
  }

  /** Counts for the CRM home. */
  summary(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [r] = await many(
        tx,
        sql`select (select count(*)::int from crm_leads where status in ('new', 'contacted', 'qualified')) as "openLeads",
                   (select count(*)::int from crm_leads where status = 'new') as "newLeads",
                   (select count(*)::int from crm_leads where owner_id is null and status in ('new', 'contacted', 'qualified')) as unassigned,
                   (select count(*)::int from crm_opportunities where status = 'open') as "openOpportunities",
                   (select coalesce(sum(amount), 0)::float8 from crm_opportunities where status = 'open') as pipeline,
                   (select count(*)::int from crm_activities where done_at is null and owner_id = ${auth.userId} and due_at < now()) as "overdueActivities",
                   (select count(*)::int from crm_leads l where l.created_at >= now() - interval '30 days') as "leads30",
                   (select count(*)::int from crm_leads l where l.created_at >= now() - interval '30 days' and l.status = 'converted') as "converted30"`,
      );
      const bySource = await many(tx, sql`select source, count(*)::int as leads, count(*) filter (where status = 'converted')::int as converted from crm_leads where created_at >= now() - interval '90 days' group by source order by 2 desc`);
      return { ...r, bySource };
    });
  }
}
