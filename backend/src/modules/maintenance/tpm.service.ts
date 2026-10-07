import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { amChecklists, amChecks, amcContracts, amcVisits, fiveSAudits, kaizens, maintAssets, parties, type Transaction } from '@nextgen/database';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const score = z.number().int().min(1).max(5);
const money = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || String(v).trim() === '' ? '0' : String(v).trim()))
  .refine((v) => /^\d{1,14}(\.\d{1,2})?$/.test(v), 'An amount');

export const amcSchema = z.object({
  vendorId: z.uuid(),
  title: z.string().trim().min(3).max(160),
  assetIds: z.array(z.uuid()).max(200).default([]),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  value: money,
  visitsPerYear: z.number().int().min(0).max(52).nullable().optional(),
  responseHours: z.number().int().min(1).max(720).nullable().optional(),
  coverage: optionalText(2000),
});
export const visitSchema = z.object({
  kind: z.enum(['preventive', 'breakdown']),
  orderId: z.uuid().nullable().optional(),
  calledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  attendedAt: z.iso.datetime({ offset: true }),
  engineer: optionalText(120),
  notes: optionalText(2000),
});
export const checklistSchema = z.object({ assetId: z.uuid(), title: z.string().trim().min(3).max(160), frequency: z.enum(['daily', 'weekly', 'monthly']).default('daily'), items: z.array(z.string().trim().min(1).max(300)).min(1).max(50), isActive: z.boolean().default(true) });
export const checkSchema = z.object({ doneOn: z.iso.date().optional(), doneBy: z.string().trim().min(2).max(120), results: z.array(z.object({ ok: z.boolean(), note: optionalText(300) })).min(1).max(50) });
export const kaizenSchema = z.object({
  title: z.string().trim().min(3).max(160),
  area: z.string().trim().min(2).max(120),
  category: z.enum(['quality', 'cost', 'delivery', 'safety', 'morale', 'environment']).default('cost'),
  before: z.string().trim().min(3).max(2000),
  after: z.string().trim().min(3).max(2000),
  benefit: optionalText(1000),
  annualSavings: money,
  submittedBy: z.string().trim().min(2).max(120),
  implementedOn: z.iso.date().nullable().optional(),
});
export const fiveSSchema = z.object({ area: z.string().trim().min(2).max(120), auditDate: z.iso.date().optional(), auditor: z.string().trim().min(2).max(120), sort: score, setInOrder: score, shine: score, standardise: score, sustain: score, notes: optionalText(2000) });

/** AMC contracts and visits (with SLA), and TPM: autonomous-maintenance checklists, kaizen, 5S audits. */
@Injectable()
export class TpmService {
  constructor(private readonly database: DatabaseService) {}

