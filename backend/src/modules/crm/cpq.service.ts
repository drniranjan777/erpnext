import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { cpqEstimates, cpqOptionGroups, cpqQuoteTemplates, crmOpportunities, items, parties, type Transaction } from '@nextgen/database';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { QuotationsService } from '../sales/quotations.service';
import { addDays } from '../hr/time/attendance-engine';
import { configure, corrugatedBox, fabrication, FLUTES, furniture, type Estimate } from './estimate';

const num = (min = 0, max = 1e9) => z.number().min(min).max(max);
const margin = num(0, 95);
const qty = z.number().positive().max(1e9);

export const boxSchema = z.object({
  length: num(10, 5000), width: num(10, 5000), height: num(10, 5000),
  ply: z.union([z.literal(3), z.literal(5), z.literal(7)]),
  linerGsm: z.array(num(60, 600)).min(2).max(4), fluteGsm: z.array(num(60, 400)).min(1).max(3), flutes: z.array(z.enum(Object.keys(FLUTES) as [keyof typeof FLUTES])).min(1).max(3),
  paperRate: num(0, 1000), conversionRate: num(0, 1000), printColours: z.number().int().min(0).max(8).default(0), printRatePerColour: num(0, 100).default(0),
  wastagePct: num(0, 50).default(5), marginPct: margin, qty,
});
export const fabSchema = z.object({
  parts: z.array(z.object({ name: z.string().trim().min(1).max(80), material: z.enum(['ms', 'ss', 'al', 'gi']), length: num(0, 50_000).optional(), width: num(0, 50_000).optional(), thickness: num(0, 500).optional(), weightKg: num(0, 1e6).optional(), count: z.number().int().min(1).max(10_000) })).min(1).max(100),
  rates: z.object({ ms: num(0, 10_000).optional(), ss: num(0, 10_000).optional(), al: num(0, 10_000).optional(), gi: num(0, 10_000).optional() }),
  scrapPct: num(0, 50).default(10),
  processes: z.array(z.object({ name: z.string().trim().min(1).max(60), minutes: num(0, 100_000), ratePerHour: num(0, 100_000) })).max(30).default([]),
  finishPerKg: num(0, 10_000).default(0), overheadPct: num(0, 200).default(0), marginPct: margin, qty,
});
export const furnitureSchema = z.object({
  width: num(100, 10_000), height: num(100, 10_000), depth: num(50, 5000), shelves: z.number().int().min(0).max(30), doors: z.number().int().min(0).max(10),
  boardRate: num(0, 100_000), backRate: num(0, 100_000), finishRate: num(0, 100_000), edgeRate: num(0, 10_000), hardware: num(0, 1e7), labourHours: num(0, 10_000), labourRate: num(0, 100_000),
  wastagePct: num(0, 50).default(10), marginPct: margin, qty,
});
const ENGINES = { box: boxSchema, fabrication: fabSchema, furniture: furnitureSchema } as const;
export type EngineKind = keyof typeof ENGINES;

export const estimateSchema = z.object({ kind: z.enum(['box', 'fabrication', 'furniture']), title: z.string().trim().min(2).max(160), partyId: z.uuid().nullable().optional(), opportunityId: z.uuid().nullable().optional(), itemId: z.uuid().nullable().optional(), inputs: z.record(z.string(), z.unknown()) });
export const quoteEstimateSchema = z.object({ itemId: z.uuid().optional(), templateId: z.uuid().optional(), partyId: z.uuid().optional() });
export const optionGroupSchema = z.object({
  code: z.string().trim().min(1).max(10).regex(/^[A-Z0-9_]+$/i).transform((c) => c.toUpperCase()),
  name: z.string().trim().min(2).max(60),
  required: z.boolean().default(false),
  multi: z.boolean().default(false),
  sequence: z.number().int().min(1).max(99).default(1),
  options: z.array(z.object({ code: z.string().trim().min(1).max(10).regex(/^[A-Z0-9_]+$/i).transform((c) => c.toUpperCase()), label: z.string().trim().min(1).max(80), priceDelta: z.number().min(-1e8).max(1e8), excludes: z.array(z.string()).max(20).optional(), requires: z.array(z.string()).max(20).optional() })).min(1).max(40),
});
export const configureSchema = z.object({ itemId: z.uuid(), chosen: z.array(z.string().max(30)).max(40), qty: qty.default(1) });
export const quoteConfiguredSchema = configureSchema.extend({ partyId: z.uuid(), opportunityId: z.uuid().nullable().optional(), templateId: z.uuid().optional() });
export const templateSchema = z.object({ name: z.string().trim().min(2).max(80), terms: z.string().trim().min(5).max(8000), validityDays: z.number().int().min(1).max(365).default(30), isDefault: z.boolean().default(false) });

