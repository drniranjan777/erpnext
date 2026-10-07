import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eprObligations, hazardousWaste, hseIncidents, licences, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const amount = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .refine((v) => /^\d{1,12}(\.\d{1,3})?$/.test(v), `${label}: a number`);

export const incidentSchema = z.object({
  occurredAt: z.iso.datetime({ offset: true }),
  kind: z.enum(['injury', 'near_miss', 'property_damage', 'environmental', 'fire', 'other']),
  severity: z.enum(['minor', 'major', 'serious', 'fatal']).default('minor'),
  location: z.string().trim().min(2).max(120),
  description: z.string().trim().min(3).max(4000),
  personInvolved: optionalText(120),
  lostDays: z.number().int().min(0).max(3650).default(0),
  immediateAction: optionalText(2000),
  rootCause: optionalText(2000),
});
export const wasteSchema = z.object({
  category: z.string().trim().min(2).max(120),
  description: optionalText(500),
  qty: amount('Quantity').refine((v) => Number(v) > 0, 'Quantity must be more than zero'),
  unit: z.enum(['kg', 't', 'l', 'kl', 'nos']).default('kg'),
  generatedOn: z.iso.date(),
  storedAt: optionalText(120),
});
export const disposeWasteSchema = z.object({ disposedOn: z.iso.date(), disposalAgency: z.string().trim().min(2).max(160), manifestNo: optionalText(60) });
export const eprSchema = z.object({
  category: z.enum(['plastic_packaging', 'e_waste', 'battery', 'tyre', 'used_oil']),
  fiscalYear: z.string().regex(/^\d{4}-\d{2}$/, 'Financial year as 2026-27'),
  targetKg: amount('Target'),
  achievedKg: amount('Achieved').default('0'),
  certificates: optionalText(2000),
  notes: optionalText(1000),
});
export const licenceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(['factory', 'pollution_cte', 'pollution_cto', 'fire_noc', 'peso', 'fssai', 'drug', 'boiler', 'trade', 'other']),
  authority: z.string().trim().min(2).max(160),
  number: optionalText(80),
  issuedOn: z.iso.date().nullable().optional(),
  validUntil: z.iso.date().nullable().optional(),
  renewalLeadDays: z.number().int().min(0).max(365).default(60),
  owner: optionalText(120),
  notes: optionalText(1000),
});

/** HSE registers: incidents, hazardous waste (generation and disposal), EPR targets, licences and permits. */
@Injectable()
export class HseService {
  constructor(private readonly database: DatabaseService) {}

