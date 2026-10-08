import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { emissionEntries, emissionFactors, eprCertificates, esgMetrics, partDeclarations, type Transaction } from '@nextgen/database';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { fiscalYearOf, todayIST } from '../../common/fiscal-year';
import { DatabaseService } from '../../database/database.service';
import { DEFAULT_FACTORS, energyGj, eprStatus, footprint, ltifr, perCrore, rollUpCompliance, type Activity, type PartDecl } from './esg-rules';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const text = (n: number) => z.string().trim().max(n).nullable().optional();
const fy = z.string().regex(/^\d{4}-\d{2}$/, 'Financial year as 2026-27');
const EPR = ['plastic_packaging', 'e_waste', 'battery', 'tyre', 'used_oil'] as const;

export const METRICS: Record<string, string> = {
  water_withdrawal_kl: 'Water withdrawal (kl)',
  water_consumption_kl: 'Water consumption (kl)',
  water_discharge_kl: 'Water discharged (kl)',
  renewable_kwh: 'Renewable electricity used (kWh)',
  plastic_waste_t: 'Plastic waste generated (t)',
  e_waste_t: 'E-waste generated (t)',
  other_waste_t: 'Other non-hazardous waste (t)',
  waste_recycled_t: 'Waste recycled or reused (t)',
  person_hours: 'Person-hours worked',
  csr_spend_inr: 'CSR spend (₹)',
  training_hours: 'Training hours',
  complaints_received: 'Stakeholder complaints received',
};

export const factorSchema = z.object({ key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/), name: z.string().trim().min(2).max(120), scope: z.union([z.literal(1), z.literal(2), z.literal(3)]), category: z.string().trim().min(2).max(60), unit: z.string().trim().min(1).max(20), kgCo2ePerUnit: z.number().min(0), source: text(300) });
export const entrySchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, 'Month as 2026-04'), factorKey: z.string().min(2).max(40), quantity: z.number().min(0), site: text(80), note: text(300) });
export const syncSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/, 'Month as 2026-04') });
export const metricSchema = z.object({ fiscalYear: fy, values: z.partialRecord(z.enum(Object.keys(METRICS) as [string, ...string[]]), z.number().min(0).nullable()) });
export const eprCertSchema = z.object({ category: z.enum(EPR), fiscalYear: fy, subCategory: text(40), kind: z.enum(['recycling', 'end_of_life', 'reuse', 'refurbishment']).default('recycling'), number: z.string().trim().min(1).max(60), issuerId: z.uuid().nullable().optional(), issuerName: text(160), qtyKg: z.number().positive(), issuedOn: z.iso.date(), amount: z.number().min(0).nullable().optional() });
export const declarationSchema = z.object({
  itemId: z.uuid(),
  supplierId: z.uuid().nullable().optional(),
  rohs: z.enum(['compliant', 'exempt', 'non_compliant', 'unknown']),
  rohsExemptions: z.array(z.string().trim().max(20)).max(20).default([]),
  svhc: z.array(z.object({ substance: z.string().trim().min(2).max(200), cas: z.string().trim().regex(/^\d{2,7}-\d{2}-\d$/, 'CAS number like 117-81-7'), pct: z.number().min(0).max(100) })).max(50).default([]),
  reachCandidateListVersion: text(40),
  uses3tg: z.boolean().default(false),
  smelters: z.array(z.object({ metal: z.enum(['tin', 'tantalum', 'tungsten', 'gold']), name: z.string().trim().min(2).max(160), smelterId: text(20), country: text(60), conformant: z.boolean() })).max(200).default([]),
  cmrtVersion: text(20),
  bisRequired: z.boolean().default(false),
  declaredOn: z.iso.date().nullable().optional(),
  validUntil: z.iso.date().nullable().optional(),
  documentUrl: text(1000),
});

const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start: `${period}-01`, end };
};

/**
 * Sustainability and materials compliance: emission factors and monthly activities (some pulled from
 * energy meters, transport trips and purchase spend), the Scope 1 / 2 / 3 footprint, a BRSR-lite
 * report, EPR certificates against obligations, and RoHS / REACH / conflict-minerals declarations
 * rolled up through bills of materials, with BIS registration checks.
 */
@Injectable()
export class EsgService {
  constructor(private readonly database: DatabaseService) {}

  // ---- emission factors and activities -----------------------------------------------------------

