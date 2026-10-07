import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { inspectionParameters, inspectionPlans, items, parties, type Transaction } from '@nextgen/database';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { optionalText } from '../../common/validators';
import { DatabaseService } from '../../database/database.service';
import { AQLS, LEVELS } from './aql';

const limit = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()))
  .refine((v) => v === null || /^-?\d{1,12}(\.\d{1,6})?$/.test(v), 'A number');

export const planSchema = z
  .object({
    code: z.string().trim().min(1).max(30),
    name: z.string().trim().min(2).max(120),
    itemId: z.uuid(),
    stage: z.enum(['incoming', 'in_process', 'final']),
    operationSeq: z.number().int().min(1).max(9999).nullable().optional(),
    sampling: z.enum(['aql', 'full', 'fixed']).default('aql'),
    inspectionLevel: z.enum(LEVELS).default('II'),
    aql: z.enum(AQLS).default('2.5'),
    fixedSampleSize: z.number().int().min(1).max(10000).nullable().optional(),
    /** A specification for one vendor (incoming) or customer (final). */
    partyId: z.uuid().nullable().optional(),
    /** Skip-lot: after this many accepted lots in a row, inspect one lot in `skipEvery`. */
    skipLotAfter: z.number().int().min(1).max(100).nullable().optional(),
    skipEvery: z.number().int().min(2).max(20).nullable().optional(),
    isActive: z.boolean().default(true),
    instructions: optionalText(2000),
    parameters: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          kind: z.enum(['numeric', 'attribute']).default('numeric'),
          unit: optionalText(20),
          nominal: limit,
          lowerLimit: limit,
          upperLimit: limit,
          isCritical: z.boolean().default(false),
          method: optionalText(120),
        }),
      )
      .min(1, 'Add at least one characteristic to check')
      .max(100),
  })
  .superRefine((p, ctx) => {
    if (p.sampling === 'fixed' && !p.fixedSampleSize) ctx.addIssue({ code: 'custom', path: ['fixedSampleSize'], message: 'Give the sample size' });
    if (p.stage !== 'in_process' && p.operationSeq) ctx.addIssue({ code: 'custom', path: ['operationSeq'], message: 'Only in-process plans are tied to an operation' });
    if (p.stage === 'in_process' && p.partyId) ctx.addIssue({ code: 'custom', path: ['partyId'], message: 'Vendor or customer specifications are for incoming or final inspection' });
    if (!!p.skipLotAfter !== !!p.skipEvery) ctx.addIssue({ code: 'custom', path: ['skipEvery'], message: 'Skip-lot needs both the run of accepted lots and how often to inspect' });
    if (p.skipLotAfter && p.stage !== 'incoming') ctx.addIssue({ code: 'custom', path: ['skipLotAfter'], message: 'Skip-lot applies to incoming inspection' });
    p.parameters.forEach((x, i) => {
      if (x.kind === 'numeric' && x.lowerLimit === null && x.upperLimit === null) ctx.addIssue({ code: 'custom', path: ['parameters', i, 'lowerLimit'], message: `${x.name}: give a lower or upper limit` });
      if (x.lowerLimit !== null && x.upperLimit !== null && Number(x.lowerLimit) > Number(x.upperLimit)) ctx.addIssue({ code: 'custom', path: ['parameters', i, 'upperLimit'], message: `${x.name}: upper limit is below the lower` });
    });
  });
export type PlanInput = z.infer<typeof planSchema>;

/** Inspection plans: per item and stage, the characteristics to check and how to sample. */
@Injectable()
export class PlansService {
  constructor(private readonly database: DatabaseService) {}

  list(auth: AuthContext, q: { itemId?: string; stage?: string }) {
    return this.database.run(auth, async (tx) => {
      const plans = await tx
        .select({ p: inspectionPlans, item: { id: items.id, code: items.code, name: items.name }, partyName: parties.name, partyCode: parties.code })
        .from(inspectionPlans)
        .innerJoin(items, eq(items.id, inspectionPlans.itemId))
        .leftJoin(parties, eq(parties.id, inspectionPlans.partyId))
        .where(and(q.itemId ? eq(inspectionPlans.itemId, q.itemId) : undefined, q.stage ? eq(inspectionPlans.stage, q.stage) : undefined))
        .orderBy(asc(inspectionPlans.code));
      const params = plans.length ? await tx.select().from(inspectionParameters).orderBy(asc(inspectionParameters.seq)) : [];
      return plans.map(({ p: { tenantId: _t, ...p }, item, partyName, partyCode }) => ({ ...p, item, party: p.partyId ? { id: p.partyId, code: partyCode, name: partyName } : null, parameters: params.filter((x) => x.planId === p.id).map(({ tenantId: _pt, planId: _p, ...x }) => x) }));
    });
  }

  save(auth: AuthContext, id: string | null, input: PlanInput) {
    return this.database.run(auth, async (tx) => {
      const [it] = await tx.select({ id: items.id, type: items.type }).from(items).where(eq(items.id, input.itemId));
      if (!it) throw new BadRequestException({ message: 'Item not found', errors: [{ path: 'itemId', message: 'Item not found' }] });
      const { parameters, ...head } = input;
      const values = { ...head, operationSeq: head.operationSeq ?? null, fixedSampleSize: head.sampling === 'fixed' ? (head.fixedSampleSize ?? null) : null, partyId: head.partyId ?? null, skipLotAfter: head.skipLotAfter ?? null, skipEvery: head.skipEvery ?? null, updatedBy: auth.userId };
      let planId = id;
      try {
        if (id) {
          const [r] = await tx.update(inspectionPlans).set({ ...values, updatedAt: new Date() }).where(eq(inspectionPlans.id, id)).returning({ id: inspectionPlans.id });
          if (!r) throw new NotFoundException('Plan not found');
          await tx.delete(inspectionParameters).where(eq(inspectionParameters.planId, id));
        } else {
          const [r] = await tx.insert(inspectionPlans).values({ ...values, tenantId: auth.tenantId, createdBy: auth.userId }).returning({ id: inspectionPlans.id });
          planId = r.id;
        }
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505' || (e as { code?: string }).code === '23505') throw new ConflictException(`Plan code ${input.code} is already used`);
        throw e;
      }
      await tx.insert(inspectionParameters).values(parameters.map((x, i) => ({ ...x, tenantId: auth.tenantId, planId: planId!, seq: i + 1 })));
      return { id: planId };
    });
  }

  /**
   * The active plan for an item at a stage: in-process, for that operation, else a general one;
   * incoming / final, the vendor's or customer's own specification, else the general one.
   */
  async planFor(tx: Transaction, itemId: string, stage: string, operationSeq?: number | null, partyId?: string | null) {
    const rows = await tx
      .select()
      .from(inspectionPlans)
      .where(and(eq(inspectionPlans.itemId, itemId), eq(inspectionPlans.stage, stage), eq(inspectionPlans.isActive, true), stage === 'in_process' ? or(isNull(inspectionPlans.operationSeq), eq(inspectionPlans.operationSeq, operationSeq ?? -1)) : undefined))
      .orderBy(asc(inspectionPlans.code));
    if (stage === 'in_process') return rows.find((r) => r.operationSeq !== null && r.operationSeq === operationSeq) ?? rows.find((r) => r.operationSeq === null) ?? null;
    return (partyId ? rows.find((r) => r.partyId === partyId) : undefined) ?? rows.find((r) => r.partyId === null) ?? null;
  }
}
