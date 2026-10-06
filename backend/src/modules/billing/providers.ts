import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

export interface CheckoutRequest {
  tenantId: string;
  planCode: string;
  cycle: 'monthly' | 'yearly';
  customerEmail: string;
  customerName: string;
}

export interface CheckoutSession {
  provider: 'mock' | 'razorpay';
  checkoutId: string;
  /** For the Razorpay Checkout widget in the browser. */
  razorpay?: { keyId: string; subscriptionId: string };
}

/** Payment provider abstraction: "mock" (built-in test checkout) or Razorpay subscriptions. */
@Injectable()
export class BillingProvider {
  private readonly logger = new Logger('Billing');
  readonly name: 'mock' | 'razorpay';
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly planIds: Record<string, string>;

  constructor(config: ConfigService<Env, true>) {
    this.name = config.get('BILLING_PROVIDER', { infer: true });
    this.keyId = config.get('RAZORPAY_KEY_ID', { infer: true });
    this.keySecret = config.get('RAZORPAY_KEY_SECRET', { infer: true });
    this.webhookSecret = config.get('RAZORPAY_WEBHOOK_SECRET', { infer: true });
    try {
      this.planIds = JSON.parse(config.get('RAZORPAY_PLAN_IDS', { infer: true }) || '{}');
    } catch {
      this.planIds = {};
    }
    if (this.name === 'razorpay' && (!this.keyId || !this.keySecret || !this.webhookSecret)) {
      throw new Error('BILLING_PROVIDER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET');
    }
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    if (this.name === 'mock') return { provider: 'mock', checkoutId: `mock_${randomUUID()}` };

    const planId = this.planIds[`${req.planCode}:${req.cycle}`];
    if (!planId) throw new BadRequestException(`Razorpay plan is not configured for ${req.planCode} (${req.cycle})`);
    const res = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({
        plan_id: planId,
        // Razorpay needs a finite count: 10 years of renewals.
        total_count: req.cycle === 'monthly' ? 120 : 10,
        customer_notify: 1,
        notes: { tenant_id: req.tenantId, plan_code: req.planCode, cycle: req.cycle },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
    if (!res.ok || !body.id) {
      this.logger.error(`Razorpay subscription create failed: ${res.status} ${body.error?.description ?? ''}`);
      throw new BadGatewayException('Could not start checkout with the payment provider. Please try again.');
    }
    return { provider: 'razorpay', checkoutId: body.id, razorpay: { keyId: this.keyId, subscriptionId: body.id } };
  }

  async cancel(providerSubscriptionId: string | null) {
    if (this.name !== 'razorpay' || !providerSubscriptionId) return;
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${providerSubscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new BadGatewayException('The payment provider could not cancel the subscription. Please try again.');
  }

  /** Razorpay signs the raw body with HMAC-SHA256(webhook secret). */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature) return false;
    const expected = Buffer.from(createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
