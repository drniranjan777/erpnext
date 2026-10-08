import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { dpcoCeilings, pharmaSettings, serialContainers, serialUnits, stabilityResults, stabilityStudies, wmsSettings, type StabilityTest, type Transaction } from '@nextgen/database';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { nextCode } from '../../common/codes';
import { todayIST } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { DeviationsService } from '../qms/deviations.service';
import { sscc } from '../wms/outbound';
import { apiQrContent, dpcoBreaches, gs1DataMatrix, gs1Hri, pullDate, randomSerial, shelfLife, toGtin14 } from './pharma-math';
import { many } from '../../common/sql';

const day = z.iso.date();

export const settingsSchema = z.object({ manufacturingLicenceNo: z.string().trim().max(60).nullable(), importLicenceNo: z.string().trim().max(60).nullable() });
export const studySchema = z.object({
  code: z.string().trim().min(1).max(30),
  itemId: z.uuid(),
  batchNo: z.string().trim().min(1).max(40),
  protocolNo: z.string().trim().max(40).nullable().optional(),
  kind: z.enum(['long_term', 'intermediate', 'accelerated', 'ongoing', 'photostability']),
  temperatureC: z.number().min(-80).max(80),
  humidityPct: z.number().min(0).max(100).nullable().optional(),
  packing: z.string().trim().max(120).nullable().optional(),
  startDate: day,
  timePoints: z.array(z.number().min(0).max(120)).min(1).max(30),
  tests: z.array(z.object({ name: z.string().trim().min(1).max(80), unit: z.string().trim().max(20).nullable().optional(), min: z.number().nullable().optional(), max: z.number().nullable().optional() })).min(1).max(40),
  claimedShelfLifeMonths: z.number().int().min(1).max(120).nullable().optional(),
});
export const resultsSchema = z.object({ timePoint: z.number().min(0).max(120), testedOn: day.optional(), results: z.array(z.object({ test: z.string().min(1).max(80), value: z.number().finite(), notes: z.string().trim().max(300).nullable().optional() })).min(1).max(40) });
export const commissionSchema = z.object({ itemId: z.uuid(), gtin: z.string().trim().regex(/^\d{8,14}$/), batchNo: z.string().trim().min(1).max(20), expiryDate: day, count: z.number().int().min(1).max(10_000), workOrderId: z.uuid().nullable().optional() });
export const aggregateSchema = z.object({ level: z.enum(['carton', 'shipper', 'pallet']), children: z.array(z.string().trim().min(1).max(60)).min(1).max(5000) });
export const decommissionSchema = z.object({ codes: z.array(z.string().trim().min(1).max(60)).min(1).max(1000), reason: z.enum(['damaged', 'sample', 'destroyed', 'stolen', 'recalled']) });
export const ceilingSchema = z.object({ itemId: z.uuid(), ceilingPrice: z.number().positive(), notification: z.string().trim().max(80).nullable().optional(), effectiveFrom: day });

/**
 * Pharma pack: stability studies with ICH Q1E shelf-life estimates, the annual product quality
 * review, GS1 serialisation with aggregation (SGTIN in SSCC), QR codes for API labels, and DPCO
 * ceiling-price compliance.
 */
