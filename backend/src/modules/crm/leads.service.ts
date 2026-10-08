import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { crmActivities, crmLeads, crmOpportunities, crmTerritories, crmWebForms, parties, users, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { parseSheet } from '../imports/file-parser';
import { createPartySchema, PartiesService } from '../masters/parties.service';
import { PipelineService } from './pipeline.service';
import { phoneKey, readLeadRow, scoreLead, stateCodeOf } from './scoring';
import { leadInsight, type ActivityFacts } from './insight';
import { many } from '../../common/sql';

const text = (max: number) => z.string().trim().max(max).nullable().optional();
export const SOURCES = ['web', 'indiamart', 'tradeindia', 'justdial', 'whatsapp', 'email', 'referral', 'walk_in', 'exhibition', 'other'] as const;

export const leadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: text(160),
  email: z.email().nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().trim().regex(/^\+?[0-9 -]{8,16}$/, 'Enter a valid phone number').nullable().optional().or(z.literal('').transform(() => null)),
  city: text(80),
  stateCode: z.string().regex(/^\d{2}$/).nullable().optional(),
  source: z.enum(SOURCES).default('other'),
  sourceRef: text(80),
  requirement: text(4000),
  product: text(200),
  estimatedValue: z.number().min(0).max(1e12).nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
  nextFollowUp: z.iso.date().nullable().optional(),
});
export const statusSchema = z.object({ status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'lost']), lostReason: z.string().trim().max(300).nullable().optional() });
export const assignSchema = z.object({ leadIds: z.array(z.uuid()).min(1).max(500), ownerId: z.uuid() });
export const convertSchema = z.object({
  partyId: z.uuid().optional(),
  party: z
    .object({
      name: z.string().trim().min(2).max(200),
      gstin: z.string().trim().nullable().optional(),
      address: z.object({ line1: z.string().trim().min(3).max(200), city: z.string().trim().min(2).max(80), stateCode: z.string().regex(/^\d{2}$/), pincode: z.string().regex(/^\d{6}$/).nullable().optional() }).optional(),
    })
    .optional(),
  opportunity: z.object({ title: z.string().trim().min(2).max(200), amount: z.number().min(0).max(1e12), closeDate: z.iso.date().nullable().optional() }).optional(),
});
export const activitySchema = z.object({
  kind: z.enum(['call', 'meeting', 'task', 'note', 'email', 'whatsapp']),
  subject: z.string().trim().min(2).max(200),
  notes: text(4000),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  done: z.boolean().default(false),
  outcome: text(300),
  leadId: z.uuid().nullable().optional(),
  opportunityId: z.uuid().nullable().optional(),
  partyId: z.uuid().nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
});
export const captureSchema = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().max(160).optional(),
  email: z.email().optional(),
  phone: z.string().trim().regex(/^\+?[0-9 -]{8,16}$/).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(60).optional(),
  product: z.string().trim().max(200).optional(),
  message: z.string().trim().max(4000).optional(),
  /** Honeypot: humans leave it empty. */
  website: z.string().max(0).optional(),
});

type LeadInput = z.infer<typeof leadSchema>;

