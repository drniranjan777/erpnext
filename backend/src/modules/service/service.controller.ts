import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { completeSchema, contractSchema, FieldServiceService, rmaSchema, rmaStepSchema, visitSchema, warrantySchema } from './field.service';
import { articleSchema, replySchema, settingsSchema, statusSchema, ticketSchema, TicketsService } from './tickets.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const R = 'service.tickets.read';
const T = 'service.tickets.manage';
const F = 'service.field.manage';
const C = 'service.contracts.manage';

@ApiTags('Service')
@ApiBearerAuth()
@Controller('service')
export class ServiceController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly field: FieldServiceService,
  ) {}

  // ---- tickets ----------------------------------------------------------------------------
  @Get('tickets')
  @RequirePermissions(R)
  list(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']).optional(), assignee: z.enum(['me', 'none']).optional(), partyId: z.uuid().optional(), breached: z.stringbool().optional(), q: z.string().trim().max(60).optional() }))) q: { status?: string; assignee?: string; partyId?: string; breached?: boolean; q?: string }) {
    return this.tickets.list(auth, q);
  }
  @Get('tickets/:id')
  @RequirePermissions(R)
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tickets.get(auth, p.id);
  }
  @Post('tickets')
  @RequirePermissions(T)
  @ApiZodBody(ticketSchema)
  create(@Auth() auth: AuthContext, @Body(body(ticketSchema)) b: z.infer<typeof ticketSchema>) {
    return this.tickets.create(auth, b);
  }
  @Post('tickets/:id/reply')
  @HttpCode(200)
  @RequirePermissions(T)
  reply(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(replySchema)) b: z.infer<typeof replySchema>) {
    return this.tickets.reply(auth, p.id, b);
  }
  @Post('tickets/:id/status')
  @HttpCode(200)
  @RequirePermissions(T)
  status(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(statusSchema)) b: z.infer<typeof statusSchema>) {
    return this.tickets.setStatus(auth, p.id, b);
  }
  @Post('tickets/:id/assign')
  @HttpCode(200)
  @RequirePermissions(T)
  assign(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ userId: z.uuid() }))) b: { userId: string }) {
    return this.tickets.assign(auth, p.id, b.userId);
  }
  @Post('sla/check')
  @HttpCode(200)
  @RequirePermissions(T)
  check(@Auth() auth: AuthContext) {
    return this.tickets.escalateAll(auth);
  }
  @Get('report')
  @RequirePermissions(R)
  report(@Auth() auth: AuthContext, @Query(body(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { from?: string; to?: string }) {
    return this.tickets.report(auth, q.from ?? `${todayIST().slice(0, 7)}-01`, q.to ?? todayIST());
  }
  @Get('settings')
  @RequirePermissions(R)
  settings(@Auth() auth: AuthContext) {
    return this.tickets.getSettings(auth);
  }
  @Put('settings')
  @RequirePermissions('service.setup.manage')
  saveSettings(@Auth() auth: AuthContext, @Body(body(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.tickets.saveSettings(auth, b);
  }

  // ---- knowledge base ---------------------------------------------------------------------
  @Get('articles')
  @RequirePermissions(R)
  articles(@Auth() auth: AuthContext, @Query(body(z.object({ q: z.string().max(200).optional() }))) q: { q?: string }) {
    return this.tickets.articles(auth, q.q);
  }
  @Get('articles/:id')
  @RequirePermissions(R)
  article(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tickets.article(auth, p.id);
  }
  @Post('articles')
  @RequirePermissions(T)
  addArticle(@Auth() auth: AuthContext, @Body(body(articleSchema)) b: z.infer<typeof articleSchema>) {
    return this.tickets.saveArticle(auth, null, b);
  }
  @Put('articles/:id')
  @RequirePermissions(T)
  updateArticle(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(articleSchema)) b: z.infer<typeof articleSchema>) {
    return this.tickets.saveArticle(auth, p.id, b);
  }

  // ---- installed base ---------------------------------------------------------------------
  @Get('serials/:serial')
  @RequirePermissions(R)
  lookup(@Auth() auth: AuthContext, @Param(body(z.object({ serial: z.string().trim().min(1).max(60) }))) p: { serial: string }) {
    return this.field.lookup(auth, p.serial);
  }
  @Post('warranties')
  @RequirePermissions(C)
  @ApiZodBody(warrantySchema)
  warranty(@Auth() auth: AuthContext, @Body(body(warrantySchema)) b: z.infer<typeof warrantySchema>) {
    return this.field.registerWarranty(auth, b);
  }
  @Post('warranties/from-invoice/:id')
  @HttpCode(200)
  @RequirePermissions(C)
  fromInvoice(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.field.fromInvoice(auth, p.id);
  }
  @Get('contracts')
  @RequirePermissions(R)
  contracts(@Auth() auth: AuthContext, @Query(body(z.object({ partyId: z.uuid().optional() }))) q: { partyId?: string }) {
    return this.field.contracts(auth, q.partyId);
  }
  @Post('contracts')
  @RequirePermissions(C)
  @ApiZodBody(contractSchema)
  contract(@Auth() auth: AuthContext, @Body(body(contractSchema)) b: z.infer<typeof contractSchema>) {
    return this.field.createContract(auth, b);
  }
  @Post('contracts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(C)
  cancelContract(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.field.cancelContract(auth, p.id);
  }

  // ---- visits -----------------------------------------------------------------------------
  @Get('visits')
  @RequirePermissions(R)
  visits(@Auth() auth: AuthContext, @Query(body(z.object({ mine: z.stringbool().optional(), status: z.enum(['scheduled', 'in_progress', 'done', 'cancelled']).optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { mine?: boolean; status?: string; from?: string; to?: string }) {
    return this.field.visits(auth, q);
  }
  @Get('visits/:id')
  @RequirePermissions(R)
  visit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.field.visit(auth, p.id);
  }
  @Post('visits')
  @RequirePermissions(F)
  @ApiZodBody(visitSchema)
  schedule(@Auth() auth: AuthContext, @Body(body(visitSchema)) b: z.infer<typeof visitSchema>) {
    return this.field.scheduleVisit(auth, b);
  }
  @Post('visits/:id/start')
  @HttpCode(200)
  @RequirePermissions(F)
  start(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.field.start(auth, p.id);
  }
  @Post('visits/:id/complete')
  @HttpCode(200)
  @RequirePermissions(F)
  @ApiZodBody(completeSchema)
  complete(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(completeSchema)) b: z.infer<typeof completeSchema>, @Req() req: AppRequest) {
    return this.field.complete(auth, p.id, b, requestMeta(req));
  }
  @Post('visits/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(F)
  cancelVisit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.field.cancelVisit(auth, p.id);
  }

  // ---- RMA --------------------------------------------------------------------------------
  @Get('rmas')
  @RequirePermissions(R)
  rmas(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.string().max(20).optional() }))) q: { status?: string }) {
    return this.field.rmas(auth, q.status);
  }
  @Post('rmas')
  @RequirePermissions(C)
  @ApiZodBody(rmaSchema)
  rma(@Auth() auth: AuthContext, @Body(body(rmaSchema)) b: z.infer<typeof rmaSchema>) {
    return this.field.authoriseRma(auth, b);
  }
  @Post('rmas/:id/step')
  @HttpCode(200)
  @RequirePermissions(C)
  rmaStep(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(rmaStepSchema)) b: z.infer<typeof rmaStepSchema>) {
    return this.field.rmaStep(auth, p.id, b);
  }
}
