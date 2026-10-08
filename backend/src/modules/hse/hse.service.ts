import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hazmatLimits, sdsDistributions, sdsDocuments, workPermits, type GasTest, type Transaction } from '@nextgen/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { ESignService } from '../gmp/esign.service';
import { checklistFor, classify, conflicts, gasTestOk, H_STATEMENTS, P_STATEMENTS, PERMIT_TYPES, permitProblems, petroleumClass, PICTOGRAMS, SDS_SECTIONS, sdsProblems, storageCheck, type PermitType, type StockRow } from './hse-rules';
import { many } from '../../common/sql';

const text = (n: number) => z.string().trim().max(n).nullable().optional();

export const sdsSchema = z.object({
  itemId: z.uuid(),
  language: z.string().trim().min(2).max(5).default('en'),
  sections: z.record(z.string().regex(/^([1-9]|1[0-6])$/), z.string().max(20000)).default({}),
  hazardStatements: z.array(z.string().regex(/^(EU)?H\d{3}[A-Za-z]{0,2}$/)).max(40).default([]),
  precautionaryStatements: z.array(z.string().regex(/^P\d{3}(\+P\d{3})*$/)).max(40).default([]),
  unNumber: z.string().trim().regex(/^UN\d{4}$/, 'UN followed by 4 digits').nullable().optional(),
  hazardClass: z.string().trim().regex(/^[1-9](\.[1-6])?$/, 'UN class like 3, 5.1 or 8').nullable().optional(),
  packingGroup: z.enum(['I', 'II', 'III']).nullable().optional(),
  flashPointC: z.number().min(-200).max(1000).nullable().optional(),
});
export const sendSdsSchema = z.object({ partyIds: z.array(z.uuid()).min(1).max(500), via: z.enum(['email', 'portal', 'with_goods']).default('email') });
export const limitSchema = z.object({ warehouseId: z.uuid(), hazardClass: z.string().trim().regex(/^([1-9](\.[1-6])?|petroleum_[abc])$/, 'UN class (3, 5.1…) or petroleum_a / b / c'), maxKg: z.number().positive(), licenceId: z.uuid().nullable().optional(), note: text(300) });
export const permitSchema = z.object({
  type: z.enum(PERMIT_TYPES),
  location: z.string().trim().min(2).max(120),
  equipment: text(120),
  description: z.string().trim().min(3).max(2000),
  contractor: text(120),
  workers: z.number().int().min(1).max(500).default(1),
  validFrom: z.iso.datetime({ offset: true }),
  validTo: z.iso.datetime({ offset: true }),
  isolations: z.array(z.object({ point: z.string().trim().min(1).max(120), lockNo: z.string().trim().min(1).max(40) })).max(50).default([]),
});
export const checklistSchema = z.object({ done: z.array(z.string().max(10)).max(50) });
export const gasTestSchema = z.object({ o2Pct: z.number().min(0).max(100), lelPct: z.number().min(0).max(100), h2sPpm: z.number().min(0).max(10000), coPpm: z.number().min(0).max(10000) });
export const signSchema = z.object({ password: z.string().min(1).max(200), reason: text(500) });
export const closePermitSchema = z.object({ note: z.string().trim().min(3).max(1000), cancel: z.boolean().default(false) });

/**
 * Chemical HSE pack: safety data sheets (16 sections, versions, GHS classification from H
 * statements, distribution to customers who received the product), GHS labels, hazardous inventory
 * against storage limits (PESO and factory licences) with incompatible classes stored together, and
 * permits to work with checklists, gas tests, signed approval and simultaneous-operation conflicts.
 */
@Injectable()
export class HseService {
  constructor(
    private readonly database: DatabaseService,
    private readonly esign: ESignService,
  ) {}

  catalogue() {
    return { sections: SDS_SECTIONS, pictograms: PICTOGRAMS, hazardStatements: Object.fromEntries(Object.entries(H_STATEMENTS).map(([k, v]) => [k, v[0]])), precautionaryStatements: P_STATEMENTS, permitTypes: PERMIT_TYPES };
  }

