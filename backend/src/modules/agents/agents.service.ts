import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { aiActionLog, aiAgents, aiRecommendations, aiRuns, aiSettings, memberships, type AgentGuardrails, type Transaction } from '@nextgen/database';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { todayIST } from '../../common/fiscal-year';
import { loadPermissions } from '../../common/guards';
import type { RequestMeta } from '../../common/request-meta';
import { DatabaseService } from '../../database/database.service';
import { JobsService } from '../jobs/jobs.service';
import { AgentActions } from './actions.service';
import { inventoryAgent } from './definitions/inventory';
import { purchaseAgent } from './definitions/purchase';
import { canAutoExecute, nextRun, type AgentDefinition, type Finding } from './framework';

const many = async <T extends Record<string, unknown>>(tx: Transaction, q: SQL) => (await tx.execute<T>(q)).rows;
const QUEUE = 'agents.run';
const SYSTEM_META: RequestMeta = { ip: null, userAgent: 'ai-agent', requestId: 'agent' };

export const agentConfigSchema = z.object({
  enabled: z.boolean(),
  schedule: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
  runHour: z.number().int().min(0).max(23).default(7),
  guardrails: z
    .object({
      maxAmount: z.number().min(0).max(1e10).nullable().optional(),
      autoExecute: z.boolean().default(false),
      autoExecuteBelow: z.number().min(0).max(1e10).nullable().optional(),
      params: z.record(z.string(), z.number()).optional(),
    })
    .default({ autoExecute: false }),
});
export const decideSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).nullable().optional() });
export const killSchema = z.object({ killed: z.boolean(), reason: z.string().trim().max(300).nullable().optional() });

/**
 * The agent framework: agents run on a schedule (or on demand) inside the workspace's row
 * security, turn findings into AI Inbox recommendations (each raised once), and execute their
 * proposed actions only when a person approves, or automatically within the guardrails as the
 * person who switched that on. Everything executed is logged; a kill switch stops it all.
 */
