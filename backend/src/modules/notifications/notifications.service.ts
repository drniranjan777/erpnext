import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  membershipRoles,
  memberships,
  notificationDeliveries,
  notificationPreferences,
  notifications,
  tenants,
  type Transaction,
  users,
} from '@nextgen/database';
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { JobsService, PermanentJobError } from '../jobs/jobs.service';
import { eventDefinition, NOTIFICATION_EVENTS, type Channel, type EventData, type NotificationEvent, type Rendered } from './events';
import { MailService } from './mail.service';
import { WhatsAppService } from './whatsapp.service';

export type Recipient = { userId: string } | { email: string; name?: string | null };

const DELIVER_QUEUE = 'notifications.deliver';

interface DeliverPayload {
  deliveryId: string;
  channel: 'email' | 'whatsapp';
  to: string;
  toName: string | null;
  workspace: string;
  message: Rendered;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsAppService,
    private readonly entitlements: EntitlementsService,
  ) {}

  onModuleInit() {
    this.jobs.register(DELIVER_QUEUE, (payload, ctx) => this.deliver(payload as unknown as DeliverPayload, ctx.tenantId));
  }

  /**
   * Fans an event out to recipients over their enabled channels. Call inside the
   * business transaction: notifications exist iff the change commits.
   */
  async notify<E extends NotificationEvent>(tx: Transaction, tenantId: string, event: E, recipients: Recipient[], data: EventData<E>) {
    const def = eventDefinition(event)!;
    const message = def.render(data as never);
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    const workspace = tenant?.name ?? 'NextGen ERP';

    const userIds = [...new Set(recipients.flatMap((r) => ('userId' in r ? [r.userId] : [])))];
    const people = userIds.length
      ? await tx
          .select({ id: users.id, email: users.email, name: users.fullName, mobile: users.mobile, status: users.status })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
    const prefs = userIds.length
      ? await tx
          .select()
          .from(notificationPreferences)
          .where(and(inArray(notificationPreferences.userId, userIds), eq(notificationPreferences.event, event)))
      : [];
    const whatsappAllowed = this.whatsapp.enabled && (await this.entitlements.get(tenantId)).features.includes('whatsapp');
    const enabled = (userId: string, channel: Channel) => {
      if (def.mandatory && def.defaults[channel]) return true;
      return prefs.find((p) => p.userId === userId && p.channel === channel)?.enabled ?? def.defaults[channel];
    };

    for (const p of people) {
      if (p.status === 'disabled') continue;
      if (enabled(p.id, 'in_app')) {
        await tx.insert(notifications).values({ tenantId, userId: p.id, event, title: message.title, body: message.body, link: message.link });
      }
      if (enabled(p.id, 'email')) await this.queueDelivery(tx, tenantId, event, 'email', p.email, p.name, p.id, workspace, message);
      if (whatsappAllowed && enabled(p.id, 'whatsapp') && p.mobile) {
        await this.queueDelivery(tx, tenantId, event, 'whatsapp', p.mobile, p.name, p.id, workspace, message);
      }
    }
    for (const r of recipients) {
      if ('email' in r && def.defaults.email) await this.queueDelivery(tx, tenantId, event, 'email', r.email, r.name ?? null, null, workspace, message);
    }
  }

  /** Active members of the tenant who hold the role (for approver notifications). */
  async usersWithRole(tx: Transaction, roleId: string): Promise<string[]> {
    const rows = await tx
      .select({ userId: memberships.userId })
      .from(membershipRoles)
      .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
      .where(and(eq(membershipRoles.roleId, roleId), eq(memberships.status, 'active')));
    return rows.map((r) => r.userId);
  }

  private async queueDelivery(
    tx: Transaction,
    tenantId: string,
    event: string,
    channel: 'email' | 'whatsapp',
    to: string,
    toName: string | null,
    userId: string | null,
    workspace: string,
    message: Rendered,
  ) {
    const [delivery] = await tx
      .insert(notificationDeliveries)
      .values({
        tenantId,
        event,
        channel,
        recipient: to,
        userId,
        subject: message.title,
        provider: channel === 'email' ? this.mail.provider : this.whatsapp.providerName,
      })
      .returning({ id: notificationDeliveries.id });
    const payload: DeliverPayload = { deliveryId: delivery.id, channel, to, toName, workspace, message };
    const jobId = await this.jobs.enqueue(tx, tenantId, DELIVER_QUEUE, payload as unknown as Record<string, unknown>);
    await tx.update(notificationDeliveries).set({ jobId }).where(eq(notificationDeliveries.id, delivery.id));
  }

  /** Job handler: sends one message and records the outcome. */
  private async deliver(p: DeliverPayload, tenantId: string) {
    const [delivery] = await this.database.run({ tenantId }, (tx) =>
      tx.select({ status: notificationDeliveries.status }).from(notificationDeliveries).where(eq(notificationDeliveries.id, p.deliveryId)),
    );
    if (!delivery) throw new PermanentJobError('Delivery record not found');
    if (delivery.status === 'sent') return; // idempotent on retry

    try {
      const result =
        p.channel === 'email'
          ? await this.mail.send({ to: p.to, toName: p.toName, workspace: p.workspace, message: p.message })
          : await this.whatsapp.send(p.to, p.message, this.mail.absoluteUrl(p.message.link));
      await this.database.run({ tenantId }, (tx) =>
        tx
          .update(notificationDeliveries)
          .set({ status: 'sent', sentAt: new Date(), providerMessageId: result.messageId, error: null })
          .where(eq(notificationDeliveries.id, p.deliveryId)),
      );
    } catch (err) {
      await this.database.run({ tenantId }, (tx) =>
        tx
          .update(notificationDeliveries)
          .set({ status: 'failed', error: (err as Error).message.slice(0, 1000) })
          .where(eq(notificationDeliveries.id, p.deliveryId)),
      );
      throw err;
    }
  }

  // ---- In-app inbox (the signed-in user's own notifications) ------------------------

  list(auth: AuthContext, q: { unread?: boolean; cursor?: string; limit: number }) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select({
          id: notifications.id,
          event: notifications.event,
          title: notifications.title,
          body: notifications.body,
          link: notifications.link,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, auth.userId),
            q.unread ? isNull(notifications.readAt) : undefined,
            q.cursor ? lt(notifications.id, q.cursor) : undefined,
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    });
  }

  unreadCount(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const [row] = await tx
        .select({ n: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, auth.userId), isNull(notifications.readAt)));
      return { unread: Number(row?.n ?? 0) };
    });
  }

  markRead(auth: AuthContext, id: string | 'all') {
    return this.database.run(auth, async (tx) => {
      const res = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, auth.userId), isNull(notifications.readAt), id === 'all' ? undefined : eq(notifications.id, id)))
        .returning({ id: notifications.id });
      if (id !== 'all' && !res.length) throw new NotFoundException('Notification not found or already read');
      return { marked: res.length };
    });
  }

  // ---- Preferences ----------------------------------------------------------------------

  preferences(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const saved = await tx
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, auth.userId));
      return Object.entries(NOTIFICATION_EVENTS).map(([event, def]) => ({
        event,
        label: def.label,
        description: def.description,
        group: def.group,
        mandatory: !!(def as { mandatory?: boolean }).mandatory,
        channels: (['in_app', 'email', 'whatsapp'] as Channel[]).map((channel) => ({
          channel,
          available: channel !== 'whatsapp' || this.whatsapp.enabled,
          enabled: saved.find((p) => p.event === event && p.channel === channel)?.enabled ?? def.defaults[channel],
        })),
      }));
    });
  }

  updatePreferences(auth: AuthContext, changes: { event: string; channel: Channel; enabled: boolean }[]) {
    for (const c of changes) {
      const def = eventDefinition(c.event);
      if (!def) throw new BadRequestException(`Unknown event ${c.event}`);
      if (def.mandatory && !c.enabled && def.defaults[c.channel]) {
        throw new BadRequestException(`"${def.label}" ${c.channel === 'in_app' ? 'in-app' : c.channel} alerts can't be turned off`);
      }
    }
    return this.database.run(auth, async (tx) => {
      for (const c of changes) {
        await tx
          .insert(notificationPreferences)
          .values({ tenantId: auth.tenantId, userId: auth.userId, event: c.event, channel: c.channel, enabled: c.enabled })
          .onConflictDoUpdate({
            target: [notificationPreferences.tenantId, notificationPreferences.userId, notificationPreferences.event, notificationPreferences.channel],
            set: { enabled: c.enabled, updatedAt: new Date() },
          });
      }
      return { saved: changes.length };
    });
  }

  // ---- Admin: outbound message log ---------------------------------------------------------

  deliveries(auth: AuthContext, q: { cursor?: string; limit: number }) {
    return this.database.run(auth, async (tx) => {
      const rows = await tx
        .select()
        .from(notificationDeliveries)
        .where(q.cursor ? lt(notificationDeliveries.id, q.cursor) : undefined)
        .orderBy(desc(notificationDeliveries.id))
        .limit(q.limit + 1);
      const hasMore = rows.length > q.limit;
      const items = (hasMore ? rows.slice(0, q.limit) : rows).map(({ tenantId: _t, ...r }) => r);
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    });
  }
}