  // ---- SDS ---------------------------------------------------------------------------------------

  sdsList(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select s.id, s.item_id as "itemId", i.code, i.name, s.version, s.language, s.status, s.issued_at as "issuedAt", s.hazard_class as "hazardClass", s.un_number as "unNumber",
                   s.ghs->>'signalWord' as "signalWord", s.ghs->'pictograms' as pictograms
            from sds_documents s join items i on i.id = s.item_id
            where s.status <> 'superseded' order by i.code, s.language, s.version desc`,
      ),
    );
  }

  private async sdsView(tx: Transaction, id: string) {
    const [s] = await tx.select().from(sdsDocuments).where(eq(sdsDocuments.id, id));
    if (!s) throw new NotFoundException('SDS not found');
    const [item] = await many<{ code: string; name: string }>(tx, sql`select code, name from items where id = ${s.itemId}`);
    const history = await many(tx, sql`select id, version, status, issued_at as "issuedAt" from sds_documents where item_id = ${s.itemId} and language = ${s.language} order by version desc`);
    const sent = await many(tx, sql`select d.id, p.name as party, d.via, d.sent_at as "sentAt" from sds_distributions d join parties p on p.id = d.party_id where d.sds_id = ${id} order by d.sent_at desc`);
    // Customers who received the product but not this version.
    const due =
      s.status === 'issued'
        ? await many<{ partyId: string; party: string; lastSent: number | null }>(
            tx,
            sql`with got as (
                  select distinct dn.customer_id as party_id from delivery_note_lines l join delivery_notes dn on dn.id = l.delivery_id join documents d on d.id = dn.id
                   where l.item_id = ${s.itemId} and d.status not in ('draft', 'cancelled')
                  union
                  select distinct si.customer_id from sales_invoice_lines l join sales_invoices si on si.id = l.invoice_id join documents d on d.id = si.id
                   where l.item_id = ${s.itemId} and d.status not in ('draft', 'cancelled'))
                select g.party_id as "partyId", p.name as party,
                       (select max(x.version) from sds_distributions sd join sds_documents x on x.id = sd.sds_id where sd.party_id = g.party_id and x.item_id = ${s.itemId} and x.language = ${s.language}) as "lastSent"
                from got g join parties p on p.id = g.party_id`,
          )
        : [];
    return {
      ...s,
      item: item ?? null,
      history,
      sent,
      needsCurrent: due.filter((d) => d.lastSent === null || Number(d.lastSent) < s.version),
      problems: sdsProblems(s),
      petroleum: petroleumClass(s.flashPointC),
    };
  }

  getSds(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.sdsView(tx, id));
  }

  /** Save an SDS: edits the draft for the item and language, or starts a new version after an issued one. */
  saveSds(auth: AuthContext, input: z.infer<typeof sdsSchema>) {
    return this.database.run(auth, async (tx) => {
      const c = classify(input.hazardStatements);
      if (c.unknown.length) throw new BadRequestException(`Unknown hazard statements: ${c.unknown.join(', ')}`);
      const ghs = { pictograms: c.pictograms, signalWord: c.signalWord, hazardStatements: input.hazardStatements, precautionaryStatements: input.precautionaryStatements };
      const values = { sections: input.sections, ghs, unNumber: input.unNumber ?? null, hazardClass: input.hazardClass ?? null, packingGroup: input.packingGroup ?? null, flashPointC: input.flashPointC ?? null, petroleumClass: petroleumClass(input.flashPointC ?? null) };
      const [last] = await tx.select().from(sdsDocuments).where(and(eq(sdsDocuments.itemId, input.itemId), eq(sdsDocuments.language, input.language))).orderBy(desc(sdsDocuments.version)).limit(1);
      if (last?.status === 'draft') {
        await tx.update(sdsDocuments).set(values).where(eq(sdsDocuments.id, last.id));
        return this.sdsView(tx, last.id);
      }
      const [r] = await tx
        .insert(sdsDocuments)
        .values({ tenantId: auth.tenantId, itemId: input.itemId, language: input.language, version: (last?.version ?? 0) + 1, ...values })
        .returning({ id: sdsDocuments.id });
      return this.sdsView(tx, r.id);
    });
  }

  /** Issue a draft: the previous issued version is superseded and the warehouse profile gets the hazard class. */
  issueSds(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const v = await this.sdsView(tx, id);
      if (v.status !== 'draft') throw new ConflictException('Only a draft can be issued');
      if (v.problems.length) throw new ConflictException(`Not ready: ${v.problems.join('; ')}`);
      await tx.execute(sql`update sds_documents set status = 'superseded' where item_id = ${v.itemId} and language = ${v.language} and status = 'issued'`);
      await tx.update(sdsDocuments).set({ status: 'issued', issuedAt: new Date(), issuedBy: auth.userId }).where(eq(sdsDocuments.id, id));
      if (v.hazardClass) await tx.execute(sql`update wms_item_profiles set hazard_class = ${v.hazardClass} where item_id = ${v.itemId}`);
      return this.sdsView(tx, id);
    });
  }

  sendSds(auth: AuthContext, id: string, input: z.infer<typeof sendSdsSchema>) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.select({ status: sdsDocuments.status }).from(sdsDocuments).where(eq(sdsDocuments.id, id));
      if (!s) throw new NotFoundException('SDS not found');
      if (s.status !== 'issued') throw new ConflictException('Send the issued version');
      await tx.insert(sdsDistributions).values(input.partyIds.map((partyId) => ({ tenantId: auth.tenantId, sdsId: id, partyId, via: input.via, sentBy: auth.userId })));
      return this.sdsView(tx, id);
    });
  }

  /** What goes on the GHS label of an item: from its issued SDS. */
  label(auth: AuthContext, itemId: string) {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx
        .select()
        .from(sdsDocuments)
        .where(and(eq(sdsDocuments.itemId, itemId), eq(sdsDocuments.status, 'issued')))
        .orderBy(desc(sdsDocuments.issuedAt))
        .limit(1);
      if (!s) throw new NotFoundException('The item has no issued SDS');
      const [item] = await many<{ code: string; name: string }>(tx, sql`select code, name from items where id = ${itemId}`);
      const [co] = await many<{ name: string; address: string | null; phone: string | null }>(tx, sql`select coalesce(legal_name, name) as name, concat_ws(', ', address->>'line1', address->>'city', address->>'pincode') as address, null::text as phone from companies where deleted_at is null order by created_at limit 1`);
      return {
        item,
        supplier: co ?? null,
        signalWord: s.ghs.signalWord,
        pictograms: s.ghs.pictograms,
        hazard: s.ghs.hazardStatements.map((h) => ({ code: h, text: H_STATEMENTS[h]?.[0] ?? h })),
        precautionary: s.ghs.precautionaryStatements.map((p) => ({ code: p, text: p.split('+').map((x) => P_STATEMENTS[x] ?? x).join(' ') })),
        unNumber: s.unNumber,
        hazardClass: s.hazardClass,
        packingGroup: s.packingGroup,
        sdsVersion: s.version,
      };
    });
  }

  // ---- storage limits ----------------------------------------------------------------------------

  storage(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const stock = await many<StockRow>(
        tx,
        sql`with cls as (
              select distinct on (s.item_id) s.item_id, s.hazard_class, s.petroleum_class from sds_documents s where s.status = 'issued' order by s.item_id, s.issued_at desc)
            select l.warehouse_id as "warehouseId", w.name as warehouse, l.item_id as "itemId", i.code || ' · ' || i.name as item,
                   coalesce(c.hazard_class, p.hazard_class) as "hazardClass", c.petroleum_class as "petroleumClass",
                   (sum(l.qty) * case when upper(u.code) in ('KG', 'KGS') then 1 when upper(u.code) in ('MT', 'TON', 'TNE') then 1000 else coalesce(i.net_weight_kg, 1) end)::float8 as kg
            from stock_ledger l join items i on i.id = l.item_id join uoms u on u.id = i.base_uom_id join warehouses w on w.id = l.warehouse_id
            left join cls c on c.item_id = l.item_id left join wms_item_profiles p on p.item_id = l.item_id
            where coalesce(c.hazard_class, p.hazard_class) is not null or c.petroleum_class is not null
            group by l.warehouse_id, w.name, l.item_id, i.code, i.name, c.hazard_class, p.hazard_class, c.petroleum_class, u.code, i.net_weight_kg
            having sum(l.qty) > 0`,
      );
      const limits = await many<{ id: string; warehouseId: string; warehouse: string; hazardClass: string; maxKg: number; licence: string | null; licenceValidUntil: string | null; note: string | null }>(
        tx,
        sql`select h.id, h.warehouse_id as "warehouseId", w.name as warehouse, h.hazard_class as "hazardClass", h.max_kg as "maxKg", h.note,
                   l.name || coalesce(' ' || l.number, '') as licence, l.valid_until::text as "licenceValidUntil"
            from hazmat_limits h join warehouses w on w.id = h.warehouse_id left join licences l on l.id = h.licence_id order by w.name, h.hazard_class`,
      );
      const r = storageCheck(stock, limits);
      return { ...r, unlimited: stock.filter((s) => !limits.some((l) => l.warehouseId === s.warehouseId)) };
    });
  }

  saveLimit(auth: AuthContext, input: z.infer<typeof limitSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .insert(hazmatLimits)
        .values({ tenantId: auth.tenantId, ...input })
        .onConflictDoUpdate({ target: [hazmatLimits.tenantId, hazmatLimits.warehouseId, hazmatLimits.hazardClass], set: { maxKg: input.maxKg, licenceId: input.licenceId ?? null, note: input.note ?? null } })
        .returning();
      return r;
    });
  }

  deleteLimit(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(hazmatLimits).where(eq(hazmatLimits.id, id));
      return { ok: true };
    });
  }

  // ---- permits to work ---------------------------------------------------------------------------

  permits(auth: AuthContext, status?: string) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select p.id, p.number, p.type, p.location, p.description, p.status, p.valid_from as "validFrom", p.valid_to as "validTo", p.workers, p.contractor, u.full_name as "requestedBy"
            from work_permits p left join users u on u.id = p.requested_by
            where ${status ? sql`p.status = ${status}` : sql`p.created_at > now() - interval '60 days' or p.status in ('requested', 'approved', 'active')`}
            order by p.valid_from desc limit 300`,
      ),
    );
  }

  private async permitView(tx: Transaction, id: string) {
    const [p] = await tx.select().from(workPermits).where(eq(workPermits.id, id));
    if (!p) throw new NotFoundException('Permit not found');
    const others = await many<{ number: string; type: string; location: string; validFrom: string; validTo: string }>(
      tx,
      sql`select number, type, location, valid_from as "validFrom", valid_to as "validTo" from work_permits where id <> ${id} and status in ('requested', 'approved', 'active')`,
    );
    const [sig] = p.approvalSignatureId ? await many<{ signerName: string; signedAt: string }>(tx, sql`select signer_name as "signerName", signed_at as "signedAt" from e_signatures where id = ${p.approvalSignatureId}`) : [];
    const shape = { type: p.type as PermitType, validFrom: p.validFrom, validTo: p.validTo, checklist: p.checklist, gasTests: p.gasTests, location: p.location };
    return {
      ...p,
      approval: sig ?? null,
      conflicts: conflicts(shape, others.map((o) => ({ ...o, validFrom: new Date(o.validFrom), validTo: new Date(o.validTo) }))),
      problems: { approve: permitProblems(shape, 'approve'), activate: permitProblems(shape, 'activate') },
    };
  }

  getPermit(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.permitView(tx, id));
  }

  requestPermit(auth: AuthContext, input: z.infer<typeof permitSchema>) {
    return this.database.run(auth, async (tx) => {
      const [{ n }] = await many<{ n: number }>(tx, sql`select count(*)::int + 1 as n from work_permits`);
      const prefix = { hot_work: 'HW', cold_work: 'CW', confined_space: 'CS', height: 'WH', electrical: 'EL', excavation: 'EX', line_break: 'LB' }[input.type];
      const [r] = await tx
        .insert(workPermits)
        .values({ tenantId: auth.tenantId, number: `PTW-${prefix}-${String(n).padStart(5, '0')}`, ...input, validFrom: new Date(input.validFrom), validTo: new Date(input.validTo), checklist: checklistFor(input.type), requestedBy: auth.userId })
        .returning({ id: workPermits.id });
      return this.permitView(tx, r.id);
    });
  }

  private async open(tx: Transaction, id: string, allowed: string[]) {
    const [p] = await tx.select().from(workPermits).where(eq(workPermits.id, id));
    if (!p) throw new NotFoundException('Permit not found');
    if (!allowed.includes(p.status)) throw new ConflictException(`The permit is ${p.status}`);
    return p;
  }

  checklist(auth: AuthContext, id: string, input: z.infer<typeof checklistSchema>) {
    return this.database.run(auth, async (tx) => {
      const p = await this.open(tx, id, ['requested', 'approved']);
      await tx
        .update(workPermits)
        .set({ checklist: p.checklist.map((c) => ({ ...c, done: input.done.includes(c.key) })) })
        .where(eq(workPermits.id, id));
      return this.permitView(tx, id);
    });
  }

  gasTest(auth: AuthContext, id: string, input: z.infer<typeof gasTestSchema>) {
    return this.database.run(auth, async (tx) => {
      const p = await this.open(tx, id, ['requested', 'approved', 'active']);
      const [u] = await many<{ name: string }>(tx, sql`select full_name as name from users where id = ${auth.userId}`);
      const t: GasTest = { at: new Date().toISOString(), ...input, by: u?.name ?? '' };
      await tx
        .update(workPermits)
        .set({ gasTests: [...p.gasTests, t] })
        .where(eq(workPermits.id, id));
      const issues = gasTestOk(input, p.type as PermitType);
      // A failed test on running work stops it.
      if (issues.length && p.status === 'active') await tx.update(workPermits).set({ status: 'approved', activatedAt: null }).where(eq(workPermits.id, id));
      return { ...(await this.permitView(tx, id)), testIssues: issues };
    });
  }

  approvePermit(auth: AuthContext, id: string, input: z.infer<typeof signSchema>, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      await this.open(tx, id, ['requested']);
      const v = await this.permitView(tx, id);
      if (v.problems.approve.length) throw new ConflictException(`Not ready: ${v.problems.approve.join('; ')}`);
      if (v.conflicts.length) throw new ConflictException(`Conflicts with ${v.conflicts.join('; ')}`);
      const sig = await this.esign.sign(tx, auth, { entityType: 'work_permit', entityId: id, meaning: `Permit to work ${v.number} approved`, reason: input.reason ?? null, payload: { number: v.number, type: v.type, location: v.location, validFrom: v.validFrom, validTo: v.validTo, checklist: v.checklist, isolations: v.isolations }, password: input.password, ip: meta.ip });
      await tx.update(workPermits).set({ status: 'approved', approvalSignatureId: sig.id }).where(eq(workPermits.id, id));
      return this.permitView(tx, id);
    });
  }

  activate(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await this.open(tx, id, ['approved']);
      const v = await this.permitView(tx, id);
      if (v.problems.activate.length) throw new ConflictException(`Cannot start: ${v.problems.activate.join('; ')}`);
      await tx.update(workPermits).set({ status: 'active', activatedAt: new Date() }).where(eq(workPermits.id, id));
      return this.permitView(tx, id);
    });
  }

  closePermit(auth: AuthContext, id: string, input: z.infer<typeof closePermitSchema>) {
    return this.database.run(auth, async (tx) => {
      await this.open(tx, id, input.cancel ? ['requested', 'approved', 'active'] : ['active']);
      await tx
        .update(workPermits)
        .set({ status: input.cancel ? 'cancelled' : 'closed', closedAt: new Date(), closeNote: input.note })
        .where(eq(workPermits.id, id));
      return this.permitView(tx, id);
    });
  }
}
