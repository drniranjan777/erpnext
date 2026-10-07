import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { Auth, Public, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { acceptSchema, loginSchema, PortalAuthService, portalUserSchema, type PortalIdentity } from './portal-auth.service';
import { Portal, PortalGuard } from './portal.guard';
import { decideOrderSchema, portalClaimSchema, portalMessageSchema, portalOrderSchema, PortalService, portalTicketSchema } from './portal.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const meta = (req: AppRequest) => ({ ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });

/** Sign-in for customer and dealer contacts (no staff session). */
@ApiTags('Portal')
@Public()
@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly auth: PortalAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body(body(loginSchema)) b: z.infer<typeof loginSchema>, @Req() req: AppRequest) {
    return this.auth.login(b, meta(req));
  }

  @Get('invite')
  preview(@Query(body(z.object({ token: z.string().min(40).max(200) }))) q: { token: string }) {
    return this.auth.preview(q.token);
  }

  @Post('accept')
  @HttpCode(200)
  accept(@Body(body(acceptSchema)) b: z.infer<typeof acceptSchema>, @Req() req: AppRequest) {
    return this.auth.accept(b, meta(req));
  }
}

/** The portal itself: everything is limited to the signed-in contact's party. */
@ApiTags('Portal')
@ApiBearerAuth()
@Public()
@UseGuards(PortalGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
  ) {}

  @Get('me')
  me(@Portal() p: PortalIdentity) {
    return this.portal.me(p);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Portal() p: PortalIdentity) {
    return this.auth.logout(p);
  }

  @Post('password')
  @HttpCode(200)
  password(@Portal() p: PortalIdentity, @Body(body(z.object({ current: z.string().min(1).max(200), password: z.string().min(10, 'Use at least 10 characters').max(200) }))) b: { current: string; password: string }) {
    return this.auth.changePassword(p, b.current, b.password);
  }

  @Get('orders')
  orders(@Portal() p: PortalIdentity) {
    return this.portal.orderList(p);
  }

  @Get('orders/:id')
  order(@Portal() p: PortalIdentity, @Param(idPipe) q: { id: string }) {
    return this.portal.order(p, q.id);
  }

  @Get('catalogue')
  catalogue(@Portal() p: PortalIdentity, @Query(body(z.object({ q: z.string().max(60).optional() }))) q: { q?: string }) {
    return this.portal.catalogue(p, q.q);
  }

  @Get('requests')
  requests(@Portal() p: PortalIdentity) {
    return this.portal.requests(p);
  }

  @Post('requests')
  place(@Portal() p: PortalIdentity, @Body(body(portalOrderSchema)) b: z.infer<typeof portalOrderSchema>) {
    return this.portal.placeOrder(p, b);
  }

  @Post('requests/:id/withdraw')
  @HttpCode(200)
  withdraw(@Portal() p: PortalIdentity, @Param(idPipe) q: { id: string }) {
    return this.portal.withdraw(p, q.id);
  }

  @Get('invoices')
  invoices(@Portal() p: PortalIdentity) {
    return this.portal.invoices(p);
  }

  @Get('invoices/:id')
  invoice(@Portal() p: PortalIdentity, @Param(idPipe) q: { id: string }) {
    return this.portal.invoice(p, q.id);
  }

  @Get('payments')
  payments(@Portal() p: PortalIdentity) {
    return this.portal.payments(p);
  }

  @Get('statement')
  statement(@Portal() p: PortalIdentity, @Query(body(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { from?: string; to?: string }) {
    return this.portal.statement(p, q.from, q.to);
  }

  @Get('tickets')
  tickets(@Portal() p: PortalIdentity) {
    return this.portal.ticketList(p);
  }

  @Post('tickets')
  raise(@Portal() p: PortalIdentity, @Body(body(portalTicketSchema)) b: z.infer<typeof portalTicketSchema>) {
    return this.portal.raiseTicket(p, b);
  }

  @Get('tickets/:id')
  ticket(@Portal() p: PortalIdentity, @Param(idPipe) q: { id: string }) {
    return this.portal.ticket(p, q.id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(200)
  message(@Portal() p: PortalIdentity, @Param(idPipe) q: { id: string }, @Body(body(portalMessageSchema)) b: z.infer<typeof portalMessageSchema>) {
    return this.portal.message(p, q.id, b);
  }

  @Post('tickets/:id/rating')
  @HttpCode(200)
  rate(@Portal() p: PortalIdentity, @Param(idPipe) q: { id: string }, @Body(body(z.object({ rating: z.number().int().min(1).max(5) }))) b: { rating: number }) {
    return this.portal.rate(p, q.id, b.rating);
  }

  @Get('articles')
  articles(@Portal() p: PortalIdentity, @Query(body(z.object({ q: z.string().max(100).optional() }))) q: { q?: string }) {
    return this.portal.articles(p, q.q);
  }

  @Get('articles/:id')
  article(@Portal() p: PortalIdentity, @Param(idPipe) q: { id: string }) {
    return this.portal.article(p, q.id);
  }

  @Get('schedules')
  schedules(@Portal() p: PortalIdentity, @Query(body(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }))) q: { month?: string }) {
    return this.portal.scheduleList(p, q.month);
  }

  @Get('asns')
  asns(@Portal() p: PortalIdentity) {
    return this.portal.asnList(p);
  }

  @Get('schemes')
  schemes(@Portal() p: PortalIdentity) {
    return this.portal.schemes(p);
  }

  @Get('claims')
  claims(@Portal() p: PortalIdentity) {
    return this.portal.claims(p);
  }

  @Post('claims')
  raiseClaim(@Portal() p: PortalIdentity, @Body(body(portalClaimSchema)) b: z.infer<typeof portalClaimSchema>) {
    return this.portal.raiseClaim(p, b);
  }

  @Get('stock')
  stock(@Portal() p: PortalIdentity) {
    return this.portal.stock(p);
  }
}

/** Staff side: portal logins and the orders placed on the portal. */
@ApiTags('Portal')
@ApiBearerAuth()
@Controller('portal-admin')
export class PortalAdminController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
  ) {}

  @Get('users')
  @RequirePermissions('portal.users.manage')
  users(@Auth() auth: AuthContext, @Query(body(z.object({ partyId: z.uuid().optional() }))) q: { partyId?: string }) {
    return this.auth.users(auth, q.partyId);
  }

  @Post('users')
  @RequirePermissions('portal.users.manage')
  invite(@Auth() auth: AuthContext, @Body(body(portalUserSchema)) b: z.infer<typeof portalUserSchema>) {
    return this.auth.invite(auth, b);
  }

  @Post('users/:id/reissue')
  @HttpCode(200)
  @RequirePermissions('portal.users.manage')
  reissue(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auth.reissue(auth, p.id);
  }

  @Post('users/:id/disable')
  @HttpCode(200)
  @RequirePermissions('portal.users.manage')
  disable(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auth.disable(auth, p.id);
  }

  @Get('orders')
  @RequirePermissions('portal.orders.manage')
  orders(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['submitted', 'accepted', 'rejected', 'withdrawn']).optional() }))) q: { status?: string }) {
    return this.portal.staffRequests(auth, q.status);
  }

  @Post('orders/:id/decide')
  @HttpCode(200)
  @RequirePermissions('portal.orders.manage', 'sales.orders.manage')
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decideOrderSchema)) b: z.infer<typeof decideOrderSchema>, @Req() req: AppRequest) {
    return this.portal.decide(auth, p.id, b, requestMeta(req));
  }
}
