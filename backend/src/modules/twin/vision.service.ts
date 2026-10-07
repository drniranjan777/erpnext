import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { visionDeployments, visionInspections, visionModels, type Transaction } from '@nextgen/database';
import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { IotService } from '../iot/iot.service';
import { parseTs } from '../iot/rules';
import { MesService } from '../mes/mes.service';
import { defectBurst, visionDrift, visionStats, type InspectionRow } from './vision-monitor';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;

export const modelSchema = z.object({
  name: z.string().trim().min(2).max(80),
  version: z.string().trim().min(1).max(40),
  classes: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
  minConfidence: z.number().min(0).max(1).default(0.6),
  artifactUrl: z.string().trim().max(1000).nullable().optional(),
  validation: z.object({ precision: z.number().min(0).max(1).optional(), recall: z.number().min(0).max(1).optional(), samples: z.number().int().min(0).optional() }).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export const deploySchema = z.object({ gatewayIds: z.array(z.uuid()).min(1).max(50) });
export const reviewSchema = z.object({ review: z.enum(['correct', 'wrong']), actualClass: z.string().trim().max(60).nullable().optional() });
export const inspectionsSchema = z.object({
  inspections: z
    .array(
      z.object({
        ref: z.string().trim().min(1).max(80),
        t: z.union([z.number(), z.string().max(40)]),
        model: z.string().trim().min(1).max(80),
        version: z.string().trim().min(1).max(40),
        machine: z.string().trim().max(60).nullable().optional(),
        result: z.enum(['ok', 'defect']),
        defectClass: z.string().trim().max(60).nullable().optional(),
        confidence: z.number().min(0).max(1),
        imageUrl: z.string().trim().max(1000).nullable().optional(),
        latencyMs: z.number().int().min(0).max(600_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

/**
 * Edge AI for visual inspection: model versions deployed to gateways, the results they send,
 * people's reviews, and monitoring (defect rate, confidence, accuracy, drift). A burst of
 * defects at a machine calls quality on the Andon board.
 */
@Injectable()
export class VisionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly iot: IotService,
    private readonly mes: MesService,
  ) {}

  models(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select m.id, m.name, m.version, m.classes, m.min_confidence as "minConfidence", m.artifact_url as "artifactUrl", m.validation, m.status, m.deployed_at as "deployedAt", m.notes,
              coalesce((select json_agg(json_build_object('gatewayCode', g.code, 'status', c.status, 'result', c.result)) from vision_deployments d join iot_gateways g on g.id = d.gateway_id
                left join iot_commands c on c.id = d.command_id where d.model_id = m.id), '[]') as deployments
            from vision_models m order by m.name, m.created_at desc`,
      ),
    );
  }

  createModel(auth: AuthContext, input: z.infer<typeof modelSchema>) {
    return this.database.run(auth, async (tx) => {
      const [dup] = await tx.select({ id: visionModels.id }).from(visionModels).where(and(eq(visionModels.name, input.name), eq(visionModels.version, input.version)));
      if (dup) throw new ConflictException(`${input.name} ${input.version} already exists`);
      const [m] = await tx
        .insert(visionModels)
        .values({ tenantId: auth.tenantId, ...input, artifactUrl: input.artifactUrl ?? null, validation: input.validation ?? null, notes: input.notes ?? null, createdBy: auth.userId })
        .returning();
      return m;
    });
  }

  /** Sends the model to gateways; other versions of the same model are retired. */
  deploy(auth: AuthContext, id: string, gatewayIds: string[]) {
    return this.database.run(auth, async (tx) => {
      const [m] = await tx.select().from(visionModels).where(eq(visionModels.id, id));
      if (!m) throw new NotFoundException('Model not found');
      if (m.status === 'retired') throw new ConflictException('This version is retired');
      for (const gatewayId of gatewayIds) {
        const cmd = await this.iot.deployCommand(tx, auth.tenantId, gatewayId, { id: m.id, name: m.name, version: m.version, classes: m.classes, minConfidence: m.minConfidence, artifactUrl: m.artifactUrl }, m.id);
        await tx
          .insert(visionDeployments)
          .values({ tenantId: auth.tenantId, modelId: m.id, gatewayId, commandId: cmd.id })
          .onConflictDoUpdate({ target: [visionDeployments.tenantId, visionDeployments.modelId, visionDeployments.gatewayId], set: { commandId: cmd.id, createdAt: new Date() } });
      }
      await tx.update(visionModels).set({ status: 'retired' }).where(and(eq(visionModels.name, m.name), ne(visionModels.id, m.id), eq(visionModels.status, 'deployed')));
      const [r] = await tx.update(visionModels).set({ status: 'deployed', deployedAt: new Date() }).where(eq(visionModels.id, id)).returning();
      return r;
    });
  }

  /** Results from a gateway (device token). Replays are ignored by their reference. */
  async ingest(token: string | undefined, input: z.infer<typeof inspectionsSchema>) {
    const res = await this.iot.device(token, async (tx, g) => {
      const models = await tx.select({ id: visionModels.id, name: visionModels.name, version: visionModels.version }).from(visionModels);
      const codes = [...new Set(input.inspections.map((i) => i.machine).filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
      const machines = codes.length ? await many<{ id: string; code: string }>(tx, sql`select id, code from machines where lower(code) in ${codes}`) : [];
      let accepted = 0;
      let rejected = 0;
      const touched = new Set<string>();
      for (const i of input.inspections) {
        const ts = parseTs(i.t);
        const model = models.find((m) => m.name === i.model && m.version === i.version);
        if (!ts || ts.getTime() > Date.now() + 5 * 60_000) {
          rejected++;
          continue;
        }
        const machine = i.machine ? machines.find((m) => m.code.toLowerCase() === i.machine!.toLowerCase()) : undefined;
        const [card] = machine
          ? await many<{ id: string }>(tx, sql`select id from job_cards where machine_id = ${machine.id} and started_at <= ${ts.toISOString()} and (ended_at is null or ended_at >= ${ts.toISOString()}) order by started_at desc limit 1`)
          : [];
        const r = await tx
          .insert(visionInspections)
          .values({
            tenantId: g.tenantId,
            gatewayId: g.id,
            modelId: model?.id ?? null,
            machineId: machine?.id ?? null,
            jobCardId: card?.id ?? null,
            ref: i.ref,
            ts,
            result: i.result,
            defectClass: i.result === 'defect' ? (i.defectClass ?? null) : null,
            confidence: i.confidence,
            imageUrl: i.imageUrl ?? null,
            latencyMs: i.latencyMs ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: visionInspections.id });
        if (r.length) {
          accepted++;
          if (machine && i.result === 'defect') touched.add(machine.id);
        }
      }
      const bursts: string[] = [];
      for (const machineId of touched) {
        const last = await many<{ result: 'ok' | 'defect' }>(tx, sql`select result from vision_inspections where machine_id = ${machineId} order by ts desc limit 50`);
        if (defectBurst(last.map((x) => x.result))) bursts.push(machineId);
      }
      return { accepted, rejected, duplicates: input.inspections.length - accepted - rejected, bursts, tenantId: g.tenantId, actor: g.createdBy };
    });
    for (const machineId of res.bursts) {
      if (!res.actor) break;
      await this.mes
        .raiseCall({ tenantId: res.tenantId, userId: res.actor } as AuthContext, { machineId, kind: 'quality', note: 'Vision inspection: many defects in the last parts' })
        .catch(() => undefined);
    }
    return { accepted: res.accepted, rejected: res.rejected, duplicates: res.duplicates, qualityCalls: res.bursts.length };
  }

  inspections(auth: AuthContext, q: { machineId?: string; modelId?: string; result?: 'ok' | 'defect'; toReview?: boolean; limit: number }) {
    return this.database.run(auth, (tx) =>
      many(
        tx,
        sql`select v.id, v.ts, v.result, v.defect_class as "defectClass", v.confidence, v.image_url as "imageUrl", v.latency_ms as "latencyMs", v.review, v.actual_class as "actualClass",
              m.code as "machineCode", vm.name as "modelName", vm.version as "modelVersion", vm.min_confidence as "minConfidence", d.number as "workOrderNumber"
            from vision_inspections v left join machines m on m.id = v.machine_id left join vision_models vm on vm.id = v.model_id
            left join job_cards jc on jc.id = v.job_card_id left join documents d on d.id = jc.work_order_id
            where true ${q.machineId ? sql`and v.machine_id = ${q.machineId}` : sql``} ${q.modelId ? sql`and v.model_id = ${q.modelId}` : sql``}
              ${q.result ? sql`and v.result = ${q.result}` : sql``} ${q.toReview ? sql`and v.review is null and (v.result = 'defect' or v.confidence < coalesce(vm.min_confidence, 0.6))` : sql``}
            order by v.ts desc limit ${q.limit}`,
      ),
    );
  }

  review(auth: AuthContext, id: string, input: z.infer<typeof reviewSchema>) {
    return this.database.run(auth, async (tx) => {
      const [r] = await tx
        .update(visionInspections)
        .set({ review: input.review, actualClass: input.actualClass ?? null, reviewedBy: auth.userId, reviewedAt: new Date() })
        .where(eq(visionInspections.id, id))
        .returning({ id: visionInspections.id });
      if (!r) throw new NotFoundException('Inspection not found');
      return { ok: true };
    });
  }

  /** Per deployed model: the last 24 hours against the 7 days before, by machine and by defect class. */
  monitoring(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const models = await tx.select().from(visionModels).where(inArray(visionModels.status, ['deployed', 'retired']));
      const out = [];
      for (const m of models) {
        const rows = await many<InspectionRow & { recent: boolean; machineCode: string | null }>(
          tx,
          sql`select v.result, v.defect_class as "defectClass", v.confidence, v.review, v.actual_class as "actualClass", (v.ts > now() - interval '1 day') as recent, mc.code as "machineCode"
              from vision_inspections v left join machines mc on mc.id = v.machine_id where v.model_id = ${m.id} and v.ts > now() - interval '8 days'`,
        );
        if (!rows.length && m.status === 'retired') continue;
        const recent = visionStats(rows.filter((r) => r.recent), m.minConfidence);
        const baseline = visionStats(rows.filter((r) => !r.recent), m.minConfidence);
        const machines = [...new Set(rows.filter((r) => r.recent).map((r) => r.machineCode ?? '–'))].map((code) => ({ machineCode: code, ...visionStats(rows.filter((r) => r.recent && (r.machineCode ?? '–') === code), m.minConfidence) }));
        out.push({ id: m.id, name: m.name, version: m.version, status: m.status, validation: m.validation, recent, baseline, drift: visionDrift(recent, baseline), machines });
      }
      return out;
    });
  }
}