/**
 * Configure-price-quote: costing engines for made-to-order products, a rules-based configurator
 * on items, quote templates, and turning an estimate or a configuration into a draft quotation.
 */
@Injectable()
export class CpqService {
  constructor(
    private readonly database: DatabaseService,
    private readonly quotations: QuotationsService,
  ) {}

  /** Runs an engine on validated inputs. */
  calculate(kind: EngineKind, raw: unknown): { inputs: Record<string, unknown>; result: Estimate } {
    const parsed = ENGINES[kind].safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ message: parsed.error.issues[0]?.message ?? 'Invalid', errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    try {
      const result = kind === 'box' ? corrugatedBox(parsed.data as z.infer<typeof boxSchema>) : kind === 'fabrication' ? fabrication(parsed.data as z.infer<typeof fabSchema>) : furniture(parsed.data as z.infer<typeof furnitureSchema>);
      return { inputs: parsed.data as Record<string, unknown>, result };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  list(auth: AuthContext, q: { partyId?: string; opportunityId?: string }) {
    return this.database.run(auth, async (tx) =>
      (
        await tx.execute(
          sql`select e.id, e.number, e.kind, e.title, e.qty, e.unit_cost as "unitCost", e.unit_price as "unitPrice", e.margin_pct as "marginPct", e.status, e.quotation_id as "quotationId",
                     e.created_at as "createdAt", p.name as party, e.opportunity_id as "opportunityId"
              from cpq_estimates e left join parties p on p.id = e.party_id
              where true ${q.partyId ? sql`and e.party_id = ${q.partyId}` : sql``} ${q.opportunityId ? sql`and e.opportunity_id = ${q.opportunityId}` : sql``}
              order by e.created_at desc limit 300`,
        )
      ).rows,
    );
  }

  get(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [e] = await tx.select().from(cpqEstimates).where(eq(cpqEstimates.id, id));
      if (!e) throw new NotFoundException('Estimate not found');
      return e;
    });
  }

  create(auth: AuthContext, input: z.infer<typeof estimateSchema>) {
    const { inputs, result } = this.calculate(input.kind, input.inputs);
    return this.database.run(auth, async (tx) => {
      let partyId = input.partyId ?? null;
      if (input.opportunityId) {
        const [o] = await tx.select({ partyId: crmOpportunities.partyId }).from(crmOpportunities).where(eq(crmOpportunities.id, input.opportunityId));
        if (!o) throw new NotFoundException('Opportunity not found');
        partyId ??= o.partyId;
      }
      return this.insert(tx, auth, { kind: input.kind, title: input.title, partyId, opportunityId: input.opportunityId ?? null, itemId: input.itemId ?? null, qty: Number(inputs.qty), inputs, result: result as unknown as Record<string, unknown>, unitCost: result.unitCost, unitPrice: result.unitPrice, marginPct: Number(inputs.marginPct) });
    });
  }