  private async ensureFactors(tx: Transaction, tenantId: string) {
    await tx
      .insert(emissionFactors)
      .values(DEFAULT_FACTORS.map((f) => ({ tenantId, key: f.key, name: f.name, scope: f.scope, category: f.category, unit: f.unit, kgCo2ePerUnit: f.kgCo2ePerUnit, source: f.source })))
      .onConflictDoNothing();
  }

  factors(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      await this.ensureFactors(tx, auth.tenantId);
      return tx.select().from(emissionFactors).orderBy(emissionFactors.scope, emissionFactors.key);
    });
  }

  saveFactor(auth: AuthContext, input: z.infer<typeof factorSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(emissionFactors)
        .values({ tenantId: auth.tenantId, ...input })
        .onConflictDoUpdate({ target: [emissionFactors.tenantId, emissionFactors.key], set: { name: input.name, scope: input.scope, category: input.category, unit: input.unit, kgCo2ePerUnit: input.kgCo2ePerUnit, source: input.source ?? null } })
        .returning();
      return r;
    });
  }

  private activities(tx: Transaction, from: string, to: string) {
    return many<Activity & { id: string; source: string; site: string | null; note: string | null; unit: string }>(
      tx,
      sql`select e.id, to_char(e.period, 'YYYY-MM') as period, f.key, f.name, f.scope, f.category, f.unit, e.quantity, f.kg_co2e_per_unit as "kgCo2ePerUnit", e.source, e.site, e.note
          from emission_entries e join emission_factors f on f.id = e.factor_id
          where e.period >= ${from}::date and e.period <= ${to}::date order by e.period, f.scope, f.key`,
    );
  }

  entries(auth: AuthContext, fiscalYear: string) {
    const y = Number(fiscalYear.slice(0, 4));
    return this.database.run(auth, (tx) => this.activities(tx, `${y}-04-01`, `${y + 1}-03-31`));
  }

  addEntry(auth: AuthContext, input: z.infer<typeof entrySchema>) {
    return this.database.run(auth, async (tx) => {
      await this.ensureFactors(tx, auth.tenantId);
      const [f] = await tx.select({ id: emissionFactors.id }).from(emissionFactors).where(eq(emissionFactors.key, input.factorKey));
      if (!f) throw new NotFoundException('Unknown emission factor');
      const [r] = await tx
        .insert(emissionEntries)
        .values({ tenantId: auth.tenantId, period: `${input.period}-01`, factorId: f.id, quantity: input.quantity, site: input.site ?? null, note: input.note ?? null, createdBy: auth.userId })
        .returning();
      return r;
    });
  }

  deleteEntry(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [e] = await tx.select({ source: emissionEntries.source }).from(emissionEntries).where(eq(emissionEntries.id, id));
      if (!e) throw new NotFoundException('Entry not found');
      if (e.source !== 'manual') throw new ConflictException('Entries pulled from other modules are replaced by the next sync');
      await tx.delete(emissionEntries).where(eq(emissionEntries.id, id));
      return { ok: true };
    });
  }

  /** Pull a month's activities from energy meters (Scope 2), completed trips (Scope 3 freight) and purchase spend (Scope 3 goods). */
  sync(auth: AuthContext, period: string) {
    return this.database.run(auth, async (tx) => {
      await this.ensureFactors(tx, auth.tenantId);
      const { start, end } = monthRange(period);
      const [{ kwh }] = await many<{ kwh: number }>(tx, sql`select coalesce(sum(kwh), 0)::float8 as kwh from energy_minutes where minute >= ${start}::date and minute < ${end}::date`);
      const [{ tkm }] = await many<{ tkm: number }>(
        tx,
        sql`select coalesce(sum(weight_kg / 1000.0 * coalesce(nullif(odometer_end - odometer_start, 0), planned_km, 0)), 0)::float8 as tkm
            from tms_trips where status = 'completed' and trip_date >= ${start} and trip_date < ${end}`,
      );
      const [{ spend }] = await many<{ spend: number }>(
        tx,
        sql`select coalesce(sum(pi.taxable_total), 0)::float8 as spend from purchase_invoices pi join documents d on d.id = pi.id
            where d.status not in ('draft', 'cancelled') and d.doc_date >= ${start}::date and d.doc_date < ${end}::date`,
      );
      const pulled: [string, string, number][] = [
        ['grid_kwh', 'energy_meters', kwh],
        ['road_freight_tkm', 'tms_trips', tkm],
        ['purchased_goods_inr', 'purchase_spend', spend],
      ];
      await tx.execute(sql`delete from emission_entries where period = ${start}::date and source in ('energy_meters', 'tms_trips', 'purchase_spend')`);
      const factors = await tx.select({ id: emissionFactors.id, key: emissionFactors.key }).from(emissionFactors);
      for (const [key, source, q] of pulled) {
        const f = factors.find((x) => x.key === key);
        if (f && q > 0) await tx.insert(emissionEntries).values({ tenantId: auth.tenantId, period: start, factorId: f.id, quantity: Math.round(q * 1000) / 1000, source, createdBy: auth.userId });
      }
      return { period, electricityKwh: kwh, freightTkm: Math.round(tkm * 1000) / 1000, purchaseSpend: spend };
    });
  }

  private async turnover(tx: Transaction, from: string, to: string) {
    const [{ v }] = await many<{ v: number }>(
      tx,
      sql`select coalesce(sum(si.taxable_total), 0)::float8 as v from sales_invoices si join documents d on d.id = si.id
          where d.status not in ('draft', 'cancelled') and d.doc_date between ${from}::date and ${to}::date`,
    );
    return v;
  }

  footprint(auth: AuthContext, fiscalYear: string) {
    const y = Number(fiscalYear.slice(0, 4));
    const from = `${y}-04-01`;
    const to = `${y + 1}-03-31`;
    return this.database.run(auth, async (tx) => {
      const rows = await this.activities(tx, from, to);
      const fp = footprint(rows);
      const revenue = await this.turnover(tx, from, to);
      return { fiscalYear, ...fp, energy: energyGj(rows), turnover: revenue, intensityPerCrore: perCrore(fp.scope1 + fp.scope2, revenue) };
    });
  }

  // ---- BRSR-lite ---------------------------------------------------------------------------------

  metrics(auth: AuthContext, fiscalYear: string) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select().from(esgMetrics).where(eq(esgMetrics.fiscalYear, fiscalYear));
      return { labels: METRICS, values: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    });
  }

  saveMetrics(auth: AuthContext, input: z.infer<typeof metricSchema>) {
    return this.database.run(auth, async (tx) => {
      for (const [key, value] of Object.entries(input.values)) {
        if (value === null || value === undefined) await tx.delete(esgMetrics).where(and(eq(esgMetrics.fiscalYear, input.fiscalYear), eq(esgMetrics.key, key)));
        else
          await tx
            .insert(esgMetrics)
            .values({ tenantId: auth.tenantId, fiscalYear: input.fiscalYear, key, value })
            .onConflictDoUpdate({ target: [esgMetrics.tenantId, esgMetrics.fiscalYear, esgMetrics.key], set: { value, updatedAt: new Date() } });
      }
      return { ok: true };
    });
  }

  /** The BRSR-lite indicators for a year (SEBI BRSR Core, essential indicators that a manufacturer can fill from its records). */
  brsr(auth: AuthContext, fiscalYear: string) {
    const y = Number(fiscalYear.slice(0, 4));
    const from = `${y}-04-01`;
    const to = `${y + 1}-03-31`;
    return this.database.run(auth, async (tx) => {
      const rows = await this.activities(tx, from, to);
      const fp = footprint(rows);
      const energy = energyGj(rows);
      const revenue = await this.turnover(tx, from, to);
      const m = Object.fromEntries((await tx.select().from(esgMetrics).where(eq(esgMetrics.fiscalYear, fiscalYear))).map((r) => [r.key, r.value]));
      const [company] = await many<{ name: string; gstin: string | null; pan: string | null }>(tx, sql`select coalesce(legal_name, name) as name, gstin, pan from companies where deleted_at is null order by created_at limit 1`);
      const people = await many<{ gender: string; type: string; n: number }>(
        tx,
        sql`select coalesce(gender, 'unspecified') as gender, case when employment_type = 'permanent' then 'permanent' else 'other' end as type, count(*)::int as n
            from employees where status = 'active' group by 1, 2`,
      );
      const [{ workers }] = await many<{ workers: number }>(tx, sql`select count(*)::int as workers from hr_contract_workers where left_on is null`);
      const [safety] = await many<{ lti: number; fatal: number; recordable: number; lostDays: number }>(
        tx,
        sql`select count(*) filter (where kind = 'injury' and lost_days > 0)::int as lti, count(*) filter (where severity = 'fatal')::int as fatal,
                   count(*) filter (where kind = 'injury')::int as recordable, coalesce(sum(lost_days), 0)::int as "lostDays"
            from hse_incidents where occurred_at >= ${from}::date and occurred_at < ${to}::date + 1`,
      );
      const [haz] = await many<{ kg: number }>(
        tx,
        sql`select coalesce(sum(case unit when 't' then qty * 1000 when 'kl' then qty * 1000 else qty end), 0)::float8 as kg
            from hazardous_waste where generated_on between ${from}::date and ${to}::date and unit in ('kg', 't', 'l', 'kl')`,
      );
      const obligations = await many<{ category: string; fiscalYear: string; targetKg: number }>(tx, sql`select category, fiscal_year as "fiscalYear", target_kg::float8 as "targetKg" from epr_obligations where fiscal_year = ${fiscalYear}`);
      const certs = await many<{ category: string; fiscalYear: string; qtyKg: number; kind: string }>(tx, sql`select category, fiscal_year as "fiscalYear", qty_kg as "qtyKg", kind from epr_certificates where fiscal_year = ${fiscalYear}`);
      const employees = people.reduce((a, p) => a + p.n, 0);
      const personHours = m.person_hours ?? null;
      const estimatedHours = personHours ?? (employees + workers) * 8 * 26 * 12;
      const renewable = m.renewable_kwh ?? 0;
      const gridKwh = rows.filter((r) => r.key === 'grid_kwh').reduce((a, r) => a + r.quantity, 0);
      return {
        fiscalYear,
        company: company ?? null,
        turnover: revenue,
        sections: {
          employees: {
            byGender: people.reduce<Record<string, number>>((a, p) => ({ ...a, [p.gender]: (a[p.gender] ?? 0) + p.n }), {}),
            permanent: people.filter((p) => p.type === 'permanent').reduce((a, p) => a + p.n, 0),
            otherThanPermanent: people.filter((p) => p.type === 'other').reduce((a, p) => a + p.n, 0),
            contractWorkers: workers,
            femalePct: employees ? Math.round((people.filter((p) => p.gender === 'female').reduce((a, p) => a + p.n, 0) * 1000) / employees) / 10 : null,
          },
          energy: { ...energy, renewablePct: gridKwh + renewable > 0 ? Math.round((renewable * 1000) / (gridKwh + renewable)) / 10 : null, intensityGjPerCrore: perCrore(energy.totalGj, revenue) },
          emissions: { scope1: fp.scope1, scope2: fp.scope2, scope3: fp.scope3, intensityPerCrore: perCrore(fp.scope1 + fp.scope2, revenue) },
          water: { withdrawalKl: m.water_withdrawal_kl ?? null, consumptionKl: m.water_consumption_kl ?? null, dischargeKl: m.water_discharge_kl ?? null, intensityKlPerCrore: m.water_consumption_kl != null ? perCrore(m.water_consumption_kl, revenue) : null },
          waste: { hazardousT: Math.round(haz.kg) / 1000, plasticT: m.plastic_waste_t ?? null, eWasteT: m.e_waste_t ?? null, otherT: m.other_waste_t ?? null, recycledT: m.waste_recycled_t ?? null },
          safety: { ...safety, personHours: estimatedHours, personHoursEstimated: personHours === null, ltifr: ltifr(safety.lti, estimatedHours) },
          epr: eprStatus(obligations, certs),
          social: { csrSpend: m.csr_spend_inr ?? null, trainingHours: m.training_hours ?? null, complaints: m.complaints_received ?? null },
        },
      };
    });
  }

  // ---- EPR certificates --------------------------------------------------------------------------

  epr(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const obligations = await many<{ category: string; fiscalYear: string; targetKg: number }>(tx, sql`select category, fiscal_year as "fiscalYear", target_kg::float8 as "targetKg" from epr_obligations`);
      const certificates = await many<{ id: string; category: string; fiscalYear: string; subCategory: string | null; kind: string; number: string; issuer: string | null; qtyKg: number; issuedOn: string; amount: number | null }>(
        tx,
        sql`select c.id, c.category, c.fiscal_year as "fiscalYear", c.sub_category as "subCategory", c.kind, c.number, coalesce(p.name, c.issuer_name) as issuer, c.qty_kg as "qtyKg", c.issued_on::text as "issuedOn", c.amount
            from epr_certificates c left join parties p on p.id = c.issuer_id order by c.issued_on desc`,
      );
      return { status: eprStatus(obligations, certificates), certificates };
    });
  }

  /** Add a certificate; the obligation's achieved quantity becomes the certificates' total. */
  addEprCertificate(auth: AuthContext, input: z.infer<typeof eprCertSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: eprCertificates.id }).from(eprCertificates).where(and(eq(eprCertificates.category, input.category), eq(eprCertificates.number, input.number)));
      if (dup) throw new ConflictException('This certificate is already recorded');
      const [r] = await tx
        .insert(eprCertificates)
        .values({ tenantId: auth.tenantId, ...input })
        .returning();
      await tx.execute(
        sql`update epr_obligations o set achieved_kg = (select coalesce(sum(qty_kg), 0) from epr_certificates c where c.category = o.category and c.fiscal_year = o.fiscal_year)
            where o.category = ${input.category} and o.fiscal_year = ${input.fiscalYear}`,
      );
      return r;
    });
  }

  // ---- materials compliance ----------------------------------------------------------------------

  private async complianceData(tx: Transaction) {
    const decls = await tx.select().from(partDeclarations);
    const edges = await many<{ parent: string; child: string }>(
      tx,
      sql`select distinct b.item_id as parent, l.item_id as child from boms b join documents d on d.id = b.id join bom_lines l on l.bom_id = b.id
          where d.status = 'approved' and l.kind = 'component'`,
    );
    const children = new Map<string, string[]>();
    for (const e of edges) children.set(e.parent, [...(children.get(e.parent) ?? []), e.child]);
    const ids = [...new Set([...decls.map((d) => d.itemId), ...edges.flatMap((e) => [e.parent, e.child])])];
    const items = ids.length ? await many<{ id: string; code: string; name: string }>(tx, sql`select id, code, name from items where id in ${ids}`) : [];
    const names = new Map(items.map((i) => [i.id, `${i.code} · ${i.name}`]));
    const decl = new Map<string, PartDecl>(decls.map((d) => [d.itemId, d]));
    return { decls, children, names, items, decl, parents: new Set(edges.map((e) => e.parent)) };
  }

  /** Every declared part and every product with a BOM, with its rolled-up status and BIS check. */
  materials(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const d = await this.complianceData(tx);
      const bis = await many<{ subjectId: string; validUntil: string | null; number: string }>(tx, sql`select subject_id as "subjectId", valid_until::text as "validUntil", number from compliance_certificates where type = 'bis' and subject_type = 'item'`);
      const today = todayIST();
      const out = d.items.map((i) => {
        const own = d.decls.find((x) => x.itemId === i.id) ?? null;
        const r = rollUpCompliance(i.id, d.decl, d.children, d.names);
        const reg = bis.find((b) => b.subjectId === i.id && (!b.validUntil || b.validUntil >= today));
        return {
          itemId: i.id,
          code: i.code,
          name: i.name,
          isAssembly: d.parents.has(i.id),
          declaration: own,
          ...r,
          declarationExpired: !!own?.validUntil && own.validUntil < today,
          bisRequired: own?.bisRequired ?? false,
          bisRegistration: reg?.number ?? null,
          bisMissing: (own?.bisRequired ?? false) && !reg,
        };
      });
      return out.sort((a, b) => Number(b.isAssembly) - Number(a.isAssembly) || a.code.localeCompare(b.code));
    });
  }

  saveDeclaration(auth: AuthContext, input: z.infer<typeof declarationSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { ...input, supplierId: input.supplierId ?? null, smelters: input.smelters.map((s) => ({ ...s, smelterId: s.smelterId ?? null, country: s.country ?? null })), updatedAt: new Date() };
      const [r] = await tx
        .insert(partDeclarations)
        .values({ tenantId: auth.tenantId, ...values })
        .onConflictDoUpdate({ target: [partDeclarations.tenantId, partDeclarations.itemId], set: values })
        .returning();
      return r;
    });
  }

  currentFiscalYear() {
    return fiscalYearOf(todayIST()).label4;
  }
}
