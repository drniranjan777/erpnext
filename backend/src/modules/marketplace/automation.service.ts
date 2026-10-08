import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { automationRuns, automations, DOC_TYPES, isDocType, type AutomationAction, type Transaction } from '@nextgen/database';
import { createHmac } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../notifications/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AUTOMATION_EVENTS, matches, render } from './automation-rules';
import { MarketplaceService } from './marketplace.service';
import { many } from '../../common/sql';

const QUEUE = 'automation.run';
const isPrivateHost = (u: URL) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|0\.0\.0\.0)/.test(u.hostname);

const condition = z.object({ field: z.string().trim().min(1).max(80), op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'exists']), value: z.union([z.string().max(200), z.number(), z.array(z.string().max(80)).max(50)]).optional() });
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify'), userIds: z.array(z.uuid()).max(50).optional(), roleIds: z.array(z.uuid()).max(20).optional(), title: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(2000) }),
  z.object({ type: z.literal('email'), to: z.email(), subject: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(5000) }),
  z.object({ type: z.literal('webhook'), url: z.url().refine((u) => u.startsWith('https://') || process.env.NODE_ENV !== 'production', 'Webhooks must use https') }),
  z.object({ type: z.literal('connector'), connector: z.string().min(2).max(40), action: z.string().min(2).max(40) }),
]);
export const automationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  event: z.enum(Object.keys(AUTOMATION_EVENTS) as [string, ...string[]]),
  conditions: z.array(condition).max(20).default([]),
  actions: z.array(action).min(1).max(10),
  enabled: z.boolean().default(true),
});
export const testSchema = z.object({ payload: z.record(z.string(), z.unknown()) });

/**
 * Low-code workflow automation: when an event happens (a document submitted, approved, rejected or
 * cancelled; a member joined; a connector imported orders or leads) and every condition holds on the
 * event's data, the actions run in the background: notify users or roles, send an email, call a
 * webhook (signed), or run a connector action (book a shipment for the delivery note, make a payment
 * link for the invoice). Texts take {{placeholders}} from the event data. Every run is logged.
 */
