import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  apqpSchema,
  AutoService,
  checklistSchema,
  controlPlanSchema,
  csrSchema,
  decisionSchema,
  deliverableSchema,
  ediInSchema,
  elementSchema,
  fmeaSchema,
  gateSchema,
  lpaAuditSchema,
  partnerSchema,
  ppapSchema,
  pswSchema,
} from './auto.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'auto.quality.read';
const M = 'auto.apqp.manage';

@ApiTags('Automotive')
@ApiBearerAuth()
@Controller('auto')
export class AutoController {
  constructor(private readonly auto: AutoService) {}

  @Get('apqp')
  @RequirePermissions(R)
  apqpList(@Auth() auth: AuthContext) {
    return this.auto.apqpList(auth);
  }

  @Post('apqp')
  @RequirePermissions(M)
  @ApiZodBody(apqpSchema)
  createApqp(@Auth() auth: AuthContext, @Body(body(apqpSchema)) b: z.infer<typeof apqpSchema>) {
    return this.auto.createApqp(auth, b);
  }

  @Get('apqp/:id')
  @RequirePermissions(R)
  getApqp(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auto.getApqp(auth, p.id);
  }

  @Post('apqp/:id/deliverables')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(deliverableSchema)
  deliverable(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(deliverableSchema)) b: z.infer<typeof deliverableSchema>) {
    return this.auto.updateDeliverable(auth, p.id, b);
  }

  @Post('apqp/:id/gates')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(gateSchema)
  gate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(gateSchema)) b: z.infer<typeof gateSchema>, @Req() req: AppRequest) {
    return this.auto.gate(auth, p.id, b, requestMeta(req));
  }

  @Get('ppap')
  @RequirePermissions(R)
  ppapList(@Auth() auth: AuthContext) {
    return this.auto.ppapList(auth);
  }

  @Post('ppap')
  @RequirePermissions(M)
  @ApiZodBody(ppapSchema)
  createPpap(@Auth() auth: AuthContext, @Body(body(ppapSchema)) b: z.infer<typeof ppapSchema>) {
    return this.auto.createPpap(auth, b);
  }

  @Get('ppap/:id')
  @RequirePermissions(R)
  getPpap(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auto.getPpap(auth, p.id);
  }

  @Post('ppap/:id/elements')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(elementSchema)
  element(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(elementSchema)) b: z.infer<typeof elementSchema>) {
    return this.auto.updateElement(auth, p.id, b);
  }

  @Post('ppap/:id/submit')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(pswSchema)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(pswSchema)) b: z.infer<typeof pswSchema>, @Req() req: AppRequest) {
    return this.auto.submit(auth, p.id, b, requestMeta(req));
  }

  @Post('ppap/:id/decision')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(decisionSchema)
  decision(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decisionSchema)) b: z.infer<typeof decisionSchema>) {
    return this.auto.decide(auth, p.id, b);
  }

  @Get('fmeas')
  @RequirePermissions(R)
  fmeas(@Auth() auth: AuthContext) {
    return this.auto.fmeaList(auth);
  }

  @Post('fmeas')
  @RequirePermissions(M)
  @ApiZodBody(fmeaSchema)
  createFmea(@Auth() auth: AuthContext, @Body(body(fmeaSchema)) b: z.infer<typeof fmeaSchema>) {
    return this.auto.saveFmea(auth, null, b);
  }

  @Get('fmeas/:id')
  @RequirePermissions(R)
  getFmea(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auto.getFmea(auth, p.id);
  }

  @Put('fmeas/:id')
  @RequirePermissions(M)
  @ApiZodBody(fmeaSchema)
  updateFmea(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(fmeaSchema)) b: z.infer<typeof fmeaSchema>) {
    return this.auto.saveFmea(auth, p.id, b);
  }

  @Get('fmeas/:id/control-plan-draft')
  @RequirePermissions(R)
  draft(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auto.draftFromFmea(auth, p.id);
  }

  @Get('control-plans')
  @RequirePermissions(R)
  controlPlans(@Auth() auth: AuthContext) {
    return this.auto.controlPlans(auth);
  }

  @Post('control-plans')
  @RequirePermissions(M)
  @ApiZodBody(controlPlanSchema)
  createPlan(@Auth() auth: AuthContext, @Body(body(controlPlanSchema)) b: z.infer<typeof controlPlanSchema>) {
    return this.auto.saveControlPlan(auth, null, b);
  }

  @Put('control-plans/:id')
  @RequirePermissions(M)
  @ApiZodBody(controlPlanSchema)
  updatePlan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(controlPlanSchema)) b: z.infer<typeof controlPlanSchema>) {
    return this.auto.saveControlPlan(auth, p.id, b);
  }

  @Get('lpa/checklists')
  @RequirePermissions(R)
  checklists(@Auth() auth: AuthContext) {
    return this.auto.checklists(auth);
  }

  @Post('lpa/checklists')
  @RequirePermissions('auto.lpa.audit')
  @ApiZodBody(checklistSchema)
  addChecklist(@Auth() auth: AuthContext, @Body(body(checklistSchema)) b: z.infer<typeof checklistSchema>) {
    return this.auto.addChecklist(auth, b);
  }

  @Post('lpa/audits')
  @RequirePermissions('auto.lpa.audit')
  @ApiZodBody(lpaAuditSchema)
  audit(@Auth() auth: AuthContext, @Body(body(lpaAuditSchema)) b: z.infer<typeof lpaAuditSchema>) {
    return this.auto.recordAudit(auth, b);
  }

  @Get('lpa/summary')
  @RequirePermissions(R)
  lpa(@Auth() auth: AuthContext, @Query(body(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }))) q: { days: number }) {
    return this.auto.lpaSummary(auth, q.days);
  }

  @Get('csr')
  @RequirePermissions(R)
  csr(@Auth() auth: AuthContext, @Query(body(z.object({ customerId: z.uuid().optional() }))) q: { customerId?: string }) {
    return this.auto.csrList(auth, q.customerId);
  }

  @Post('csr')
  @RequirePermissions(M)
  @ApiZodBody(csrSchema)
  createCsr(@Auth() auth: AuthContext, @Body(body(csrSchema)) b: z.infer<typeof csrSchema>) {
    return this.auto.saveCsr(auth, null, b);
  }

  @Put('csr/:id')
  @RequirePermissions(M)
  @ApiZodBody(csrSchema)
  updateCsr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(csrSchema)) b: z.infer<typeof csrSchema>) {
    return this.auto.saveCsr(auth, p.id, b);
  }

  @Get('edi/partners')
  @RequirePermissions(R)
  partners(@Auth() auth: AuthContext) {
    return this.auto.partners(auth);
  }

  @Post('edi/partners')
  @RequirePermissions('auto.edi.manage')
  @ApiZodBody(partnerSchema)
  partner(@Auth() auth: AuthContext, @Body(body(partnerSchema)) b: z.infer<typeof partnerSchema>) {
    return this.auto.savePartner(auth, b);
  }

  @Post('edi/receive')
  @RequirePermissions('auto.edi.manage')
  @ApiZodBody(ediInSchema)
  receive(@Auth() auth: AuthContext, @Body(body(ediInSchema)) b: z.infer<typeof ediInSchema>) {
    return this.auto.receive(auth, b.raw);
  }

  @Post('edi/desadv/:id')
  @RequirePermissions('auto.edi.manage')
  desadv(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auto.sendDesadv(auth, p.id);
  }

  @Post('edi/invoic/:id')
  @RequirePermissions('auto.edi.manage')
  invoic(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auto.sendInvoic(auth, p.id);
  }

  @Get('edi/messages')
  @RequirePermissions(R)
  messages(@Auth() auth: AuthContext) {
    return this.auto.messages(auth);
  }

  @Get('edi/messages/:id')
  @RequirePermissions(R)
  message(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.auto.message(auth, p.id);
  }
}