  // ---- AMC --------------------------------------------------------------------------------
  amcs(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.title, c.vendor_id as "vendorId", p.name as vendor, c.asset_ids as "assetIds", c.start_date::text as "startDate", c.end_date::text as "endDate", c.value::text,
                   c.visits_per_year as "visitsPerYear", c.response_hours as "responseHours", c.coverage,
                   case when c.end_date < (now() at time zone 'Asia/Kolkata')::date then 'expired' when c.end_date <= (now() at time zone 'Asia/Kolkata')::date + 30 then 'expiring' else 'active' end as state,
                   (select count(*)::int from amc_visits v where v.contract_id = c.id and v.kind = 'preventive') as "preventiveVisits",
                   (select count(*)::int from amc_visits v where v.contract_id = c.id and v.kind = 'breakdown') as "breakdownVisits",
                   (select count(*)::int from amc_visits v where v.contract_id = c.id and v.within_sla = false) as "slaMissed",
                   (select coalesce(json_agg(json_build_object('code', a.code, 'name', a.name)), '[]') from maint_assets a where a.id::text in (select jsonb_array_elements_text(c.asset_ids))) as assets
            from amc_contracts c join parties p on p.id = c.vendor_id order by c.end_date desc`,
      ),
    );
  }

  saveAmc(auth: AuthContext, id: string | null, input: z.infer<typeof amcSchema>) {
    if (input.endDate <= input.startDate) throw new BadRequestException('The contract must end after it starts');
    return this.database.run(auth, async (tx) => {
      const [v] = await tx.select({ isVendor: parties.isVendor }).from(parties).where(eq(parties.id, input.vendorId));
      if (!v?.isVendor) throw new BadRequestException('Choose a vendor');
      if (input.assetIds.length) {
        const found = await tx.select({ id: maintAssets.id }).from(maintAssets).where(inArray(maintAssets.id, input.assetIds));
        if (found.length !== new Set(input.assetIds).size) throw new BadRequestException('Some assets were not found');
      }
      const values = { ...input, visitsPerYear: input.visitsPerYear ?? null, responseHours: input.responseHours ?? null };
      if (id) {
        const [r] = await tx.update(amcContracts).set(values).where(eq(amcContracts.id, id)).returning();
        if (!r) throw new NotFoundException('Contract not found');
        return r;
      }
      return (await tx.insert(amcContracts).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }

  visits(auth: AuthContext, contractId: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select v.id, v.kind, v.called_at as "calledAt", v.attended_at as "attendedAt", v.engineer, v.notes, v.within_sla as "withinSla", v.order_id as "orderId", d.number as "orderNumber",
                   case when v.called_at is not null then round(extract(epoch from (v.attended_at - v.called_at)) / 3600, 1)::text end as "responseHours"
            from amc_visits v left join documents d on d.id = v.order_id where v.contract_id = ${contractId} order by v.attended_at desc`,
      ),
    );
  }

  /** Logs a service visit; a breakdown visit is checked against the response time promised. */
  addVisit(auth: AuthContext, contractId: string, input: z.infer<typeof visitSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(amcContracts).where(eq(amcContracts.id, contractId));
      if (!c) throw new NotFoundException('Contract not found');
      const attended = new Date(input.attendedAt);
      const day = new Date(attended.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      if (day < c.startDate || day > c.endDate) throw new ConflictException('The visit is outside the contract period');
      if (input.kind === 'breakdown' && !input.calledAt) throw new BadRequestException('When was the contractor called?');
      const called = input.calledAt ? new Date(input.calledAt) : null;
      if (called && called > attended) throw new BadRequestException('The visit cannot be before the call');
      const withinSla = input.kind === 'breakdown' && called && c.responseHours ? (attended.getTime() - called.getTime()) / 3_600_000 <= c.responseHours : null;
      const [r] = await tx.insert(amcVisits).values({ tenantId: auth.tenantId, contractId, kind: input.kind, orderId: input.orderId ?? null, calledAt: called, attendedAt: attended, engineer: input.engineer, notes: input.notes, withinSla }).returning();
      return r;
    });
  }

  // ---- autonomous maintenance -------------------------------------------------------------
  checklists(auth: AuthContext, assetId?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.title, c.frequency, c.items, c.is_active as "isActive", a.id as "assetId", a.code as "assetCode", a.name as "assetName",
                   (select max(k.done_on)::text from am_checks k where k.checklist_id = c.id) as "lastDone",
                   (select coalesce(sum(k.abnormalities), 0)::int from am_checks k where k.checklist_id = c.id and k.done_on > (now() at time zone 'Asia/Kolkata')::date - 30) as "abnormalities30d",
                   (case c.frequency when 'daily' then 1 when 'weekly' then 7 else 31 end) as "everyDays"
            from am_checklists c join maint_assets a on a.id = c.asset_id ${assetId ? sql`where c.asset_id = ${assetId}` : sql``}
            order by a.code, c.title`,
      ),
    );
  }

  saveChecklist(auth: AuthContext, id: string | null, input: z.infer<typeof checklistSchema>) {
    return this.database.run(auth, async (tx) => {
      if (id) {
        const [r] = await tx.update(amChecklists).set(input).where(eq(amChecklists.id, id)).returning();
        if (!r) throw new NotFoundException('Checklist not found');
        return r;
      }
      return (await tx.insert(amChecklists).values({ tenantId: auth.tenantId, ...input }).returning())[0];
    });
  }

  /** The operator's check for the day; any point not OK counts as an abnormality (a tag to fix). */
  check(auth: AuthContext, checklistId: string, input: z.infer<typeof checkSchema>) {
    return this.database.run(auth, async (tx) => {
      const [c] = await tx.select().from(amChecklists).where(eq(amChecklists.id, checklistId));
      if (!c) throw new NotFoundException('Checklist not found');
      if (input.results.length !== c.items.length) throw new BadRequestException('Answer every point');
      const abnormalities = input.results.filter((r) => !r.ok).length;
      try {
        const [r] = await tx.insert(amChecks).values({ tenantId: auth.tenantId, checklistId, doneOn: input.doneOn ?? todayIST(), doneBy: input.doneBy, results: input.results.map((r) => ({ ok: r.ok, note: r.note ?? null })), abnormalities }).returning();
        return r;
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException('This checklist is already done for that day');
        throw e;
      }
    });
  }

  // ---- kaizen and 5S ----------------------------------------------------------------------
  kaizens(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await many(tx, sql`select id, title, area, category, before, after, benefit, annual_savings::text as "annualSavings", submitted_by as "submittedBy", implemented_on::text as "implementedOn", created_at as "createdAt" from kaizens order by created_at desc limit 500`);
      const [t] = await many(tx, sql`select count(*)::int as count, count(*) filter (where implemented_on is not null)::int as implemented, coalesce(sum(annual_savings) filter (where implemented_on is not null), 0)::text as savings from kaizens where created_at >= date_trunc('year', now())`);
      return { items: rows, year: t };
    });
  }

  addKaizen(auth: AuthContext, input: z.infer<typeof kaizenSchema>) {
    return this.database.run(auth, async (tx) => (await tx.insert(kaizens).values({ tenantId: auth.tenantId, ...input, implementedOn: input.implementedOn ?? null }).returning())[0]);
  }

  fiveS(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select id, area, audit_date::text as "auditDate", auditor, sort, set_in_order as "setInOrder", shine, standardise, sustain, total, notes,
                   total - lag(total) over (partition by area order by audit_date) as change
            from five_s_audits order by audit_date desc, area limit 500`,
      ),
    );
  }

  addFiveS(auth: AuthContext, input: z.infer<typeof fiveSSchema>) {
    const total = input.sort + input.setInOrder + input.shine + input.standardise + input.sustain;
    return this.database.run(auth, async (tx) => (await tx.insert(fiveSAudits).values({ tenantId: auth.tenantId, ...input, auditDate: input.auditDate ?? todayIST(), total }).returning())[0]);
  }
}