@Injectable()
export class AutomationService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly marketplace: MarketplaceService,
  ) {}

  onModuleInit() {
    this.webhooks.subscribe((tx, tenantId, event, data) => this.onEvent(tx, tenantId, event, data));
    this.jobs.register(QUEUE, (payload, ctx) => this.execute(ctx.tenantId, String(payload.runId)));
  }

  /** In the business transaction: match automations and queue a run for each. */
  private async onEvent(tx: Transaction, tenantId: string, event: string, data: Record<string, unknown>) {
    const list = await tx.select().from(automations).where(eq(automations.event, event));
    const payload = { event, ...data };
    for (const a of list.filter((x) => x.enabled && matches(x.conditions, payload))) {
      const [run] = await tx.insert(automationRuns).values({ tenantId, automationId: a.id, event, payload }).returning({ id: automationRuns.id });
      await this.jobs.enqueue(tx, tenantId, QUEUE, { runId: run.id }, { maxAttempts: 3 });
    }
  }

  private async execute(tenantId: string, runId: string) {
    const ctx = await this.database.run({ tenantId }, async (tx) => {
      const [run] = await tx.select().from(automationRuns).where(eq(automationRuns.id, runId));
      if (!run || run.status !== 'queued') return null;
      const [a] = await tx.select().from(automations).where(eq(automations.id, run.automationId));
      const [owner] = await many<{ userId: string }>(tx, sql`select user_id as "userId" from memberships where is_owner and status = 'active' limit 1`);
      return a ? { run, a, owner: owner?.userId ?? null } : null;
    });
    if (!ctx) return;
    const results: { action: string; ok: boolean; detail: string }[] = [];
    for (const act of ctx.a.actions) {
      try {
        results.push({ action: act.type, ok: true, detail: await this.perform(tenantId, ctx.owner, ctx.a.id, act, ctx.run.payload) });
      } catch (err) {
        results.push({ action: act.type, ok: false, detail: (err as Error).message });
      }
    }
    await this.database.run({ tenantId }, async (tx) => {
      await tx
        .update(automationRuns)
        .set({ status: results.every((r) => r.ok) ? 'ok' : 'failed', results, finishedAt: new Date() })
        .where(eq(automationRuns.id, runId));
      await tx.execute(sql`update automations set run_count = run_count + 1, last_run_at = now() where id = ${ctx.a.id}`);
    });
  }

  private async perform(tenantId: string, ownerId: string | null, automationId: string, act: AutomationAction, payload: Record<string, unknown>): Promise<string> {
    switch (act.type) {
      case 'notify': {
        const docType = String(payload.docType ?? '');
        const link = typeof payload.id === 'string' && isDocType(docType) ? `${DOC_TYPES[docType].path}/${payload.id}` : null;
        return this.database.run({ tenantId }, async (tx) => {
          const byRole = act.roleIds?.length ? await many<{ userId: string }>(tx, sql`select distinct m.user_id as "userId" from membership_roles r join memberships m on m.id = r.membership_id where r.role_id in ${act.roleIds} and m.status = 'active'`) : [];
          const ids = [...new Set([...(act.userIds ?? []), ...byRole.map((r) => r.userId)])];
          if (!ids.length) return 'No one to notify';
          await this.notifications.notify(tx, tenantId, 'automation.message', ids.map((userId) => ({ userId })), { title: render(act.title, payload), body: render(act.body, payload), link });
          return `Notified ${ids.length} user(s)`;
        });
      }
      case 'email': {
        const [t] = await this.database.run({ tenantId }, (tx) => many<{ name: string }>(tx, sql`select name from tenants where id = ${tenantId}`));
        await this.mail.send({ to: act.to, workspace: t?.name ?? '', message: { title: render(act.subject, payload), body: render(act.body, payload) } });
        return `Emailed ${act.to}`;
      }
      case 'webhook': {
        const url = new URL(act.url);
        if (process.env.NODE_ENV === 'production' && isPrivateHost(url)) throw new Error('Webhook to a private address refused');
        const body = JSON.stringify({ automationId, payload });
        const ts = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', automationId).update(`${ts}.${body}`).digest('hex');
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nextgen-automation': automationId, 'x-nextgen-signature': `t=${ts},v1=${sig}` }, body, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`Webhook answered ${res.status}`);
        return `Webhook answered ${res.status}`;
      }
      case 'connector': {
        if (!ownerId) throw new Error('The workspace has no owner to act for');
        const [inst] = await this.database.run({ tenantId }, (tx) => many<{ id: string }>(tx, sql`select id from app_installations where connector = ${act.connector}`));
        if (!inst) throw new Error(`${act.connector} is not installed`);
        const auth = { tenantId, userId: ownerId, membershipId: '', sessionId: 'automation', permissions: new Set<string>() } as unknown as AuthContext;
        const docType = payload.docType;
        const input = docType === 'delivery_note' ? { deliveryId: String(payload.id) } : docType === 'sales_invoice' ? { invoiceId: String(payload.id) } : {};
        const r = await this.marketplace.run(auth, inst.id, act.action, input);
        if (r.status === 'failed') throw new Error(r.log.join('; '));
        return r.log.join('; ') || r.status;
      }
    }
  }

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => ({ events: AUTOMATION_EVENTS, automations: await tx.select().from(automations).orderBy(automations.createdAt) }));
  }

  save(auth: AuthContext, id: string | null, input: z.infer<typeof automationSchema>) {
    return this.database.run(auth, async (tx) => {
      if (id) {
        const [r] = await tx.update(automations).set(input).where(eq(automations.id, id)).returning();
        if (!r) throw new NotFoundException('Automation not found');
        return r;
      }
      const [r] = await tx
        .insert(automations)
        .values({ tenantId: auth.tenantId, ...input, createdBy: auth.userId })
        .returning();
      return r;
    });
  }

  remove(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      await tx.delete(automations).where(eq(automations.id, id));
      return { ok: true };
    });
  }

  runs(auth: AuthContext, id: string) {
    return this.database.run(auth, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, id)).orderBy(desc(automationRuns.createdAt)).limit(50));
  }

  /** Dry run: would these conditions match this payload, and what would the texts say? */
  test(auth: AuthContext, id: string, payload: Record<string, unknown>) {
    return this.database.run(auth, async (tx) => {
      const [a] = await tx.select().from(automations).where(eq(automations.id, id));
      if (!a) throw new NotFoundException('Automation not found');
      const p = { event: a.event, ...payload };
      if (!Object.keys(payload).length) throw new BadRequestException('Give a sample payload');
      return {
        matches: matches(a.conditions, p),
        actions: a.actions.map((x) => (x.type === 'notify' ? { type: x.type, title: render(x.title, p), body: render(x.body, p) } : x.type === 'email' ? { type: x.type, to: x.to, subject: render(x.subject, p), body: render(x.body, p) } : x)),
      };
    });
  }
}