@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger('Agents');
  private readonly defs = new Map<string, AgentDefinition>();

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly actions: AgentActions,
  ) {
    for (const d of [inventoryAgent, purchaseAgent]) this.defs.set(d.code, d);
  }

  /** Lets other modules add agents. */
  define(def: AgentDefinition) {
    this.defs.set(def.code, def);
  }

  onModuleInit() {
    this.jobs.register(QUEUE, async (payload, ctx) => {
      const code = String(payload.code);
      const sys = { tenantId: ctx.tenantId, userId: null as unknown as string };
      const [cfg] = await this.database.run(sys, (tx) => tx.select().from(aiAgents).where(eq(aiAgents.code, code)));
      if (!cfg?.enabled) return;
      try {
        await this.runAgent(ctx.tenantId, code, 'schedule');
      } finally {
        await this.database.run(sys, async (tx) => {
          const [fresh] = await tx.select().from(aiAgents).where(eq(aiAgents.code, code));
          if (fresh?.enabled) await this.scheduleNext(tx, ctx.tenantId, fresh.code, fresh.schedule, fresh.runHour);
        });
      }
    });
  }

  private def(code: string) {
    const d = this.defs.get(code);
    if (!d) throw new NotFoundException(`No agent ${code}`);
    return d;
  }

  private async scheduleNext(tx: Transaction, tenantId: string, code: string, schedule: string, hour: number) {
    const at = nextRun(schedule, hour, new Date());
    await this.jobs.enqueue(tx, tenantId, QUEUE, { code }, { runAt: at, dedupeKey: `agent:${code}:${at.toISOString()}`, maxAttempts: 2 });
    await tx.update(aiAgents).set({ nextRunAt: at }).where(eq(aiAgents.code, code));
  }

  private params(def: AgentDefinition, g: AgentGuardrails) {
    return Object.fromEntries(Object.entries(def.params).map(([k, p]) => [k, g.params?.[k] ?? p.default]));
  }

  // ---- settings --------------------------------------------------------------------------------

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const cfgs = await tx.select().from(aiAgents);
      const [s] = await tx.select().from(aiSettings);
      const open = await many<{ agentCode: string; n: number }>(tx, sql`select agent_code as "agentCode", count(*)::int as n from ai_recommendations where status = 'open' group by 1`);
      return {
        killed: s?.killed ?? false,
        killReason: s?.killReason ?? null,
        killedAt: s?.killedAt ?? null,
        agents: [...this.defs.values()].map((d) => {
          const c = cfgs.find((x) => x.code === d.code);
          return {
            code: d.code,
            name: d.name,
            description: d.description,
            watches: d.watches,
            params: d.params,
            enabled: c?.enabled ?? false,
            schedule: c?.schedule ?? d.defaultSchedule,
            runHour: c?.runHour ?? 7,
            guardrails: c?.guardrails ?? {},
            actorUserId: c?.actorUserId ?? null,
            lastRunAt: c?.lastRunAt ?? null,
            nextRunAt: c?.nextRunAt ?? null,
            lastStatus: c?.lastStatus ?? null,
            open: open.find((o) => o.agentCode === d.code)?.n ?? 0,
          };
        }),
      };
    });
  }

  save(auth: AuthContext, code: string, input: z.infer<typeof agentConfigSchema>) {
    this.def(code);
    return this.database.run(auth, async (tx) => {
      const g: AgentGuardrails = { ...input.guardrails };
      const values = { enabled: input.enabled, schedule: input.schedule, runHour: input.runHour, guardrails: g, updatedBy: auth.userId, updatedAt: new Date(), ...(g.autoExecute ? { actorUserId: auth.userId } : { actorUserId: null }) };
      await tx.insert(aiAgents).values({ tenantId: auth.tenantId, code, ...values }).onConflictDoUpdate({ target: [aiAgents.tenantId, aiAgents.code], set: values });
      if (input.enabled) await this.scheduleNext(tx, auth.tenantId, code, input.schedule, input.runHour);
      else await tx.update(aiAgents).set({ nextRunAt: null }).where(eq(aiAgents.code, code));
      return (await tx.select().from(aiAgents).where(eq(aiAgents.code, code)))[0];
    });
  }

  kill(auth: AuthContext, input: z.infer<typeof killSchema>) {
    return this.database.run(auth, async (tx) => {
      const values = { killed: input.killed, killReason: input.killed ? (input.reason ?? null) : null, killedBy: input.killed ? auth.userId : null, killedAt: input.killed ? new Date() : null, updatedAt: new Date() };
      await tx.insert(aiSettings).values({ tenantId: auth.tenantId, ...values }).onConflictDoUpdate({ target: aiSettings.tenantId, set: values });
      return { killed: input.killed };
    });
  }

  private async killed(tx: Transaction) {
    const [s] = await tx.select({ killed: aiSettings.killed }).from(aiSettings);
    return !!s?.killed;
  }

  // ---- running ---------------------------------------------------------------------------------

  runNow(auth: AuthContext, code: string) {
    this.def(code);
    return this.runAgent(auth.tenantId, code, 'manual');
  }

  /** Runs one agent: records the run, raises new findings, expires resolved ones, then auto-executes within guardrails. */
  async runAgent(tenantId: string, code: string, trigger: 'schedule' | 'manual' | 'event') {
    const def = this.def(code);
    const sys = { tenantId, userId: null as unknown as string };
    const prepared = await this.database.run(sys, async (tx) => {
      const [cfg] = await tx.select().from(aiAgents).where(eq(aiAgents.code, code));
      if (await this.killed(tx)) {
        const [r] = await tx.insert(aiRuns).values({ tenantId, agentCode: code, trigger, status: 'skipped', error: 'kill switch is on', finishedAt: new Date() }).returning();
        return { run: r, auto: [] as { id: string }[], cfg };
      }
      const [run] = await tx.insert(aiRuns).values({ tenantId, agentCode: code, trigger }).returning();
      return { run, auto: [] as { id: string }[], cfg };
    });
    if (prepared.run.status === 'skipped') return prepared.run;
    const g = prepared.cfg?.guardrails ?? {};
    let created: { id: string; action: Finding['action'] }[] = [];
    let findings = 0;
    try {
      ({ created, findings } = await this.database.run(sys, async (tx) => {
        const found = await def.run({ tx, tenantId, today: todayIST(), params: this.params(def, g) });
        const keys = found.map((f) => f.dedupeKey);
        const blocked = keys.length
          ? await many<{ dedupeKey: string }>(
              tx,
              sql`select distinct dedupe_key as "dedupeKey" from ai_recommendations where agent_code = ${code} and dedupe_key in ${keys}
                  and (status = 'open' or (status = 'dismissed' and decided_at > now() - interval '14 days') or (status in ('accepted', 'executed') and decided_at > now() - interval '7 days'))`,
            )
          : [];
        const skip = new Set(blocked.map((b) => b.dedupeKey));
        const fresh = found.filter((f) => !skip.has(f.dedupeKey));
        const rows = fresh.length
          ? await tx
              .insert(aiRecommendations)
              .values(
                fresh.map((f) => ({
                  tenantId,
                  agentCode: code,
                  runId: prepared.run.id,
                  kind: f.kind,
                  severity: f.severity,
                  title: f.title,
                  body: f.body,
                  evidence: f.evidence,
                  entityType: f.entityType ?? null,
                  entityId: f.entityId ?? null,
                  link: f.link ?? null,
                  dedupeKey: f.dedupeKey,
                  action: f.action ?? null,
                  confidence: f.confidence != null ? f.confidence.toFixed(2) : null,
                  permission: f.permission ?? null,
                  expiresAt: new Date(Date.now() + (f.expiresInDays ?? 14) * 86_400_000),
                })),
              )
              .returning({ id: aiRecommendations.id, action: aiRecommendations.action })
          : [];
        // What the agent no longer finds has resolved itself.
        await tx.execute(sql`update ai_recommendations set status = 'expired' where agent_code = ${code} and status = 'open' ${keys.length ? sql`and dedupe_key not in ${keys}` : sql``}`);
        return { created: rows, findings: found.length };
      }));
    } catch (e) {
      await this.database.run(sys, async (tx) => {
        await tx.update(aiRuns).set({ status: 'failed', error: (e as Error).message.slice(0, 1000), finishedAt: new Date() }).where(eq(aiRuns.id, prepared.run.id));
        await tx.update(aiAgents).set({ lastRunAt: new Date(), lastStatus: 'failed' }).where(eq(aiAgents.code, code));
      });
      this.logger.warn(`Agent ${code} failed for ${tenantId}: ${(e as Error).message}`);
      throw e;
    }
    let executed = 0;
    const actorAuth = prepared.cfg?.actorUserId ? await this.actorAuth(tenantId, prepared.cfg.actorUserId) : null;
    for (const r of created) {
      if (!canAutoExecute(g, r.action, !!actorAuth).ok) continue;
      try {
        await this.execute(actorAuth!, r.id, 'auto', SYSTEM_META);
        executed++;
      } catch {
        // Recorded on the recommendation by execute(); the run carries on.
      }
    }
    return this.database.run(sys, async (tx) => {
      await tx.update(aiAgents).set({ lastRunAt: new Date(), lastStatus: 'ok' }).where(eq(aiAgents.code, code));
      return (await tx.update(aiRuns).set({ status: 'ok', findings, created: created.length, executed, finishedAt: new Date() }).where(eq(aiRuns.id, prepared.run.id)).returning())[0];
    });
  }

  private async actorAuth(tenantId: string, userId: string): Promise<AuthContext | null> {
    const [m] = await this.database.run({ tenantId, userId }, (tx) => tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, 'active'))));
    return m ? { tenantId, userId, membershipId: m.id, sessionId: `agent:${userId}` } : null;
  }

  // ---- inbox -------------------------------------------------------------------------------------

  async inbox(auth: AuthContext, q: { status?: string; agent?: string }) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    return this.database.run(auth, async (tx) => {
      await tx.execute(sql`update ai_recommendations set status = 'expired' where status = 'open' and expires_at < now()`);
      const rows = await many<{ permission: string | null }>(
        tx,
        sql`select r.id, r.agent_code as "agentCode", r.kind, r.severity, r.title, r.body, r.evidence, r.entity_type as "entityType", r.entity_id as "entityId", r.link, r.action, r.confidence, r.permission, r.status,
                   r.decision_note as "decisionNote", r.decided_at as "decidedAt", u.full_name as "decidedBy", r.auto_executed as "autoExecuted", r.result, r.error, r.created_at as "createdAt", r.expires_at as "expiresAt"
            from ai_recommendations r left join users u on u.id = r.decided_by
            where r.status = ${q.status ?? 'open'} ${q.agent ? sql`and r.agent_code = ${q.agent}` : sql``}
            order by case r.severity when 'critical' then 0 when 'warning' then 1 else 2 end, r.created_at desc limit 300`,
      );
      return rows.filter((r) => !r.permission || perms.has(r.permission));
    });
  }

  /** Approve (execute the action, or just accept a finding with none) or dismiss, with a note. */
  async decide(auth: AuthContext, id: string, input: z.infer<typeof decideSchema>, meta: RequestMeta) {
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    const rec = await this.database.run(auth, async (tx) => (await tx.select().from(aiRecommendations).where(eq(aiRecommendations.id, id)).for('update'))[0]);
    if (!rec) throw new NotFoundException('Recommendation not found');
    if (rec.permission && !perms.has(rec.permission)) throw new ForbiddenException(`Needs ${rec.permission}`);
    if (rec.status !== 'open' && rec.status !== 'failed') throw new ConflictException(`Already ${rec.status}`);
    if (!input.approve) {
      if (!input.note) throw new BadRequestException('Say why, so the agent can be tuned');
      return this.database.run(auth, async (tx) => (await tx.update(aiRecommendations).set({ status: 'dismissed', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: input.note }).where(eq(aiRecommendations.id, id)).returning())[0]);
    }
    if (!rec.action) {
      return this.database.run(auth, async (tx) => (await tx.update(aiRecommendations).set({ status: 'accepted', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: input.note ?? null }).where(eq(aiRecommendations.id, id)).returning())[0]);
    }
    return this.execute({ ...auth, permissions: perms }, id, 'approved', meta, input.note ?? null);
  }

  /** Runs a recommendation's action as `auth`, checking the kill switch and the action's permission; logs it either way. */
  private async execute(auth: AuthContext, id: string, mode: 'approved' | 'auto', meta: RequestMeta, note: string | null = null) {
    const rec = await this.database.run(auth, async (tx) => {
      if (await this.killed(tx)) throw new ConflictException('The AI kill switch is on');
      return (await tx.select().from(aiRecommendations).where(eq(aiRecommendations.id, id)))[0];
    });
    const action = rec.action!;
    const handler = this.actions.get(action.type);
    const perms = auth.permissions ?? (await loadPermissions(this.database, auth.tenantId, auth.userId, auth.membershipId));
    let status: 'executed' | 'failed' = 'executed';
    let result: Record<string, unknown> | null = null;
    let error: string | null = null;
    try {
      if (!perms.has(handler.permission)) throw new ForbiddenException(`${mode === 'auto' ? 'The agent’s actor' : 'You'} need ${handler.permission} to do this`);
      result = await handler.run(auth, action.params, meta);
    } catch (e) {
      status = 'failed';
      error = (e as Error).message;
    }
    const updated = await this.database.run(auth, async (tx) => {
      await tx.insert(aiActionLog).values({ tenantId: auth.tenantId, recommendationId: id, agentCode: rec.agentCode, actionType: action.type, params: action.params, mode, actorUserId: auth.userId, status, result, error });
      return (await tx.update(aiRecommendations).set({ status, result, error, autoExecuted: mode === 'auto', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: note }).where(eq(aiRecommendations.id, id)).returning())[0];
    });
    if (status === 'failed' && mode === 'approved') throw new BadRequestException(error ?? 'The action failed');
    return updated;
  }

  // ---- history and evaluation ------------------------------------------------------------------

  runs(auth: AuthContext, code?: string) {
    return this.database.run(auth, (tx) => many(tx, sql`select id, agent_code as "agentCode", trigger, status, findings, created, executed, error, started_at as "startedAt", finished_at as "finishedAt" from ai_runs where true ${code ? sql`and agent_code = ${code}` : sql``} order by started_at desc limit 100`));
  }

  actionLog(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      many(tx, sql`select l.id, l.agent_code as "agentCode", l.action_type as "actionType", l.mode, l.status, l.result, l.error, l.at, u.full_name as actor, r.title from ai_action_log l left join users u on u.id = l.actor_user_id left join ai_recommendations r on r.id = l.recommendation_id order by l.at desc limit 300`),
    );
  }

  /**
   * Evaluation per agent over a period: how many it raised, how people decided, acceptance rate
   * (accepted or executed out of decided), action failures, time to decide, and dismissal reasons.
   */
  evaluate(auth: AuthContext, days: number) {
    return this.database.run(auth, async (tx) => {
      const rows = await many<{ agentCode: string; kind: string; raised: number; accepted: number; dismissed: number; executed: number; failed: number; expired: number; open: number; auto: number; hoursToDecide: string | null }>(
        tx,
        sql`select agent_code as "agentCode", kind, count(*)::int as raised, count(*) filter (where status = 'accepted')::int as accepted, count(*) filter (where status = 'dismissed')::int as dismissed,
                   count(*) filter (where status = 'executed')::int as executed, count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status = 'expired')::int as expired,
                   count(*) filter (where status = 'open')::int as open, count(*) filter (where auto_executed)::int as auto,
                   round(avg(extract(epoch from decided_at - created_at) / 3600) filter (where decided_at is not null and not auto_executed)::numeric, 1)::text as "hoursToDecide"
            from ai_recommendations where created_at > now() - make_interval(days => ${days}::int) group by 1, 2 order by 1, 2`,
      );
      const reasons = await many<{ agentCode: string; note: string; n: number }>(
        tx,
        sql`select agent_code as "agentCode", decision_note as note, count(*)::int as n from ai_recommendations where status = 'dismissed' and created_at > now() - make_interval(days => ${days}::int) group by 1, 2 order by 3 desc limit 50`,
      );
      return rows.map((r) => {
        const decided = r.accepted + r.executed + r.dismissed + r.failed;
        return { ...r, acceptancePct: decided ? Math.round(((r.accepted + r.executed) / decided) * 1000) / 10 : null, dismissalReasons: reasons.filter((x) => x.agentCode === r.agentCode).slice(0, 5) };
      });
    });
  }

  actionTypes() {
    return this.actions.types();
  }

  /** For tests and the run-now button of every agent at once. */
  async runAll(auth: AuthContext) {
    const enabled = await this.database.run(auth, (tx) => tx.select({ code: aiAgents.code }).from(aiAgents).where(and(eq(aiAgents.enabled, true), inArray(aiAgents.code, [...this.defs.keys()]))));
    const out = [];
    for (const a of enabled) out.push(await this.runAgent(auth.tenantId, a.code, 'manual'));
    return out;
  }
}