@Injectable()
export class PharmaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly deviations: DeviationsService,
  ) {}

  // ---- settings ----------------------------------------------------------------------------------

  settings(auth: AuthContext) {
    return this.database.run(auth, async (tx) => (await tx.select().from(pharmaSettings))[0] ?? { manufacturingLicenceNo: null, importLicenceNo: null });
  }

  saveSettings(auth: AuthContext, input: z.infer<typeof settingsSchema>) {
    return this.database.run(auth, async (tx) => (await tx.insert(pharmaSettings).values({ tenantId: auth.tenantId, ...input }).onConflictDoUpdate({ target: pharmaSettings.tenantId, set: input }).returning())[0]);
  }

  // ---- stability ---------------------------------------------------------------------------------

  studies(auth: AuthContext, q: { itemId?: string; status?: string }) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ id: string; code: string; itemCode: string; itemName: string; batchNo: string; kind: string; temperatureC: number; humidityPct: number | null; startDate: string; timePoints: number[]; status: string; tested: number[]; oos: number }>(
        tx,
        sql`select s.id, s.code, i.code as "itemCode", i.name as "itemName", s.batch_no as "batchNo", s.kind, s.temperature_c as "temperatureC", s.humidity_pct as "humidityPct",
              s.start_date::text as "startDate", s.time_points as "timePoints", s.status,
              coalesce((select array_agg(distinct r.time_point) from stability_results r where r.study_id = s.id), '{}') as tested,
              (select count(*)::int from stability_results r where r.study_id = s.id and r.ok = 0) as oos
            from stability_studies s join items i on i.id = s.item_id
            where true ${q.itemId ? sql`and s.item_id = ${q.itemId}` : sql``} ${q.status ? sql`and s.status = ${q.status}` : sql``} order by s.start_date desc, s.code`,
      );
      const today = todayIST();
      return rows.map((r) => {
        const pending = r.timePoints.filter((t) => !r.tested.includes(t)).map((t) => ({ timePoint: t, pullDate: pullDate(r.startDate, t) }));
        const next = pending[0] ?? null;
        return { ...r, nextPull: next, overdue: pending.filter((p) => p.pullDate < today).length };
      });
    });
  }

  createStudy(auth: AuthContext, input: z.infer<typeof studySchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: stabilityStudies.id }).from(stabilityStudies).where(eq(stabilityStudies.code, input.code));
      if (dup) throw new ConflictException(`Study ${input.code} already exists`);
      for (const t of input.tests) if (t.min != null && t.max != null && t.min > t.max) throw new BadRequestException(`${t.name}: the minimum is above the maximum`);
      const timePoints = [...new Set(input.timePoints)].sort((a, b) => a - b);
      const [s] = await tx
        .insert(stabilityStudies)
        .values({ tenantId: auth.tenantId, ...input, protocolNo: input.protocolNo ?? null, humidityPct: input.humidityPct ?? null, packing: input.packing ?? null, timePoints, tests: input.tests as StabilityTest[], claimedShelfLifeMonths: input.claimedShelfLifeMonths ?? null, createdBy: auth.userId })
        .returning();
      return s;
    });
  }

  study(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => this.studyView(tx, id));
  }

  private async studyView(tx: Transaction, id: string) {
    const [s] = await tx.select().from(stabilityStudies).where(eq(stabilityStudies.id, id));
    if (!s) throw new NotFoundException('Study not found');
    const [item] = await many<{ code: string; name: string }>(tx, sql`select code, name from items where id = ${s.itemId}`);
    const results = await tx.select().from(stabilityResults).where(eq(stabilityResults.studyId, id));
    const today = todayIST();
    const schedule = s.timePoints.map((t) => {
      const done = results.filter((r) => r.timePoint === t);
      return { timePoint: t, pullDate: pullDate(s.startDate, t), tested: done.length > 0, overdue: !done.length && pullDate(s.startDate, t) < today, oos: done.filter((r) => !r.ok).length };
    });
    const trends = s.tests.map((t) => {
      const pts = results.filter((r) => r.test === t.name).map((r) => ({ x: r.timePoint, y: r.value })).sort((a, b) => a.x - b.x);
      const est = shelfLife(pts, t.min ?? null, t.max ?? null);
      return {
        test: t.name,
        unit: t.unit ?? null,
        min: t.min ?? null,
        max: t.max ?? null,
        points: pts,
        slopePerMonth: est ? Math.round(est.fit.slope * 10_000) / 10_000 : null,
        shelfLifeMonths: est?.months ?? null,
        limitedBy: est?.limitedBy ?? null,
      };
    });
    const supported = trends.filter((t) => t.shelfLifeMonths !== null).map((t) => t.shelfLifeMonths!);
    return {
      ...s,
      item: item ? `${item.code} · ${item.name}` : '',
      results: results.map((r) => ({ id: r.id, timePoint: r.timePoint, test: r.test, value: r.value, ok: !!r.ok, testedOn: r.testedOn, notes: r.notes, deviationId: r.deviationId })),
      schedule,
      trends,
      supportedShelfLifeMonths: supported.length ? Math.min(...supported) : null,
    };
  }

  /** Results of one pull; anything out of specification raises a deviation (OOS investigation). */
  async recordResults(auth: AuthContext, id: string, input: z.infer<typeof resultsSchema>, meta: RequestMeta) {
    const oos = await this.database.run(auth, async (tx) => {
      const [s] = await tx.select().from(stabilityStudies).where(eq(stabilityStudies.id, id));
      if (!s) throw new NotFoundException('Study not found');
      if (s.status !== 'active') throw new ConflictException('The study is not active');
      if (!s.timePoints.includes(input.timePoint)) throw new BadRequestException(`${input.timePoint} months is not a time point of this study`);
      const bad: { test: string; value: number; spec: string; rowId: string }[] = [];
      for (const r of input.results) {
        const t = s.tests.find((x) => x.name.toLowerCase() === r.test.toLowerCase());
        if (!t) throw new BadRequestException(`${r.test} is not a test of this study`);
        const ok = (t.min == null || r.value >= t.min) && (t.max == null || r.value <= t.max);
        const [row] = await tx
          .insert(stabilityResults)
          .values({ tenantId: auth.tenantId, studyId: id, timePoint: input.timePoint, test: t.name, value: r.value, ok: ok ? 1 : 0, testedOn: input.testedOn ?? todayIST(), testedBy: auth.userId, notes: r.notes ?? null })
          .onConflictDoUpdate({ target: [stabilityResults.tenantId, stabilityResults.studyId, stabilityResults.timePoint, stabilityResults.test], set: { value: r.value, ok: ok ? 1 : 0, testedBy: auth.userId, notes: r.notes ?? null } })
          .returning({ id: stabilityResults.id });
        if (!ok) bad.push({ test: t.name, value: r.value, spec: `${t.min ?? '–'} to ${t.max ?? '–'}${t.unit ? ` ${t.unit}` : ''}`, rowId: row.id });
      }
      return { s, bad };
    });
    for (const b of oos.bad) {
      const dev = await this.deviations.create(
        auth,
        { kind: 'unplanned', category: 'material', description: `Stability OOS: study ${oos.s.code}, batch ${oos.s.batchNo}, ${input.timePoint} months at ${oos.s.temperatureC} °C${oos.s.humidityPct ? ` / ${oos.s.humidityPct} % RH` : ''}: ${b.test} ${b.value} (specification ${b.spec}).`, itemId: oos.s.itemId, batchNo: oos.s.batchNo, workOrderId: null, impact: null, severity: 4, occurrence: 2, detection: 2, productImpact: true, proposedAction: 'OOS investigation: laboratory check, then full investigation; assess the batches on the market.', validUntil: null } as never,
        meta,
      );
      await this.database.run(auth, (tx) => tx.update(stabilityResults).set({ deviationId: dev.id }).where(eq(stabilityResults.id, b.rowId)));
    }
    return this.database.run(auth, (tx) => this.studyView(tx, id));
  }

  setStudyStatus(auth: AuthContext, id: string, status: 'completed' | 'cancelled') {
    return this.database.run(auth, async (tx) => {
      const [s] = await tx.update(stabilityStudies).set({ status }).where(and(eq(stabilityStudies.id, id), eq(stabilityStudies.status, 'active'))).returning();
      if (!s) throw new ConflictException('Study not found or not active');
      return s;
    });
  }

  // ---- APQR --------------------------------------------------------------------------------------

  /** Annual product quality review: everything about the product's batches in the period. */
  apqr(auth: AuthContext, itemId: string, from: string, to: string) {
    return this.database.run(auth, async (tx) => {
      const [item] = await many<{ code: string; name: string }>(tx, sql`select code, name from items where id = ${itemId}`);
      if (!item) throw new NotFoundException('Item not found');
      const batches = await many<{ id: string; number: string | null; batchNo: string | null; qty: number; produced: number; rejected: number; stage: string; review: string | null; date: string }>(
        tx,
        sql`select wo.id, d.number, wo.batch_no as "batchNo", wo.qty::float8 as qty, wo.produced_qty::float8 as produced, wo.rejected_qty::float8 as rejected, wo.stage,
              (select status from batch_reviews r where r.work_order_id = wo.id) as review, d.doc_date::text as date
            from work_orders wo join documents d on d.id = wo.id
            where wo.item_id = ${itemId} and d.status not in ('cancelled', 'rejected', 'draft') and d.doc_date between ${from} and ${to} order by d.doc_date`,
      );
      const yields = batches.filter((b) => b.qty > 0 && b.produced > 0).map((b) => (b.produced / b.qty) * 100);
      const stat = (v: number[]) => (v.length ? { mean: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, min: Math.round(Math.min(...v) * 10) / 10, max: Math.round(Math.max(...v) * 10) / 10 } : null);
      const ids = batches.map((b) => b.id);
      const none = ['00000000-0000-0000-0000-000000000000'];
      const deviations = await many(
        tx,
        sql`select d.id, doc.number, d.kind, d.category, d.description, (d.closed_at is not null) as closed from deviations d join documents doc on doc.id = d.id
            where (d.item_id = ${itemId} or d.work_order_id in ${ids.length ? ids : none}) and doc.doc_date between ${from} and ${to} order by doc.doc_date`,
      );
      const capas = await many(tx, sql`select c.id, doc.number, c.kind, c.problem, doc.status from capas c join documents doc on doc.id = c.id where c.item_id = ${itemId} and doc.doc_date between ${from} and ${to}`);
      const complaints = await many(tx, sql`select c.id, doc.number, c.category, c.description, doc.status from customer_complaints c join documents doc on doc.id = c.id where c.item_id = ${itemId} and doc.doc_date between ${from} and ${to}`);
      const ncrs = await many(tx, sql`select n.id, doc.number, n.description, n.qty_affected::float8 as qty from ncrs n join documents doc on doc.id = n.id where n.item_id = ${itemId} and doc.doc_date between ${from} and ${to}`);
      const inspections = await many<{ result: string; n: number }>(tx, sql`select q.result, count(*)::int as n from quality_inspections q join documents doc on doc.id = q.id where q.item_id = ${itemId} and doc.doc_date between ${from} and ${to} group by 1`);
      const changes = await many(
        tx,
        sql`select distinct ec.id, doc.number, ec.reason, ec.kind from engineering_changes ec join documents doc on doc.id = ec.id join engineering_change_items eci on eci.change_id = ec.id
            where eci.item_id = ${itemId} and doc.doc_date between ${from} and ${to}`,
      );
      const studies = await many<{ id: string }>(tx, sql`select id from stability_studies where item_id = ${itemId}`);
      const stability = [];
      for (const s of studies) {
        const v = await this.studyView(tx, s.id);
        stability.push({ code: v.code, batchNo: v.batchNo, kind: v.kind, condition: `${v.temperatureC} °C${v.humidityPct ? ` / ${v.humidityPct} % RH` : ''}`, status: v.status, oos: v.results.filter((r) => !r.ok).length, supportedShelfLifeMonths: v.supportedShelfLifeMonths, claimed: v.claimedShelfLifeMonths });
      }
      return {
        item: `${item.code} · ${item.name}`,
        from,
        to,
        batches: { count: batches.length, completed: batches.filter((b) => ['completed', 'closed'].includes(b.stage)).length, rejectedReviews: batches.filter((b) => b.review === 'rejected').length, list: batches },
        yieldPct: stat(yields),
        deviations,
        capas,
        complaints,
        ncrs,
        inspections,
        changes,
        stability,
      };
    });
  }

  // ---- serialisation -----------------------------------------------------------------------------

  /** Generates random serial numbers for a batch (SGTIN). */
  commission(auth: AuthContext, input: z.infer<typeof commissionSchema>) {
    return this.database.run(auth, async (tx) => {
      const gtin = toGtin14(input.gtin);
      if (!gtin) throw new BadRequestException('The GTIN check digit is wrong');
      const rows: { serial: string }[] = [];
      const made = new Set<string>();
      while (rows.length < input.count) {
        const serial = randomSerial();
        if (made.has(serial)) continue;
        made.add(serial);
        rows.push({ serial });
      }
      const inserted: (typeof serialUnits.$inferSelect)[] = [];
      for (let i = 0; i < rows.length; i += 1000) {
        inserted.push(
          ...(await tx
            .insert(serialUnits)
            .values(rows.slice(i, i + 1000).map((r) => ({ tenantId: auth.tenantId, gtin, serial: r.serial, itemId: input.itemId, batchNo: input.batchNo, expiryDate: input.expiryDate, workOrderId: input.workOrderId ?? null })))
            .onConflictDoNothing()
            .returning()),
        );
      }
      return { gtin, count: inserted.length, units: inserted.slice(0, 200).map((u) => ({ serial: u.serial, hri: gs1Hri(u), dataMatrix: gs1DataMatrix(u) })) };
    });
  }

  /** Packs units (or containers) into a carton, shipper or pallet; shippers and pallets get an SSCC. */
  aggregate(auth: AuthContext, input: z.infer<typeof aggregateSchema>) {
    return this.database.run(auth, async (tx) => {
      const isUnit = (c: string) => c.startsWith('(01)') || c.startsWith('01') && c.length > 18;
      const unitKeys = input.children.filter(isUnit).map((c) => this.parseUnit(c));
      const containerCodes = input.children.filter((c) => !isUnit(c));
      if (input.level === 'carton' && containerCodes.length) throw new BadRequestException('A carton holds units only');
      const wanted = new Set(unitKeys.map((k) => `${k.gtin}|${k.serial}`));
      const units = unitKeys.length
        ? (
            await tx
              .select()
              .from(serialUnits)
              .where(and(inArray(serialUnits.gtin, [...new Set(unitKeys.map((k) => k.gtin))]), inArray(serialUnits.serial, [...new Set(unitKeys.map((k) => k.serial))])))
          ).filter((u) => wanted.has(`${u.gtin}|${u.serial}`))
        : [];
      if (units.length !== unitKeys.length) throw new BadRequestException(`${unitKeys.length - units.length} unit(s) are not commissioned`);
      const used = units.filter((u) => u.containerId || u.status !== 'commissioned');
      if (used.length) throw new ConflictException(`Already packed or not available: ${used.slice(0, 3).map((u) => u.serial).join(', ')}`);
      const children = containerCodes.length ? await tx.select().from(serialContainers).where(inArray(serialContainers.code, containerCodes)) : [];
      if (children.length !== containerCodes.length) throw new BadRequestException('Unknown container code');
      if (children.some((c) => c.parentId)) throw new ConflictException('A container is already inside another one');
      const order = { carton: 0, shipper: 1, pallet: 2 } as const;
      if (children.some((c) => order[c.level as keyof typeof order] >= order[input.level])) throw new BadRequestException(`A ${input.level} can only hold smaller containers`);
      const batchSet = new Set([...units.map((u) => `${u.itemId}|${u.batchNo}`), ...children.map((c) => `${c.itemId}|${c.batchNo}`)]);
      let code: string;
      if (input.level === 'carton') code = `CTN${await nextCode(tx, auth.tenantId, 'serial_carton', '', 8)}`;
      else {
        const [w] = await tx.select().from(wmsSettings);
        if (!w?.gs1Prefix) throw new BadRequestException('Set your GS1 company prefix in warehouse settings to number shippers and pallets');
        code = sscc(w.ssccExtension, w.gs1Prefix, Number(await nextCode(tx, auth.tenantId, 'sscc', '', 0)));
      }
      const [first] = batchSet.size === 1 ? [...batchSet].map((k) => k.split('|')) : [[null, null]];
      const [c] = await tx.insert(serialContainers).values({ tenantId: auth.tenantId, code, level: input.level, itemId: first[0] === 'null' ? null : first[0], batchNo: first[1] === 'null' ? null : first[1], createdBy: auth.userId }).returning();
      if (units.length) await tx.update(serialUnits).set({ containerId: c.id, status: 'packed' }).where(inArray(serialUnits.id, units.map((u) => u.id)));
      if (children.length) await tx.update(serialContainers).set({ parentId: c.id }).where(inArray(serialContainers.id, children.map((x) => x.id)));
      return { ...c, units: units.length, containers: children.length, mixedBatches: batchSet.size > 1 };
    });
  }

  private parseUnit(code: string): { gtin: string; serial: string } {
    const hri = code.match(/^\(01\)(\d{14}).*\(21\)([^()]+)$/);
    if (hri) return { gtin: hri[1], serial: hri[2] };
    const raw = code.match(/^01(\d{14})(?:17\d{6})?(?:10[^\u001d]*\u001d)?21(.+)$/);
    if (raw) return { gtin: raw[1], serial: raw[2] };
    throw new BadRequestException(`Not a GS1 unit code: ${code}`);
  }

  decommission(auth: AuthContext, input: z.infer<typeof decommissionSchema>) {
    return this.database.run(auth, async (tx) => {
      let n = 0;
      for (const code of input.codes) {
        const k = this.parseUnit(code);
        const r = await tx
          .update(serialUnits)
          .set({ status: 'decommissioned', decommissionReason: input.reason })
          .where(and(eq(serialUnits.gtin, k.gtin), eq(serialUnits.serial, k.serial), sql`${serialUnits.status} <> 'shipped'`))
          .returning({ id: serialUnits.id });
        n += r.length;
      }
      return { decommissioned: n };
    });
  }

  /** What a scanned code is: a unit (with its packing) or a container (with its contents). */
  lookup(auth: AuthContext, code: string) {
    return this.database.run(auth, async (tx) => {
      if (/^\d{18}$/.test(code) || code.startsWith('CTN')) {
        const [c] = await tx.select().from(serialContainers).where(eq(serialContainers.code, code));
        if (!c) throw new NotFoundException('Unknown container');
        const units = await many<{ n: number }>(tx, sql`with recursive tree as (select id from serial_containers where id = ${c.id} union all select sc.id from serial_containers sc join tree on sc.parent_id = tree.id) select count(*)::int as n from serial_units where container_id in (select id from tree)`);
        return { kind: 'container', ...c, units: units[0].n };
      }
      const k = this.parseUnit(code);
      const [u] = await tx.select().from(serialUnits).where(and(eq(serialUnits.gtin, k.gtin), eq(serialUnits.serial, k.serial)));
      if (!u) return { kind: 'unit', genuine: false, message: 'This serial number was never issued: treat the pack as suspect' };
      const parents = await many<{ code: string; level: string }>(
        tx,
        sql`with recursive up as (select id, code, level, parent_id, 0 as depth from serial_containers where id = ${u.containerId} union all select sc.id, sc.code, sc.level, sc.parent_id, up.depth + 1 from serial_containers sc join up on sc.id = up.parent_id) select code, level from up order by depth`,
      );
      return { kind: 'unit', genuine: u.status !== 'decommissioned', status: u.status, reason: u.decommissionReason, gtin: u.gtin, serial: u.serial, batchNo: u.batchNo, expiryDate: u.expiryDate, hri: gs1Hri(u), parents };
    });
  }

  /** The serialisation data of a batch for the export portal (units within their containers). */
  exportBatch(auth: AuthContext, itemId: string, batchNo: string) {
    return this.database.run(auth, async (tx) => {
      const units = await tx.select().from(serialUnits).where(and(eq(serialUnits.itemId, itemId), eq(serialUnits.batchNo, batchNo)));
      if (!units.length) throw new NotFoundException('No serial numbers for this batch');
      const containers = await many<{ id: string; code: string; level: string; parentId: string | null }>(
        tx,
        sql`with recursive up as (select id, code, level, parent_id from serial_containers where id in ${[...new Set(units.map((u) => u.containerId).filter(Boolean))].length ? [...new Set(units.map((u) => u.containerId).filter((x): x is string => !!x))] : ['00000000-0000-0000-0000-000000000000']}
            union select sc.id, sc.code, sc.level, sc.parent_id from serial_containers sc join up on sc.id = up.parent_id) select id, code, level, parent_id as "parentId" from up`,
      );
      const [item] = await many<{ code: string; name: string }>(tx, sql`select code, name from items where id = ${itemId}`);
      const node = (c: (typeof containers)[number]): Record<string, unknown> => ({
        code: c.code,
        level: c.level,
        children: [...containers.filter((x) => x.parentId === c.id).map(node), ...units.filter((u) => u.containerId === c.id).map((u) => ({ sgtin: `${u.gtin}.${u.serial}`, status: u.status }))],
      });
      return {
        product: { code: item.code, name: item.name, gtin: units[0].gtin },
        batchNo,
        expiryDate: units[0].expiryDate,
        counts: { units: units.length, packed: units.filter((u) => u.status === 'packed' || u.status === 'shipped').length, decommissioned: units.filter((u) => u.status === 'decommissioned').length },
        hierarchy: containers.filter((c) => !c.parentId).map(node),
        loose: units.filter((u) => !u.containerId && u.status !== 'decommissioned').map((u) => `${u.gtin}.${u.serial}`),
      };
    });
  }

  // ---- API labels --------------------------------------------------------------------------------

  apiLabels(auth: AuthContext, q: { itemId: string; batchNo: string; brandName?: string; batchSize?: string; storage?: string; retestDate?: string; containers: number }) {
    return this.database.run(auth, async (tx) => {
      const [item] = await many<{ code: string; name: string }>(tx, sql`select code, name from items where id = ${q.itemId}`);
      if (!item) throw new NotFoundException('Item not found');
      const [b] = await many<{ mfgDate: string | null; expiryDate: string | null }>(tx, sql`select mfg_date::text as "mfgDate", expiry_date::text as "expiryDate" from batches where item_id = ${q.itemId} and batch_no = ${q.batchNo}`);
      const [co] = await many<{ name: string; address: Record<string, string> | null }>(tx, sql`select name, address from companies where deleted_at is null order by created_at limit 1`);
      const [s] = await tx.select().from(pharmaSettings);
      const shippers = await many<{ code: string }>(tx, sql`select code from serial_containers where item_id = ${q.itemId} and batch_no = ${q.batchNo} and level in ('shipper', 'pallet') order by code`);
      const address = co?.address ? [co.address.line1, co.address.city, co.address.pincode].filter(Boolean).join(', ') : '';
      const labels = [...Array(q.containers)].map((_, i) => {
        const ssccCode = shippers[i]?.code ?? null;
        const f = { productCode: item.code, apiName: item.name, brandName: q.brandName ?? null, manufacturer: co?.name ?? '', address, batchNo: q.batchNo, batchSize: q.batchSize ?? null, mfgDate: b?.mfgDate ?? null, expiryDate: b?.expiryDate ?? null, retestDate: q.retestDate ?? null, sscc: ssccCode, licenceNo: s?.manufacturingLicenceNo ?? null, storage: q.storage ?? null, importLicenceNo: s?.importLicenceNo ?? null };
        return { container: i + 1, fields: f, qr: apiQrContent(f) };
      });
      return { labels, missing: [!s?.manufacturingLicenceNo && 'manufacturing licence number', !b && 'batch record (dates)'].filter(Boolean) };
    });
  }

  // ---- DPCO --------------------------------------------------------------------------------------

  ceilings(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select c.id, c.item_id as "itemId", i.code as "itemCode", i.name as "itemName", i.mrp::float8 as mrp, c.ceiling_price as "ceilingPrice", c.notification, c.effective_from::text as "effectiveFrom"
            from dpco_ceilings c join items i on i.id = c.item_id order by i.code, c.effective_from desc`,
      ),
    );
  }

  addCeiling(auth: AuthContext, input: z.infer<typeof ceilingSchema>) {
    return this.database.run(auth, async (tx) => (await tx.insert(dpcoCeilings).values({ tenantId: auth.tenantId, ...input, notification: input.notification ?? null, createdBy: auth.userId }).returning())[0]);
  }

  /** Sales invoice lines priced above the ceiling, and MRPs above it. */
  dpcoCheck(auth: AuthContext, q: { from?: string; to?: string }) {
    const to = q.to ?? todayIST();
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    return this.database.run(auth, async (tx) => {
      const ceilings = (await tx.select().from(dpcoCeilings)).map((c) => ({ itemId: c.itemId, ceilingPrice: c.ceilingPrice, effectiveFrom: c.effectiveFrom, notification: c.notification }));
      if (!ceilings.length) return { from, to, sales: [], mrp: [] };
      const ids = [...new Set(ceilings.map((c) => c.itemId))];
      const lines = await many<{ invoice: string; date: string; itemId: string; item: string; unitPrice: number }>(
        tx,
        sql`select d.number as invoice, d.doc_date::text as date, l.item_id as "itemId", i.name as item, (l.rate::float8 / nullif(coalesce(l.conversion_factor, 1)::float8, 0)) as "unitPrice"
            from sales_invoice_lines l join documents d on d.id = l.invoice_id join items i on i.id = l.item_id
            where l.item_id in ${ids} and d.status not in ('cancelled', 'draft') and d.doc_date between ${from} and ${to}`,
      );
      const mrps = await many<{ itemId: string; item: string; mrp: number | null }>(tx, sql`select id as "itemId", name as item, mrp::float8 as mrp from items where id in ${ids}`);
      return { from, to, ...dpcoBreaches(ceilings, lines, mrps, to) };
    });
  }
}
