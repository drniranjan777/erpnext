import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { dispensings, documents, formulas, items, jobCards, uoms, workOrderMaterials, workOrderOperations, workOrders } from '@nextgen/database';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import type { RequestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { ProductionService } from '../manufacturing/production.service';
import { adjustForAssay, withinTolerance, yieldOf } from './formula-math';

const D = Decimal.from;
const ZERO = D('0');

const qty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v) && Number(v) > 0, 'Quantity must be more than zero (up to 4 decimals)');

export const dispenseSchema = z.object({
  docDate: z.iso.date().optional(),
  lines: z
    .array(
      z.object({
        materialId: z.uuid(),
        qty,
        batchNo: optionalText(40),
        /** Assay of the lot, %; needed for potency-dosed ingredients. */
        assayPct: z
          .union([z.string(), z.number()])
          .nullable()
          .optional()
          .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
          .refine((v) => v === null || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 100), 'Assay: a percentage up to 100'),
        /** Weighed outside tolerance: why it is still accepted. */
        overrideReason: optionalText(300),
        checkedBy: optionalText(120),
      }),
    )
    .min(1)
    .max(100),
  notes: optionalText(1000),
});
export type DispenseInput = z.infer<typeof dispenseSchema>;

/**
 * Process batches on top of work orders: dispensing (weighing against target with tolerance,
 * potency-adjusted for the lot's assay) issues the material through the normal production
 * entry; yield compares the output with the formula's theoretical yield.
 */