  // ---- incidents --------------------------------------------------------------------------
  incidents(auth: AuthContext, q: { status?: string }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select i.id, i.occurred_at as "occurredAt", i.kind, i.severity, i.location, i.description, i.person_involved as "personInvolved", i.lost_days as "lostDays",
                   i.immediate_action as "immediateAction", i.root_cause as "rootCause", i.status, i.closed_at as "closedAt", i.capa_id as "capaId", d.number as "capaNumber"
            from hse_incidents i left join documents d on d.id = i.capa_id
            ${q.status ? sql`where i.status = ${q.status}` : sql``} order by i.occurred_at desc limit 500`,
      ),
    );
  }

  addIncident(auth: AuthContext, input: z.infer<typeof incidentSchema>) {
    if (new Date(input.occurredAt).getTime() > Date.now() + 60_000) throw new BadRequestException('The incident cannot be in the future');
    return this.database.run(auth, async (tx) => (await tx.insert(hseIncidents).values({ tenantId: auth.tenantId, ...input, occurredAt: new Date(input.occurredAt), reportedBy: auth.userId }).returning())[0]);
  }

  closeIncident(auth: AuthContext, id: string, rootCause: string) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx.update(hseIncidents).set({ status: 'closed', closedAt: new Date(), rootCause }).where(and(eq(hseIncidents.id, id), eq(hseIncidents.status, 'open'))).returning();
      if (!r) throw new ConflictException('Incident not found or already closed');
      return r;
    });
  }

  /** Counts for the year: by kind, lost days, days since the last lost-time injury. */
  stats(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [r] = await many(
        tx,
        sql`select count(*)::int as incidents,
                   count(*) filter (where kind = 'injury')::int as injuries,
                   count(*) filter (where kind = 'near_miss')::int as "nearMisses",
                   coalesce(sum(lost_days), 0)::int as "lostDays",
                   count(*) filter (where status = 'open')::int as open,
                   ((now() at time zone 'Asia/Kolkata')::date - (select max((occurred_at at time zone 'Asia/Kolkata')::date) from hse_incidents where kind = 'injury' and lost_days > 0))::int as "daysSinceLostTime"
            from hse_incidents where occurred_at >= date_trunc('year', now())`,
      );
      return r;
    });
  }

  // ---- hazardous waste --------------------------------------------------------------------
  waste(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await many(
        tx,
        sql`select id, category, description, qty::text, unit, generated_on::text as "generatedOn", stored_at as "storedAt", disposed_on::text as "disposedOn", disposal_agency as "disposalAgency", manifest_no as "manifestNo",
                   (disposed_on is null and generated_on < (now() at time zone 'Asia/Kolkata')::date - 90) as "storedTooLong"
            from hazardous_waste order by disposed_on nulls first, generated_on desc`,
      );
      // Stock in store per category (what is generated less what is disposed of).
      const stored = await many(tx, sql`select category, unit, sum(qty)::text as qty from hazardous_waste where disposed_on is null group by 1, 2 order by 1`);
      return { entries: rows, stored };
    });
  }

  addWaste(auth: AuthContext, input: z.infer<typeof wasteSchema>) {
    return this.database.run(auth, async (tx) => (await tx.insert(hazardousWaste).values({ tenantId: auth.tenantId, ...input }).returning())[0]);
  }

  disposeWaste(auth: AuthContext, id: string, input: z.infer<typeof disposeWasteSchema>) {
    return this.database.run(auth, async (tx) => {
      const [w] = await tx.select().from(hazardousWaste).where(eq(hazardousWaste.id, id));
      if (!w) throw new NotFoundException('Entry not found');
      if (w.disposedOn) throw new ConflictException('Already disposed of');
      if (input.disposedOn < w.generatedOn) throw new BadRequestException('Disposed of before it was generated');
      const [r] = await tx.update(hazardousWaste).set(input).where(eq(hazardousWaste.id, id)).returning();
      return r;
    });
  }

  // ---- EPR --------------------------------------------------------------------------------
  epr(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select id, category, fiscal_year as "fiscalYear", target_kg::text as "targetKg", achieved_kg::text as "achievedKg", certificates, notes,
                   case when target_kg > 0 then round(achieved_kg * 100 / target_kg, 1)::text end as "pct"
            from epr_obligations order by fiscal_year desc, category`,
      ),
    );
  }

  saveEpr(auth: AuthContext, input: z.infer<typeof eprSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(eprObligations)
        .values({ tenantId: auth.tenantId, ...input })
        .onConflictDoUpdate({ target: [eprObligations.tenantId, eprObligations.category, eprObligations.fiscalYear], set: { targetKg: input.targetKg, achievedKg: input.achievedKg, certificates: input.certificates, notes: input.notes } })
        .returning();
      return r;
    });
  }

  // ---- licences ---------------------------------------------------------------------------
  licences(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select id, name, kind, authority, number, issued_on::text as "issuedOn", valid_until::text as "validUntil", renewal_lead_days as "renewalLeadDays", owner, notes,
                   case when valid_until is null then 'no_expiry'
                        when valid_until < (now() at time zone 'Asia/Kolkata')::date then 'expired'
                        when valid_until - renewal_lead_days <= (now() at time zone 'Asia/Kolkata')::date then 'renew_now' else 'valid' end as state,
                   (valid_until - (now() at time zone 'Asia/Kolkata')::date)::int as "daysLeft"
            from licences order by valid_until nulls last, name`,
      ),
    );
  }

  saveLicence(auth: AuthContext, id: string | null, input: z.infer<typeof licenceSchema>) {
    if (input.issuedOn && input.validUntil && input.validUntil <= input.issuedOn) throw new BadRequestException('Valid until must be after the issue date');
    return this.database.run(auth, async (tx) => {
      const values = { ...input, issuedOn: input.issuedOn ?? null, validUntil: input.validUntil ?? null };
      if (id) {
        const [r] = await tx.update(licences).set(values).where(eq(licences.id, id)).returning();
        if (!r) throw new NotFoundException('Licence not found');
        return r;
      }
      return (await tx.insert(licences).values({ tenantId: auth.tenantId, ...values }).returning())[0];
    });
  }
}