  private async insert(tx: Transaction, auth: AuthContext, v: { kind: string; title: string; partyId: string | null; opportunityId: string | null; itemId: string | null; qty: number; inputs: Record<string, unknown>; result: Record<string, unknown>; unitCost: number; unitPrice: number; marginPct: number }) {
    const number = await nextCode(tx, auth.tenantId, 'cpq_estimate', 'EST', 5);
    const [e] = await tx
      .insert(cpqEstimates)
      .values({ tenantId: auth.tenantId, number, kind: v.kind, title: v.title, partyId: v.partyId, opportunityId: v.opportunityId, itemId: v.itemId, qty: String(v.qty), inputs: v.inputs, result: v.result, unitCost: v.unitCost.toFixed(2), unitPrice: v.unitPrice.toFixed(2), marginPct: v.marginPct.toFixed(2), createdBy: auth.userId })
      .returning();
    return e;
  }

  /** A draft quotation with one line at the estimated price; linked back to the opportunity. */
  quote(auth: AuthContext, id: string, input: z.infer<typeof quoteEstimateSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [e] = await tx.select().from(cpqEstimates).where(eq(cpqEstimates.id, id)).for('update');
      if (!e) throw new NotFoundException('Estimate not found');
      if (e.status === 'quoted') throw new ConflictException('Already quoted');
      const itemId = input.itemId ?? e.itemId;
      const partyId = input.partyId ?? e.partyId;
      if (!itemId) throw new BadRequestException('Choose the item to quote the estimate under');
      if (!partyId) throw new BadRequestException('Choose the customer');
      const facts = Object.entries((e.result as { facts?: Record<string, unknown> }).facts ?? {}).map(([k, v]) => `${k} ${v}`).join(', ');
      const q = await this.makeQuotation(tx, auth, { partyId, itemId, qty: e.qty, rate: e.unitPrice, description: `${e.title}${facts ? ` (${facts})` : ''}`.slice(0, 500), templateId: input.templateId, ref: e.number }, meta);
      await tx.update(cpqEstimates).set({ status: 'quoted', quotationId: q.id, itemId, partyId }).where(eq(cpqEstimates.id, id));
      if (e.opportunityId) await tx.update(crmOpportunities).set({ quotationId: q.id, amount: String(q.taxableTotal ?? e.unitPrice), updatedAt: new Date() }).where(and(eq(crmOpportunities.id, e.opportunityId), eq(crmOpportunities.status, 'open')));
      return { quotationId: q.id };
    });
  }

  private async makeQuotation(tx: Transaction, auth: AuthContext, v: { partyId: string; itemId: string; qty: string; rate: string; description: string; templateId?: string; ref: string }, meta: RequestMeta) {
    const [t] = v.templateId
      ? await tx.select().from(cpqQuoteTemplates).where(eq(cpqQuoteTemplates.id, v.templateId))
      : await tx.select().from(cpqQuoteTemplates).where(eq(cpqQuoteTemplates.isDefault, true)).limit(1);
    if (v.templateId && !t) throw new NotFoundException('Quote template not found');
    return this.quotations.createTx(
      tx,
      auth,
      { customerId: v.partyId, validUntil: t ? addDays(todayIST(), t.validityDays) : null, customerEnquiryRef: v.ref, terms: t?.terms ?? null, withLut: false, lines: [{ itemId: v.itemId, qty: v.qty, rate: v.rate, description: v.description, discountPct: null }] } as Parameters<QuotationsService['createTx']>[2],
      meta,
    );
  }

  // ---- configurator -----------------------------------------------------------------------

  optionGroups(auth: AuthContext, itemId: string) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id, code: items.code, name: items.name, sellingRate: items.sellingRate }).from(items).where(eq(items.id, itemId));
      if (!it) throw new NotFoundException('Item not found');
      return { item: it, groups: await tx.select().from(cpqOptionGroups).where(eq(cpqOptionGroups.itemId, itemId)).orderBy(asc(cpqOptionGroups.sequence)) };
    });
  }

  saveGroup(auth: AuthContext, itemId: string, input: z.infer<typeof optionGroupSchema>) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id }).from(items).where(eq(items.id, itemId));
      if (!it) throw new NotFoundException('Item not found');
      const ex = (c: string) => sql.raw(`excluded.${c}`);
      return (
        await tx
          .insert(cpqOptionGroups)
          .values({ tenantId: auth.tenantId, itemId, ...input })
          .onConflictDoUpdate({ target: [cpqOptionGroups.itemId, cpqOptionGroups.code], set: { name: ex('name'), required: ex('required'), multi: ex('multi'), sequence: ex('sequence'), options: ex('options') } })
          .returning()
      )[0];
    });
  }

  removeGroup(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(cpqOptionGroups).where(eq(cpqOptionGroups.id, id));
      return { ok: true };
    });
  }

  private async priceConfig(tx: Transaction, itemId: string, chosen: string[]) {
    const [it] = await tx.select({ sellingRate: items.sellingRate, name: items.name }).from(items).where(eq(items.id, itemId));
    if (!it) throw new NotFoundException('Item not found');
    const groups = await tx.select().from(cpqOptionGroups).where(eq(cpqOptionGroups.itemId, itemId)).orderBy(asc(cpqOptionGroups.sequence));
    if (!groups.length) throw new BadRequestException('This item has no options to configure');
    return { item: it, ...configure(Number(it.sellingRate ?? 0), groups, chosen) };
  }

  configure(auth: AuthContext, input: z.infer<typeof configureSchema>) {
    return this.database.run(auth, async (tx) => {
      const r = await this.priceConfig(tx, input.itemId, input.chosen);
      return { ok: r.ok, errors: r.errors, unitPrice: r.price, total: Math.round(r.price * input.qty * 100) / 100, description: r.description };
    });
  }

  /** Saves the configuration as an estimate and quotes it. */
  quoteConfigured(auth: AuthContext, input: z.infer<typeof quoteConfiguredSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const r = await this.priceConfig(tx, input.itemId, input.chosen);
      if (!r.ok) throw new BadRequestException(r.errors.join('; '));
      const [p] = await tx.select({ isCustomer: parties.isCustomer }).from(parties).where(eq(parties.id, input.partyId));
      if (!p?.isCustomer) throw new BadRequestException('Choose a customer');
      const e = await this.insert(tx, auth, { kind: 'configured', title: `${r.item.name} (configured)`, partyId: input.partyId, opportunityId: input.opportunityId ?? null, itemId: input.itemId, qty: input.qty, inputs: { chosen: input.chosen }, result: { description: r.description }, unitCost: 0, unitPrice: r.price, marginPct: 0 });
      const q = await this.makeQuotation(tx, auth, { partyId: input.partyId, itemId: input.itemId, qty: String(input.qty), rate: r.price.toFixed(2), description: `${r.item.name}: ${r.description}`.slice(0, 500), templateId: input.templateId, ref: e.number }, meta);
      await tx.update(cpqEstimates).set({ status: 'quoted', quotationId: q.id }).where(eq(cpqEstimates.id, e.id));
      if (input.opportunityId) await tx.update(crmOpportunities).set({ quotationId: q.id, amount: String(q.taxableTotal), updatedAt: new Date() }).where(and(eq(crmOpportunities.id, input.opportunityId), eq(crmOpportunities.status, 'open')));
      return { estimateId: e.id, quotationId: q.id, unitPrice: r.price };
    });
  }

  // ---- templates --------------------------------------------------------------------------

  templates(auth: AuthContext) {
    return this.database.run(auth, (tx) => tx.select().from(cpqQuoteTemplates).orderBy(desc(cpqQuoteTemplates.isDefault), asc(cpqQuoteTemplates.name)));
  }

  saveTemplate(auth: AuthContext, id: string | null, input: z.infer<typeof templateSchema>) {
    return this.database.run(auth, async (tx) => {
      if (input.isDefault) await tx.update(cpqQuoteTemplates).set({ isDefault: false }).where(id ? ne(cpqQuoteTemplates.id, id) : undefined);
      if (id) {
        const [r] = await tx.update(cpqQuoteTemplates).set(input).where(eq(cpqQuoteTemplates.id, id)).returning();
        if (!r) throw new NotFoundException('Template not found');
        return r;
      }
      return (await tx.insert(cpqQuoteTemplates).values({ tenantId: auth.tenantId, ...input }).returning())[0];
    });
  }
}