@Injectable()
export class ProcessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly production: ProductionService,
  ) {}

  dispense(auth: AuthContext, woId: string, input: DispenseInput, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, woId));
      if (!wo) throw new NotFoundException('Batch not found');
      if (wo.kind !== 'batch') throw new ConflictException('Dispensing is for process batches; issue materials to other work orders');
      const mats = await tx.select({ m: workOrderMaterials, code: items.code }).from(workOrderMaterials).innerJoin(items, eq(items.id, workOrderMaterials.itemId)).where(eq(workOrderMaterials.workOrderId, woId));
      const done = await tx.select().from(dispensings).where(eq(dispensings.workOrderId, woId));
      // What is still to dispense per material, in standard-potency terms.
      const remaining = new Map<string, Decimal>();
      for (const x of mats) {
        const given = done.filter((d) => d.materialId === x.m.id).reduce((s, d) => s.add(this.stdEquivalent(d.qty, x.m.basis, x.m.stdPotency, d.assayPct)), ZERO);
        remaining.set(x.m.id, D(x.m.requiredQty).sub(given));
      }
      const errors: { path: string; message: string }[] = [];
      const records: (typeof dispensings.$inferInsert)[] = [];
      input.lines.forEach((l, i) => {
        const x = mats.find((m) => m.m.id === l.materialId);
        if (!x || x.m.kind !== 'component') return errors.push({ path: `lines.${i}.materialId`, message: `Line ${i + 1}: not an ingredient of this batch` });
        if (x.m.basis === 'potency' && !l.assayPct) return errors.push({ path: `lines.${i}.assayPct`, message: `${x.code} is dosed by potency: give the lot's assay` });
        const rest = remaining.get(x.m.id)!;
        const target = x.m.basis === 'potency' ? adjustForAssay(rest.cmp(ZERO) > 0 ? rest.toFixed(4) : '0', x.m.stdPotency, l.assayPct) : rest.cmp(ZERO) > 0 ? rest : ZERO;
        const ok = withinTolerance(l.qty, target, x.m.tolerancePct);
        if (!ok && !l.overrideReason) {
          errors.push({ path: `lines.${i}.qty`, message: `${x.code}: ${Number(l.qty)} is outside ±${Number(x.m.tolerancePct ?? 0)}% of the target ${Number(target.toFixed(4))}; reweigh or give a reason` });
          return;
        }
        remaining.set(x.m.id, rest.sub(this.stdEquivalent(l.qty, x.m.basis, x.m.stdPotency, l.assayPct)));
        records.push({ tenantId: auth.tenantId, workOrderId: woId, materialId: x.m.id, batchNo: l.batchNo, assayPct: l.assayPct, targetQty: target.toFixed(4), qty: l.qty, withinTolerance: ok, overrideReason: ok ? null : l.overrideReason, dispensedBy: auth.userId, checkedBy: l.checkedBy });
      });
      if (errors.length) throw new BadRequestException({ message: errors[0].message, errors });
      const entry = await this.production.issueTx(tx, auth, woId, { docDate: input.docDate, all: false, notes: input.notes ?? 'Dispensing', lines: input.lines.map((l) => ({ materialId: l.materialId, qty: l.qty, batchNo: l.batchNo, serialNos: null })) }, meta);
      await tx.insert(dispensings).values(records.map((r) => ({ ...r, entryId: entry.id })));
      return { entry: { id: entry.id, number: entry.number, materialValue: entry.materialValue }, dispensed: records.map((r) => ({ materialId: r.materialId, qty: r.qty, targetQty: r.targetQty, withinTolerance: r.withinTolerance })) };
    });
  }

  /** A weighing in standard-potency terms (what the formula quantity is written in). */
  private stdEquivalent(q: string, basis: string | null, stdPotency: string | null, assay: string | null) {
    return basis === 'potency' && assay ? D(q).mul(D(assay)).div(D(stdPotency ?? '100')) : D(q);
  }

  /** Dispensing record, stage readings and yield of a batch. */
  batch(auth: AuthContext, woId: string) {
    return this.database.run(auth, async (tx) => {
      const [wo] = await tx.select().from(workOrders).where(eq(workOrders.id, woId));
      if (!wo) throw new NotFoundException('Batch not found');
      const [f] = wo.formulaId ? await tx.select({ yieldPct: formulas.yieldPct, version: formulas.version, number: documents.number }).from(formulas).innerJoin(documents, eq(documents.id, formulas.id)).where(eq(formulas.id, wo.formulaId)) : [];
      const mats = await tx.select({ m: workOrderMaterials, code: items.code, name: items.name, uom: uoms.code }).from(workOrderMaterials).innerJoin(items, eq(items.id, workOrderMaterials.itemId)).innerJoin(uoms, eq(uoms.id, workOrderMaterials.uomId)).where(eq(workOrderMaterials.workOrderId, woId)).orderBy(asc(workOrderMaterials.lineNo));
      const weighings = await tx.select().from(dispensings).where(eq(dispensings.workOrderId, woId)).orderBy(asc(dispensings.dispensedAt));
      const readings = await tx
        .select({ seq: workOrderOperations.seq, stage: workOrderOperations.name, readings: jobCards.readings, endedAt: jobCards.endedAt, operator: jobCards.operatorName })
        .from(jobCards)
        .innerJoin(workOrderOperations, eq(workOrderOperations.id, jobCards.operationId))
        .where(and(eq(jobCards.workOrderId, woId), eq(jobCards.status, 'done')))
        .orderBy(asc(workOrderOperations.seq), asc(jobCards.endedAt));
      const input = mats.filter((x) => x.m.kind === 'component').reduce((s, x) => s.add(D(x.m.issuedQty)), ZERO);
      const y = yieldOf(input.toFixed(4), f?.yieldPct ?? '100', wo.producedQty);
      return {
        formula: f ? { number: f.number, version: f.version, yieldPct: f.yieldPct } : null,
        batchNo: wo.batchNo,
        yield: { input: input.toFixed(4), output: wo.producedQty, ...y },
        materials: mats.map((x) => ({ id: x.m.id, kind: x.m.kind, code: x.code, name: x.name, uom: x.uom, basis: x.m.basis, stdPotency: x.m.stdPotency, tolerancePct: x.m.tolerancePct, requiredQty: x.m.requiredQty, issuedQty: x.m.issuedQty })),
        dispensings: weighings.map((d) => ({ ...d, code: mats.find((x) => x.m.id === d.materialId)?.code })),
        readings: readings.filter((r) => r.readings?.length),
        outOfRange: readings.flatMap((r) => (r.readings ?? []).filter((x) => !x.ok).map((x) => ({ stage: `${r.seq} ${r.stage}`, ...x }))),
      };
    });
  }
}