/**
 * Leads from every channel: manual, enquiry-portal exports, public web forms. Each is scored,
 * checked for duplicates (same phone or email as an open lead or a customer) and assigned to the
 * territory owner for its state; qualified leads convert to a customer and an opportunity.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly parties: PartiesService,
    private readonly pipeline: PipelineService,
  ) {}

  list(auth: AuthContext, q: { status?: string; source?: string; ownerId?: string; q?: string; grade?: string; limit: number; offset: number }) {
    return this.database.run(auth, async (tx) => {
      const term = q.q ? `%${q.q}%` : null;
      const rows = await many(
        tx,
        sql`select l.id, l.number, l.name, l.company, l.email, l.phone, l.city, l.state_code as "stateCode", l.source, l.product, l.estimated_value as "estimatedValue", l.status, l.score,
                   l.duplicate_of_id as "duplicateOfId", l.next_follow_up::text as "nextFollowUp", l.created_at as "createdAt", u.full_name as owner, l.owner_id as "ownerId", t.name as territory,
                   count(*) over ()::int as total
            from crm_leads l left join users u on u.id = l.owner_id left join crm_territories t on t.id = l.territory_id
            where true ${q.status ? sql`and l.status = ${q.status}` : sql`and l.status not in ('converted', 'lost', 'unqualified')`}
              ${q.source ? sql`and l.source = ${q.source}` : sql``} ${q.ownerId ? sql`and l.owner_id = ${q.ownerId}` : sql``}
              ${q.grade === 'A' ? sql`and l.score >= 70` : q.grade === 'B' ? sql`and l.score >= 40 and l.score < 70` : q.grade === 'C' ? sql`and l.score < 40` : sql``}
              ${term ? sql`and (l.name ilike ${term} or l.company ilike ${term} or l.phone ilike ${term} or l.email ilike ${term} or l.number ilike ${term})` : sql``}
            order by l.score desc, l.created_at desc limit ${sql`${q.limit}::int`} offset ${sql`${q.offset}::int`}`,
      );
      return { total: (rows[0] as { total?: number } | undefined)?.total ?? 0, items: rows };
    });
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [l] = await many(
        tx,
        sql`select l.*, l.state_code as "stateCode", l.source_ref as "sourceRef", l.estimated_value as "estimatedValue", l.score_reasons as "scoreReasons", l.duplicate_of_id as "duplicateOfId",
                   l.territory_id as "territoryId", l.owner_id as "ownerId", l.party_id as "partyId", l.opportunity_id as "opportunityId", l.lost_reason as "lostReason", l.next_follow_up::text as "nextFollowUp",
                   l.created_at as "createdAt", u.full_name as owner, t.name as territory, p.name as "partyName", d.number as "duplicateNumber"
            from crm_leads l left join users u on u.id = l.owner_id left join crm_territories t on t.id = l.territory_id left join parties p on p.id = l.party_id left join crm_leads d on d.id = l.duplicate_of_id
            where l.id = ${id}`,
      );
      if (!l) throw new NotFoundException('Lead not found');
      const activities = await this.activitiesFor(tx, { leadId: id });
      const r = l as Record<string, unknown>;
      const insight = leadInsight(
        { email: (r.email as string) ?? null, phone: (r.phone as string) ?? null, company: (r.company as string) ?? null, source: String(r.source), requirement: (r.requirement as string) ?? null, estimatedValue: r.estimatedValue == null ? null : Number(r.estimatedValue), activities: 0, status: String(r.status), createdAt: r.createdAt as string },
        activities as unknown as ActivityFacts[],
        new Date(),
      );
      return { ...l, activities, insight };
    });
  }

  create(auth: AuthContext, input: LeadInput) {
    return this.database.run(auth, async (tx) => (await this.createTx(tx, auth.tenantId, auth.userId, input)).lead);
  }

  /** Inserts a lead (or returns the existing one with the same portal reference). */
  async createTx(tx: Transaction, tenantId: string, userId: string | null, input: LeadInput): Promise<{ lead: typeof crmLeads.$inferSelect; created: boolean }> {
    if (input.sourceRef) {
      const [existing] = await tx.select().from(crmLeads).where(and(eq(crmLeads.source, input.source), eq(crmLeads.sourceRef, input.sourceRef)));
      if (existing) return { lead: existing, created: false };
    }
    let territoryId: string | null = null;
    let ownerId = input.ownerId ?? null;
    if (input.stateCode) {
      const [t] = await tx.select({ id: crmTerritories.id, ownerId: crmTerritories.ownerId }).from(crmTerritories).where(and(eq(crmTerritories.isActive, true), sql`${input.stateCode} = any(${crmTerritories.stateCodes})`)).limit(1);
      if (t) {
        territoryId = t.id;
        ownerId ??= t.ownerId;
      }
    }
    const duplicateOfId = await this.findDuplicate(tx, input.phone, input.email);
    const number = await nextCode(tx, tenantId, 'crm_lead', 'LD', 5);
    const s = scoreLead({ email: input.email ?? null, phone: input.phone ?? null, company: input.company ?? null, source: input.source, requirement: input.requirement ?? null, estimatedValue: input.estimatedValue ?? null, activities: 0, status: 'new' });
    const [lead] = await tx
      .insert(crmLeads)
      .values({
        tenantId,
        number,
        name: input.name,
        company: input.company ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        city: input.city ?? null,
        stateCode: input.stateCode ?? null,
        source: input.source,
        sourceRef: input.sourceRef ?? null,
        requirement: input.requirement ?? null,
        product: input.product ?? null,
        estimatedValue: input.estimatedValue === null || input.estimatedValue === undefined ? null : input.estimatedValue.toFixed(2),
        score: s.score,
        scoreReasons: s.reasons,
        duplicateOfId,
        territoryId,
        ownerId,
        nextFollowUp: input.nextFollowUp ?? null,
        createdBy: userId,
      })
      .returning();
    return { lead, created: true };
  }

  /** An open lead or a customer with the same phone (last 10 digits) or email. */
  private async findDuplicate(tx: Transaction, phone: string | null | undefined, email: string | null | undefined) {
    const p = phoneKey(phone);
    if (!p && !email) return null;
    const [l] = await many<{ id: string }>(
      tx,
      sql`select id from crm_leads where status not in ('converted', 'lost', 'unqualified')
            and (${p ? sql`right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${p}` : sql`false`} or ${email ? sql`email = ${email}` : sql`false`})
          order by created_at limit 1`,
    );
    return l?.id ?? null;
  }

  update(auth: AuthContext, id: string, input: LeadInput) {
    return this.database.run(auth, async (tx) => {
      const [cur] = await tx.select().from(crmLeads).where(eq(crmLeads.id, id)).for('update');
      if (!cur) throw new NotFoundException('Lead not found');
      if (cur.status === 'converted') throw new ConflictException('A converted lead cannot be edited; work on the opportunity');
      await tx
        .update(crmLeads)
        .set({ ...input, estimatedValue: input.estimatedValue === null || input.estimatedValue === undefined ? null : input.estimatedValue.toFixed(2), updatedAt: new Date() })
        .where(eq(crmLeads.id, id));
      await this.rescore(tx, id);
      return (await tx.select().from(crmLeads).where(eq(crmLeads.id, id)))[0];
    });
  }

  async rescore(tx: Transaction, id: string) {
    const [l] = await tx.select().from(crmLeads).where(eq(crmLeads.id, id));
    const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int as n from crm_activities where lead_id = ${id} and done_at is not null`);
    const s = scoreLead({ email: l.email ? String(l.email) : null, phone: l.phone, company: l.company, source: l.source, requirement: l.requirement, estimatedValue: l.estimatedValue === null ? null : Number(l.estimatedValue), activities: n, status: l.status });
    await tx.update(crmLeads).set({ score: s.score, scoreReasons: s.reasons }).where(eq(crmLeads.id, id));
  }

  setStatus(auth: AuthContext, id: string, input: z.infer<typeof statusSchema>) {
    return this.database.run(auth, async (tx) => {
      const [l] = await tx.select().from(crmLeads).where(eq(crmLeads.id, id)).for('update');
      if (!l) throw new NotFoundException('Lead not found');
      if (l.status === 'converted') throw new ConflictException('The lead is already converted');
      if (input.status === 'lost' && !input.lostReason) throw new BadRequestException('Say why the lead was lost');
      await tx.update(crmLeads).set({ status: input.status, lostReason: input.status === 'lost' ? input.lostReason : null, updatedAt: new Date() }).where(eq(crmLeads.id, id));
      await this.rescore(tx, id);
      return { status: input.status };
    });
  }

  assign(auth: AuthContext, input: z.infer<typeof assignSchema>) {
    return this.database.run(auth, async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.ownerId));
      if (!u) throw new NotFoundException('User not found');
      const r = await tx.update(crmLeads).set({ ownerId: input.ownerId, updatedAt: new Date() }).where(inArray(crmLeads.id, input.leadIds)).returning({ id: crmLeads.id });
      return { assigned: r.length };
    });
  }

  /** CSV / XLSX exports from IndiaMART, TradeIndia, JustDial or a plain list. */
  async importFile(auth: AuthContext, buffer: Buffer, fileName: string, source: (typeof SOURCES)[number]) {
    const sheet = await parseSheet(buffer, fileName);
    return this.database.run(auth, async (tx) => {
      let created = 0;
      let existing = 0;
      const skipped: number[] = [];
      for (const row of sheet.rows) {
        const r = readLeadRow(row.values);
        if (!r) {
          skipped.push(row.rowNo);
          continue;
        }
        const res = await this.createTx(tx, auth.tenantId, auth.userId, {
          name: r.name.slice(0, 120),
          company: r.company,
          email: r.email,
          phone: r.phone && /^\+?[0-9 -]{8,16}$/.test(r.phone) ? r.phone : null,
          city: r.city,
          stateCode: stateCodeOf(r.state),
          source,
          sourceRef: r.sourceRef,
          requirement: r.requirement,
          product: r.product,
        });
        if (res.created) created++;
        else existing++;
      }
      return { rows: sheet.rows.length, created, alreadyImported: existing, skippedRows: skipped.slice(0, 50) };
    });
  }

  /** A website enquiry, posted without a login; the form key carries the workspace. */
  async capture(formKey: string, input: z.infer<typeof captureSchema>) {
    const tenantId = formKey.split('.')[0];
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new NotFoundException('Unknown form');
    if (input.website) return { ok: true };
    if (!input.email && !input.phone) throw new BadRequestException('Give an email or a phone number');
    return this.database.run({ tenantId, userId: null as unknown as string }, async (tx) => {
      const [form] = await tx.select().from(crmWebForms).where(and(eq(crmWebForms.key, formKey), eq(crmWebForms.isActive, true)));
      if (!form) throw new NotFoundException('Unknown form');
      const { lead } = await this.createTx(tx, tenantId, null, {
        name: input.name,
        company: input.company ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        city: input.city ?? null,
        stateCode: stateCodeOf(input.state),
        source: form.source as (typeof SOURCES)[number],
        requirement: input.message ?? null,
        product: input.product ?? null,
        ownerId: form.ownerId,
      });
      await tx.update(crmWebForms).set({ submissions: sql`${crmWebForms.submissions} + 1` }).where(eq(crmWebForms.id, form.id));
      return { ok: true, reference: lead.number };
    });
  }

  /** Customer (existing or new) and, optionally, an opportunity for them. */
  convert(auth: AuthContext, id: string, input: z.infer<typeof convertSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [l] = await tx.select().from(crmLeads).where(eq(crmLeads.id, id)).for('update');
      if (!l) throw new NotFoundException('Lead not found');
      if (l.status === 'converted') throw new ConflictException('Already converted');
      let partyId = input.partyId ?? null;
      if (partyId) {
        const [p] = await tx.select({ id: parties.id, isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, partyId));
        if (!p) throw new NotFoundException('Customer not found');
        if (!p.isCustomer) await tx.update(parties).set({ isCustomer: true }).where(eq(parties.id, partyId));
      } else {
        const np = input.party ?? { name: l.company ?? l.name };
        const parsed = createPartySchema.safeParse({
          name: np.name,
          isCustomer: true,
          gstin: np.gstin || null,
          gstRegistrationType: np.gstin ? 'regular' : 'unregistered',
          email: l.email ? String(l.email) : null,
          phone: l.phone,
          addresses: np.address ? [{ type: 'both', line1: np.address.line1, city: np.address.city, stateCode: np.address.stateCode, pincode: np.address.pincode ?? null, isDefault: true }] : [],
          contacts: [{ name: l.name, email: l.email ? String(l.email) : null, phone: l.phone, isPrimary: true }],
        });
        if (!parsed.success) throw new BadRequestException(`The customer details need fixing: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        partyId = (await this.parties.createTx(tx, auth, parsed.data, meta)).id;
      }
      let opportunityId: string | null = null;
      if (input.opportunity) {
        const o = await this.pipeline.createTx(tx, auth, { title: input.opportunity.title, partyId: partyId!, amount: input.opportunity.amount, closeDate: input.opportunity.closeDate ?? null, ownerId: l.ownerId ?? auth.userId, leadId: l.id, territoryId: l.territoryId });
        opportunityId = o.id;
      }
      await tx.update(crmLeads).set({ status: 'converted', partyId, opportunityId, updatedAt: new Date() }).where(eq(crmLeads.id, id));
      // Earlier activities follow the customer.
      await tx.update(crmActivities).set({ partyId, opportunityId }).where(eq(crmActivities.leadId, id));
      return { partyId, opportunityId };
    });
  }

  // ---- activities -------------------------------------------------------------------------

  async activitiesFor(tx: Transaction, q: { leadId?: string; opportunityId?: string; partyId?: string }) {
    return many(
      tx,
      sql`select a.id, a.kind, a.subject, a.notes, a.due_at as "dueAt", a.done_at as "doneAt", a.outcome, a.lead_id as "leadId", a.opportunity_id as "opportunityId", a.party_id as "partyId",
                 u.full_name as owner, a.created_at as "createdAt"
          from crm_activities a left join users u on u.id = a.owner_id
          where ${q.leadId ? sql`a.lead_id = ${q.leadId}` : q.opportunityId ? sql`a.opportunity_id = ${q.opportunityId}` : sql`a.party_id = ${q.partyId!}`}
          order by coalesce(a.done_at, a.due_at, a.created_at) desc limit 200`,
    );
  }

  /** The signed-in user's open tasks: overdue first, then today and upcoming. */
  agenda(auth: AuthContext, ownerId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select a.id, a.kind, a.subject, a.due_at as "dueAt", a.lead_id as "leadId", a.opportunity_id as "opportunityId", l.name as "leadName", o.title as "opportunityTitle", p.name as "partyName",
                   (a.due_at < now()) as overdue
            from crm_activities a left join crm_leads l on l.id = a.lead_id left join crm_opportunities o on o.id = a.opportunity_id left join parties p on p.id = a.party_id
            where a.done_at is null and a.owner_id = ${ownerId ?? auth.userId}
            order by a.due_at nulls last limit 200`,
      ),
    );
  }

  addActivity(auth: AuthContext, input: z.infer<typeof activitySchema>) {
    if (!input.leadId && !input.opportunityId && !input.partyId) throw new BadRequestException('Link the activity to a lead, an opportunity or a customer');
    if (!input.done && !input.dueAt && input.kind !== 'note') throw new BadRequestException('Give a due time, or mark it done');
    return this.database.run(auth, async (tx) => {
      let partyId = input.partyId ?? null;
      if (input.opportunityId) {
        const [o] = await tx.select({ partyId: crmOpportunities.partyId }).from(crmOpportunities).where(eq(crmOpportunities.id, input.opportunityId));
        if (!o) throw new NotFoundException('Opportunity not found');
        partyId ??= o.partyId;
      }
      const done = input.done || input.kind === 'note';
      const [a] = await tx
        .insert(crmActivities)
        .values({ tenantId: auth.tenantId, kind: input.kind, subject: input.subject, notes: input.notes ?? null, dueAt: input.dueAt ? new Date(input.dueAt) : null, doneAt: done ? new Date() : null, outcome: input.outcome ?? null, leadId: input.leadId ?? null, opportunityId: input.opportunityId ?? null, partyId, ownerId: input.ownerId ?? auth.userId, createdBy: auth.userId })
        .returning();
      if (input.leadId) {
        // Talking to a new lead moves it to contacted.
        if (done && ['call', 'meeting', 'email', 'whatsapp'].includes(input.kind)) await tx.update(crmLeads).set({ status: 'contacted', updatedAt: new Date() }).where(and(eq(crmLeads.id, input.leadId), eq(crmLeads.status, 'new')));
        await this.rescore(tx, input.leadId);
      }
      return a;
    });
  }

  completeActivity(auth: AuthContext, id: string, outcome: string | null) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(crmActivities).where(eq(crmActivities.id, id)).for('update');
      if (!a) throw new NotFoundException('Activity not found');
      if (a.doneAt) throw new ConflictException('Already done');
      await tx.update(crmActivities).set({ doneAt: new Date(), outcome }).where(eq(crmActivities.id, id));
      if (a.leadId) {
        if (['call', 'meeting', 'email', 'whatsapp'].includes(a.kind)) await tx.update(crmLeads).set({ status: 'contacted', updatedAt: new Date() }).where(and(eq(crmLeads.id, a.leadId), eq(crmLeads.status, 'new')));
        await this.rescore(tx, a.leadId);
      }
      return { ok: true };
    });
  }

  /** Leads due for follow-up today or earlier. */
  followUps(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({ id: crmLeads.id, number: crmLeads.number, name: crmLeads.name, company: crmLeads.company, nextFollowUp: crmLeads.nextFollowUp, score: crmLeads.score })
        .from(crmLeads)
        .where(and(sql`${crmLeads.status} in ('new', 'contacted', 'qualified')`, sql`${crmLeads.nextFollowUp} <= ${todayIST()}`, eq(crmLeads.ownerId, auth.userId)))
        .orderBy(asc(crmLeads.nextFollowUp), desc(crmLeads.score)),
    );
  }
}
