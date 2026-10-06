import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  billingEvents,
  companies,
  GST_RATE_PERCENT,
  isPlanCode,
  memberships,
  PLAN_CODES,
  PLANS,
  saasInvoices,
  subscriptions,
  tenants,
  type PlanCode,
  type Transaction,
  users,
} from '@nextgen/database';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { Decimal } from '../../common/decimal';
import { fiscalYearOf } from '../../common/fiscal-year';
import type { RequestMeta } from '../../common/request-meta';
import type { Env } from '../../config/env';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SAAS_INVOICE_TEMPLATE } from '../customization/default-templates';
import { PrintService } from '../customization/print.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EntitlementsService } from './entitlements.service';
import { BillingProvider } from './providers';

type Cycle = 'monthly' | 'yearly';

@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');
  private readonly seller: { name: string; gstin: string; stateCode: string; address: string };

  constructor(
    private readonly database: DatabaseService,
    private readonly provider: BillingProvider,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly print: PrintService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.seller = {
      name: config.get('SAAS_SELLER_NAME', { infer: true }),
      gstin: config.get('SAAS_SELLER_GSTIN', { infer: true }),
      stateCode: config.get('SAAS_SELLER_STATE_CODE', { infer: true }),
      address: config.get('SAAS_SELLER_ADDRESS', { infer: true }),
    };
  }

  plans() {
    return PLAN_CODES.filter((c) => PLANS[c].purchasable).map((code) => {
      const p = PLANS[code];
      const withGst = (n: number) => Decimal.from(n).mul(Decimal.from(1 + GST_RATE_PERCENT / 100)).toFixed(2);
      return {
        code,
        ...p,
        gstRatePercent: GST_RATE_PERCENT,
        priceMonthlyWithGst: withGst(p.priceMonthly),
        priceYearlyWithGst: withGst(p.priceYearly),
        yearlySavingsPercent: Math.round((1 - p.priceYearly / (p.priceMonthly * 12)) * 100),
      };
    });
  }

  async summary(auth: AuthContext) {
    const entitlements = await this.entitlements.get(auth.tenantId);
    return this.database.run(auth, async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, auth.tenantId));
      const usage = await this.entitlements.usage(tx);
      return {
        entitlements,
        usage,
        subscription: sub
          ? { status: sub.status, planCode: sub.planCode, cycle: sub.cycle, provider: sub.provider, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd }
          : null,
        provider: this.provider.name,
      };
    });
  }

  async checkout(auth: AuthContext, planCode: string, cycle: Cycle, meta: RequestMeta) {
    if (!isPlanCode(planCode) || !PLANS[planCode].purchasable) throw new BadRequestException('Choose a valid plan');
    return this.database.run(auth, async (tx) => {
      // Downgrades must fit the target plan's limits.
      const usage = await this.entitlements.usage(tx);
      const limits = PLANS[planCode].limits;
      const over = (Object.keys(limits) as (keyof typeof limits)[]).filter((k) => usage[k] > limits[k]);
      if (over.length) {
        throw new ConflictException(`Your current usage exceeds the ${PLANS[planCode].name} plan (${over.join(', ')}). Reduce usage or pick a bigger plan.`);
      }
      const [me] = await tx.select({ email: users.email, name: users.fullName }).from(users).where(eq(users.id, auth.userId));
      const session = await this.provider.createCheckout({ tenantId: auth.tenantId, planCode, cycle, customerEmail: me.email, customerName: me.name });
      await tx
        .update(subscriptions)
        .set({ pendingPlanCode: planCode, pendingCycle: cycle, pendingCheckoutId: session.checkoutId, updatedBy: auth.userId })
        .where(eq(subscriptions.tenantId, auth.tenantId));
      await this.audit.log(tx, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: 'billing.checkout.started',
        entityType: 'subscription',
        metadata: { planCode, cycle, provider: session.provider },
        ...meta,
      });
      return session;
    });
  }

  /** Built-in test checkout: completes the pending payment without moving money. */
  async confirmTestCheckout(auth: AuthContext, checkoutId: string, meta: RequestMeta) {
    if (this.provider.name !== 'mock') throw new BadRequestException('Test payments are disabled. Use the payment provider checkout.');
    return this.database.run(auth, async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, auth.tenantId)).for('update');
      if (!sub || sub.pendingCheckoutId !== checkoutId || !sub.pendingPlanCode || !sub.pendingCycle) {
        throw new NotFoundException('Checkout not found or already completed');
      }
      const start = new Date();
      const invoice = await this.activate(tx, auth.tenantId, sub.pendingPlanCode as PlanCode, sub.pendingCycle, start, this.addCycle(start, sub.pendingCycle), {
        provider: 'mock',
        providerSubscriptionId: checkoutId,
        paymentId: `pay_test_${Date.now().toString(36)}`,
        actorUserId: auth.userId,
        meta,
      });
      return { status: 'active', invoiceId: invoice.id, invoiceNumber: invoice.number };
    });
  }

  async cancel(auth: AuthContext, meta: RequestMeta) {
    return this.database.run(auth, async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, auth.tenantId)).for('update');
      if (!sub || sub.status !== 'active') throw new ConflictException('There is no active paid subscription to cancel');
      await this.provider.cancel(sub.provider === 'razorpay' ? sub.providerSubscriptionId : null);
      await tx.update(subscriptions).set({ status: 'cancelled', cancelAtPeriodEnd: true, updatedBy: auth.userId }).where(eq(subscriptions.id, sub.id));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'billing.subscription.cancelled', entityType: 'subscription', entityId: sub.id, metadata: { periodEnd: sub.currentPeriodEnd }, ...meta });
      this.entitlements.invalidate(auth.tenantId);
      return { status: 'cancelled', accessUntil: sub.currentPeriodEnd };
    });
  }

  async resume(auth: AuthContext, meta: RequestMeta) {
    if (this.provider.name === 'razorpay') throw new BadRequestException('Start a new checkout to resume a Razorpay subscription');
    return this.database.run(auth, async (tx) => {
      const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, auth.tenantId));
      if (!sub || sub.status !== 'cancelled' || !sub.currentPeriodEnd || sub.currentPeriodEnd < new Date()) {
        throw new ConflictException('Nothing to resume. Choose a plan instead.');
      }
      await tx.update(subscriptions).set({ status: 'active', cancelAtPeriodEnd: false, updatedBy: auth.userId }).where(eq(subscriptions.id, sub.id));
      await this.audit.log(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'billing.subscription.resumed', entityType: 'subscription', entityId: sub.id, ...meta });
      this.entitlements.invalidate(auth.tenantId);
      return { status: 'active' };
    });
  }

  listInvoices(auth: AuthContext) {
    return this.database.run(auth, (tx) =>
      tx
        .select({
          id: saasInvoices.id,
          number: saasInvoices.number,
          invoiceDate: saasInvoices.invoiceDate,
          description: saasInvoices.description,
          total: saasInvoices.total,
          status: saasInvoices.status,
          periodStart: saasInvoices.periodStart,
          periodEnd: saasInvoices.periodEnd,
        })
        .from(saasInvoices)
        .orderBy(desc(saasInvoices.createdAt)),
    );
  }

  async renderInvoice(auth: AuthContext, id: string) {
    const invoice = await this.database.run(auth, async (tx) => {
      const [inv] = await tx.select().from(saasInvoices).where(eq(saasInvoices.id, id));
      return inv;
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const html = this.print.render(
      SAAS_INVOICE_TEMPLATE,
      '',
      { invoice, seller: { name: this.seller.name, gstin: invoice.sellerGstin, stateCode: invoice.sellerStateCode, address: this.seller.address }, intraState: !Decimal.from(invoice.cgst).isZero(), doc: { displayNumber: invoice.number } },
      'A4',
    );
    return { html, title: invoice.number };
  }

  // ---- Razorpay webhooks -------------------------------------------------------

  async handleRazorpayEvent(rawBody: Buffer, signature: string | undefined, eventId: string | undefined) {
    if (!this.provider.verifyWebhook(rawBody, signature)) throw new BadRequestException('Invalid signature');
    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload: { subscription?: { entity: RazorpaySubscription }; payment?: { entity: { id: string } } };
    };
    const sub = event.payload.subscription?.entity;
    const tenantId = sub?.notes?.tenant_id;
    if (!sub || !tenantId) {
      this.logger.warn(`Ignoring Razorpay event ${event.event}: no subscription/tenant`);
      return { ignored: true };
    }
    const key = eventId ?? `${event.event}:${sub.id}:${event.payload.payment?.entity.id ?? sub.current_start}`;

    return this.database.run({ tenantId }, async (tx) => {
      const [fresh] = await tx
        .insert(billingEvents)
        .values({ tenantId, provider: 'razorpay', eventId: key, eventType: event.event, payload: event as unknown as Record<string, unknown> })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (!fresh) return { duplicate: true };

      const planCode = sub.notes?.plan_code;
      const cycle = (sub.notes?.cycle as Cycle | undefined) ?? 'monthly';
      switch (event.event) {
        case 'subscription.charged':
          if (!planCode || !isPlanCode(planCode)) throw new BadRequestException('Missing plan in subscription notes');
          await this.activate(tx, tenantId, planCode, cycle, new Date(sub.current_start * 1000), new Date(sub.current_end * 1000), {
            provider: 'razorpay',
            providerSubscriptionId: sub.id,
            paymentId: event.payload.payment?.entity.id ?? null,
            actorUserId: null,
            meta: { ip: null, userAgent: 'razorpay-webhook', requestId: key },
          });
          break;
        case 'subscription.halted':
        case 'subscription.pending':
          await tx.update(subscriptions).set({ status: 'past_due' }).where(eq(subscriptions.tenantId, tenantId));
          break;
        case 'subscription.cancelled':
        case 'subscription.completed':
          await tx.update(subscriptions).set({ status: 'cancelled', cancelAtPeriodEnd: true }).where(eq(subscriptions.tenantId, tenantId));
          break;
      }
      this.entitlements.invalidate(tenantId);
      return { ok: true };
    });
  }

  // ---- helpers ----------------------------------------------------------------------

  /** Moves the tenant onto a paid plan for a period and issues the GST invoice. */
  private async activate(
    tx: Transaction,
    tenantId: string,
    planCode: PlanCode,
    cycle: Cycle,
    periodStart: Date,
    periodEnd: Date,
    opts: { provider: string; providerSubscriptionId: string | null; paymentId: string | null; actorUserId: string | null; meta: RequestMeta },
  ) {
    await tx.update(tenants).set({ planCode, status: 'active' }).where(eq(tenants.id, tenantId));
    await tx
      .update(subscriptions)
      .set({
        planCode,
        cycle,
        status: 'active',
        provider: opts.provider,
        providerSubscriptionId: opts.providerSubscriptionId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        pendingPlanCode: null,
        pendingCycle: null,
        pendingCheckoutId: null,
      })
      .where(eq(subscriptions.tenantId, tenantId));

    const invoice = await this.issueInvoice(tx, tenantId, planCode, cycle, periodStart, periodEnd, opts.provider, opts.paymentId);
    await this.audit.log(tx, {
      tenantId,
      actorUserId: opts.actorUserId,
      action: 'billing.subscription.activated',
      entityType: 'subscription',
      metadata: { planCode, cycle, periodEnd, invoice: invoice.number, total: invoice.total },
      ...opts.meta,
    });
    const owners = await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.isOwner, true), eq(memberships.status, 'active')));
    if (owners.length) {
      await this.notifications.notify(tx, tenantId, 'billing.payment_received', owners, {
        plan: PLANS[planCode].name,
        amount: new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(invoice.total)),
        invoice: invoice.number,
        until: periodEnd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }),
      });
    }
    this.entitlements.invalidate(tenantId);
    return invoice;
  }

  private async issueInvoice(tx: Transaction, tenantId: string, planCode: PlanCode, cycle: Cycle, periodStart: Date, periodEnd: Date, provider: string, paymentId: string | null) {
    const plan = PLANS[planCode];
    const [buyer] = await tx
      .select({ name: companies.legalName, fallback: companies.name, gstin: companies.gstin, stateCode: companies.stateCode })
      .from(companies)
      .where(isNull(companies.deletedAt))
      .orderBy(asc(companies.createdAt))
      .limit(1);
    const taxable = Decimal.from(cycle === 'monthly' ? plan.priceMonthly : plan.priceYearly);
    const intraState = !!buyer?.stateCode && buyer.stateCode === this.seller.stateCode;
    const half = taxable.mul(Decimal.from('0.09'));
    const igst = taxable.mul(Decimal.from('0.18'));
    const cgst = intraState ? half.toFixed(2) : '0.00';
    const sgst = intraState ? half.toFixed(2) : '0.00';
    const igstAmt = intraState ? '0.00' : igst.toFixed(2);
    const total = Decimal.sum([taxable.toFixed(2), cgst, sgst, igstAmt]).toFixed(2);

    const invoiceDate = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const res = await tx.execute<{ n: string }>(sql`select saas_next_invoice_number(${fiscalYearOf(invoiceDate).label}) as n`);
    const [row] = await tx
      .insert(saasInvoices)
      .values({
        tenantId,
        number: res.rows[0].n,
        invoiceDate,
        description: `NextGen ERP ${plan.name} plan, ${cycle} subscription`,
        planCode,
        cycle,
        periodStart,
        periodEnd,
        taxableAmount: taxable.toFixed(2),
        cgst,
        sgst,
        igst: igstAmt,
        total,
        buyerName: buyer?.name ?? buyer?.fallback ?? 'Customer',
        buyerGstin: buyer?.gstin ?? null,
        buyerStateCode: buyer?.stateCode ?? null,
        sellerGstin: this.seller.gstin,
        sellerStateCode: this.seller.stateCode,
        placeOfSupply: buyer?.stateCode ?? null,
        provider,
        providerPaymentId: paymentId,
        paidAt: new Date(),
      })
      .returning();
    return row;
  }

  private addCycle(from: Date, cycle: Cycle) {
    const d = new Date(from);
    if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
    return d;
  }
}

interface RazorpaySubscription {
  id: string;
  current_start: number;
  current_end: number;
  notes?: { tenant_id?: string; plan_code?: string; cycle?: string };
}
