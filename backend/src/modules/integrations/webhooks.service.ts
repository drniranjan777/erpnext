import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tenants, webhookDeliveries, webhookEndpoints, type Transaction } from '@nextgen/database';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import type { RequestMeta } from '../../common/request-meta';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { JobsService, PermanentJobError } from '../jobs/jobs.service';

/** Events a webhook can subscribe to ("*" = all). */
export const WEBHOOK_EVENTS = {
  'document.submitted': 'A document was submitted',
  'document.approved': 'A document was fully approved',
  'document.rejected': 'A document was rejected',
  'document.cancelled': 'A document was cancelled',
  'member.joined': 'A user joined the workspace',
  'connector.orders_imported': 'A connector imported an online order',
  'connector.leads_imported': 'A connector imported a lead',
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

const eventsSchema = z
  .array(z.string())
  .min(1, 'Choose at least one event')
  .refine((e) => e.every((x) => x === '*' || x in WEBHOOK_EVENTS), 'Unknown event');

export const createWebhookSchema = z.object({
  url: z.url().max(500),
  description: z.string().trim().max(200).optional().nullable(),
  events: eventsSchema,
});
export const updateWebhookSchema = z.object({
  version: z.number().int(),
  url: z.url().max(500).optional(),
  description: z.string().trim().max(200).optional().nullable(),
  events: eventsSchema.optional(),
  isActive: z.boolean().optional(),
});

const QUEUE = 'webhooks.deliver';
const TIMEOUT_MS = 10_000;

/**
 * Signed outgoing webhooks. Each delivery is a job (retried with backoff).
 * Signature header: `X-NextGen-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 */
@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly allowPrivate: boolean;
  private readonly production: boolean;

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    config: ConfigService<Env, true>,
  ) {
    this.allowPrivate = config.get('WEBHOOKS_ALLOW_PRIVATE', { infer: true });
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  onModuleInit() {
    this.jobs.register(QUEUE, (payload, ctx) => this.deliver(String(payload.deliveryId), ctx.tenantId));
  }

  /** Queues the event for every subscribed active endpoint. Call inside the business transaction. */
  private readonly subscribers: ((tx: Transaction, tenantId: string, event: WebhookEvent, data: Record<string, unknown>) => Promise<void>)[] = [];

  /** In-process listeners (workflow automations) called for every event, in the same transaction. */
  subscribe(fn: (tx: Transaction, tenantId: string, event: WebhookEvent, data: Record<string, unknown>) => Promise<void>) {
    this.subscribers.push(fn);
  }

  async emit(tx: Transaction, tenantId: string, event: WebhookEvent, data: Record<string, unknown>) {
    for (const s of this.subscribers) await s(tx, tenantId, event, data);
    const endpoints = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.isActive, true));
    const targets = endpoints.filter((e) => e.events.includes('*') || e.events.includes(event));
    if (!targets.length) return;
    const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    for (const ep of targets) {
      const [d] = await tx
        .insert(webhookDeliveries)
        .values({ tenantId, endpointId: ep.id, event, payload: {} })
        .returning({ id: webhookDeliveries.id });
      const payload = { id: d.id, event, createdAt: new Date().toISOString(), workspace: t?.slug, data };
      await tx.update(webhookDeliveries).set({ payload }).where(eq(webhookDeliveries.id, d.id));
      await this.jobs.enqueue(tx, tenantId, QUEUE, { deliveryId: d.id }, { maxAttempts: 8 });
    }
  }

  // ---- Admin -------------------------------------------------------------------

  list(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt));
      return rows.map(({ secretEncrypted: _s, tenantId: _t, ...r }) => r);
    });
  }

  async create(auth: AuthContext, input: z.infer<typeof createWebhookSchema>, meta: RequestMeta) {
    await this.entitlements.assertFeature(auth.tenantId, 'webhooks');
    await this.assertSafeUrl(input.url);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return this.database.run(auth, async (tx) => {
      await this.entitlements.assertLimit(tx, auth.tenantId, 'webhooks');
      const [row] = await tx
        .insert(webhookEndpoints)
        .values({
          tenantId: auth.tenantId,
          url: input.url,
          description: input.description ?? null,
          events: [...new Set(input.events)],
          secretEncrypted: this.crypto.encrypt(secret),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })
        .returning({ id: webhookEndpoints.id, url: webhookEndpoints.url, events: webhookEndpoints.events });
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'platform.webhook.created', entityType: 'webhook', entityId: row.id, metadata: { url: row.url, events: row.events }, ...meta });
      return { ...row, secret }; // shown once
    });
  }

  async update(auth: AuthContext, id: string, input: z.infer<typeof updateWebhookSchema>, meta: RequestMeta) {
    if (input.url) await this.assertSafeUrl(input.url);
    return this.database.run(auth, async (tx) => {
      const [before] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
      if (!before) throw new NotFoundException('Webhook not found');
      if (before.version !== input.version) throw new BadRequestException('This webhook was changed by someone else. Reload and try again.');
      if (input.isActive && !before.isActive) await this.entitlements.assertLimit(tx, auth.tenantId, 'webhooks');
      const { version: _v, ...patch } = input;
      await tx.update(webhookEndpoints).set({ ...patch, updatedBy: auth.userId, version: before.version + 1 }).where(eq(webhookEndpoints.id, id));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'platform.webhook.updated', entityType: 'webhook', entityId: id, metadata: patch, ...meta });
      return { id };
    });
  }

  async rotateSecret(auth: AuthContext, id: string, meta: RequestMeta) {
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await this.database.run(auth, async (tx) => {
      const res = await tx.update(webhookEndpoints).set({ secretEncrypted: this.crypto.encrypt(secret), updatedBy: auth.userId }).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
      if (!res.length) throw new NotFoundException('Webhook not found');
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'platform.webhook.secret_rotated', entityType: 'webhook', entityId: id, ...meta });
    });
    return { secret };
  }

  async remove(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.database.run(auth, async (tx) => {
      const res = await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning({ url: webhookEndpoints.url });
      if (!res.length) throw new NotFoundException('Webhook not found');
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'platform.webhook.deleted', entityType: 'webhook', entityId: id, metadata: res[0], ...meta });
    });
  }

  /** Sends a `ping` event now to check the endpoint. */
  async test(auth: AuthContext, id: string) {
    return this.database.run(auth, async (tx) => {
      const [ep] = await tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
      if (!ep) throw new NotFoundException('Webhook not found');
      const [d] = await tx
        .insert(webhookDeliveries)
        .values({ tenantId: auth.tenantId, endpointId: id, event: 'ping', payload: {} })
        .returning({ id: webhookDeliveries.id });
      await tx
        .update(webhookDeliveries)
        .set({ payload: { id: d.id, event: 'ping', createdAt: new Date().toISOString(), data: { message: 'Hello from NextGen ERP' } } })
        .where(eq(webhookDeliveries.id, d.id));
      await this.jobs.enqueue(tx, auth.tenantId, QUEUE, { deliveryId: d.id }, { maxAttempts: 1 });
      return { deliveryId: d.id };
    });
  }

  deliveries(auth: AuthContext, endpointId: string) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          id: webhookDeliveries.id,
          event: webhookDeliveries.event,
          status: webhookDeliveries.status,
          attempts: webhookDeliveries.attempts,
          responseStatus: webhookDeliveries.responseStatus,
          responseBody: webhookDeliveries.responseBody,
          error: webhookDeliveries.error,
          durationMs: webhookDeliveries.durationMs,
          createdAt: webhookDeliveries.createdAt,
          lastAttemptAt: webhookDeliveries.lastAttemptAt,
        })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, endpointId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(50),
    );
  }

  async redeliver(auth: AuthContext, deliveryId: string) {
    return this.database.run(auth, async (tx) => {
      const [d] = await tx.update(webhookDeliveries).set({ status: 'pending', error: null }).where(eq(webhookDeliveries.id, deliveryId)).returning({ id: webhookDeliveries.id });
      if (!d) throw new NotFoundException('Delivery not found');
      await this.jobs.enqueue(tx, auth.tenantId, QUEUE, { deliveryId }, { maxAttempts: 1 });
      return { queued: true };
    });
  }

  // ---- Delivery (job handler) ------------------------------------------------------

  private async deliver(deliveryId: string, tenantId: string) {
    const row = await this.database.run({ tenantId }, async (tx) => {
      const [r] = await tx
        .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
        .from(webhookDeliveries)
        .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
        .where(eq(webhookDeliveries.id, deliveryId));
      return r;
    });
    if (!row) throw new PermanentJobError('Delivery or endpoint no longer exists');
    if (row.delivery.status === 'succeeded') return;
    if (!row.endpoint.isActive && row.delivery.event !== 'ping') throw new PermanentJobError('Endpoint is disabled');

    const body = JSON.stringify(row.delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', this.crypto.decrypt(row.endpoint.secretEncrypted)).update(`${timestamp}.${body}`).digest('hex');
    const started = Date.now();
    let status: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      await this.assertSafeUrl(row.endpoint.url); // re-check at send time (DNS may have changed)
      const res = await fetch(row.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'NextGen-ERP-Webhooks/1.0',
          'x-nextgen-event': row.delivery.event,
          'x-nextgen-delivery': deliveryId,
          'x-nextgen-signature': `t=${timestamp},v1=${signature}`,
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      responseBody = (await res.text().catch(() => '')).slice(0, 500);
      if (status < 200 || status >= 300) error = `Endpoint responded ${status}`;
    } catch (err) {
      error = err instanceof Error ? (err.name === 'TimeoutError' ? `No response within ${TIMEOUT_MS / 1000}s` : err.message) : String(err);
    }
    await this.database.run({ tenantId }, (tx) =>
      tx
        .update(webhookDeliveries)
        .set({
          status: error ? 'failed' : 'succeeded',
          attempts: row.delivery.attempts + 1,
          responseStatus: status,
          responseBody,
          error,
          durationMs: Date.now() - started,
          lastAttemptAt: new Date(),
        })
        .where(and(eq(webhookDeliveries.id, deliveryId))),
    );
    if (error) throw new Error(error); // job retries with backoff
  }

  /** SSRF guard: HTTPS in production, and no private/loopback/link-local targets unless allowed (dev). */
  private async assertSafeUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('Enter a valid URL');
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !this.production)) {
      throw new BadRequestException('Webhook URLs must use https://');
    }
    if (this.allowPrivate) return;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!addresses.length) throw new BadRequestException('Webhook host could not be resolved');
    if (addresses.some(isPrivateAddress)) throw new BadRequestException('Webhook URLs must point to a public internet address');
  }
}

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
