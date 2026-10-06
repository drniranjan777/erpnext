import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, Public, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { BillingService } from './billing.service';
import { AllowWhenReadOnly } from './subscription.guard';

const checkoutSchema = z.object({ planCode: z.string().max(30), cycle: z.enum(['monthly', 'yearly']).default('monthly') });

@ApiTags('Billing')
@ApiBearerAuth()
@AllowWhenReadOnly()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  plans() {
    return this.billing.plans();
  }

  @Get('summary')
  @RequirePermissions('platform.billing.manage')
  summary(@Auth() auth: AuthContext) {
    return this.billing.summary(auth);
  }

  @Post('checkout')
  @HttpCode(200)
  @RequirePermissions('platform.billing.manage')
  @ApiZodBody(checkoutSchema)
  checkout(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>, @Req() req: AppRequest) {
    return this.billing.checkout(auth, body.planCode, body.cycle, requestMeta(req));
  }

  /** Built-in test checkout (BILLING_PROVIDER=mock): marks the pending checkout as paid. */
  @Post('checkout/:checkoutId/confirm-test')
  @HttpCode(200)
  @RequirePermissions('platform.billing.manage')
  confirmTest(
    @Auth() auth: AuthContext,
    @Param(new ZodValidationPipe(z.object({ checkoutId: z.string().regex(/^mock_[0-9a-f-]{36}$/) }))) p: { checkoutId: string },
    @Req() req: AppRequest,
  ) {
    return this.billing.confirmTestCheckout(auth, p.checkoutId, requestMeta(req));
  }

  @Post('cancel')
  @HttpCode(200)
  @RequirePermissions('platform.billing.manage')
  cancel(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    return this.billing.cancel(auth, requestMeta(req));
  }

  @Post('resume')
  @HttpCode(200)
  @RequirePermissions('platform.billing.manage')
  resume(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    return this.billing.resume(auth, requestMeta(req));
  }

  @Get('invoices')
  @RequirePermissions('platform.billing.manage')
  invoices(@Auth() auth: AuthContext) {
    return this.billing.listInvoices(auth);
  }

  @Get('invoices/:id/print')
  @RequirePermissions('platform.billing.manage')
  invoice(@Auth() auth: AuthContext, @Param(new ZodValidationPipe(z.object({ id: z.uuid() }))) p: { id: string }) {
    return this.billing.renderInvoice(auth, p.id);
  }

  /** Razorpay webhook (configure in the Razorpay dashboard → Webhooks). Verified by HMAC signature. */
  @Public()
  @Post('webhooks/razorpay')
  @HttpCode(200)
  razorpay(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    if (!req.rawBody) throw new BadRequestException('Missing body');
    return this.billing.handleRazorpayEvent(req.rawBody, signature, eventId);
  }
}
