import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { actionSchema, actionUpdateSchema, CapasService, createCapaSchema, updateCapaSchema, verifySchema, type CreateCapaInput } from './capas.service';
import { complaintSchema, ComplaintsService, respondSchema, type ComplaintInput } from './complaints.service';
import { amlSchema, auditSchema, SupplierQualityService } from './supplier-quality.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const actionParams = new ZodValidationPipe(z.object({ id: z.uuid(), actionId: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const page = { limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() };
const capaQuery = new ZodValidationPipe(z.object({ stage: z.enum(['open', 'verification', 'closed']).optional(), scar: z.enum(['true', 'false']).optional(), partyId: z.uuid().optional(), q: z.string().trim().max(60).optional(), ...page }));
const complaintQuery = new ZodValidationPipe(z.object({ stage: z.enum(['open', 'investigating', 'responded', 'closed']).optional(), customerId: z.uuid().optional(), q: z.string().trim().max(60).optional(), ...page }));
const rangeQuery = new ZodValidationPipe(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }));
const spcQuery = new ZodValidationPipe(z.object({ parameterId: z.uuid(), from: z.iso.date().optional(), to: z.iso.date().optional(), chart: z.enum(['p', 'np', 'c', 'u']).optional(), limit: z.coerce.number().int().min(2).max(200).default(30) }));

/** Start of the financial year (April) for a date. */
const fyStart = (d: string) => `${Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 4 ? 1 : 0)}-04-01`;

/** CAPA and SCAR, customer complaints, supplier quality and SPC. */
@ApiTags('Quality')
@ApiBearerAuth()
@Controller('quality')
export class ImprovementController {
  constructor(
    private readonly capas: CapasService,
    private readonly complaints: ComplaintsService,
    private readonly suppliers: SupplierQualityService,
  ) {}

  // ---- CAPA -------------------------------------------------------------------------------
  @Get('capas')
  @RequirePermissions('quality.inspections.read')
  listCapas(@Auth() auth: AuthContext, @Query(capaQuery) q: { stage?: string; scar?: string; partyId?: string; q?: string; limit: number; cursor?: string }) {
    return this.capas.list(auth, q);
  }
  @Get('capas/:id')
  @RequirePermissions('quality.inspections.read')
  getCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.capas.get(auth, p.id);
  }
  @Post('capas')
  @RequirePermissions('quality.capa.manage')
  @ApiZodBody(createCapaSchema)
  createCapa(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createCapaSchema)) b: CreateCapaInput, @Req() req: AppRequest) {
    return this.capas.create(auth, b, requestMeta(req));
  }
  @Put('capas/:id')
  @RequirePermissions('quality.capa.manage')
  @ApiZodBody(updateCapaSchema)
  updateCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateCapaSchema)) b: z.infer<typeof updateCapaSchema>, @Req() req: AppRequest) {
    return this.capas.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('capas/:id')
  @HttpCode(204)
  @RequirePermissions('quality.capa.manage')
  removeCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.capas.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('capas/:id/submit')
  @HttpCode(200)
  @RequirePermissions('quality.capa.manage')
  submitCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.capas.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('capas/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('quality.capa.manage')
  cancelCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.capas.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('capas/:id/actions')
  @HttpCode(200)
  @RequirePermissions('quality.capa.manage')
  @ApiZodBody(actionSchema)
  addAction(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(actionSchema)) b: z.infer<typeof actionSchema>) {
    return this.capas.addAction(auth, p.id, b);
  }
  @Put('capas/:id/actions/:actionId')
  @RequirePermissions('quality.capa.manage')
  @ApiZodBody(actionUpdateSchema)
  completeAction(@Auth() auth: AuthContext, @Param(actionParams) p: { id: string; actionId: string }, @Body(new ZodValidationPipe(actionUpdateSchema)) b: z.infer<typeof actionUpdateSchema>) {
    return this.capas.completeAction(auth, p.id, p.actionId, b);
  }
  @Post('capas/:id/verify')
  @HttpCode(200)
  @RequirePermissions('quality.capa.manage')
  @ApiZodBody(verifySchema)
  verify(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(verifySchema)) b: z.infer<typeof verifySchema>, @Req() req: AppRequest) {
    return this.capas.verify(auth, p.id, b, requestMeta(req));
  }

  // ---- customer complaints ----------------------------------------------------------------
  @Get('complaints')
  @RequirePermissions('quality.inspections.read')
  listComplaints(@Auth() auth: AuthContext, @Query(complaintQuery) q: { stage?: string; customerId?: string; q?: string; limit: number; cursor?: string }) {
    return this.complaints.list(auth, q);
  }
  @Get('complaints/analysis')
  @RequirePermissions('quality.inspections.read')
  complaintAnalysis(@Auth() auth: AuthContext, @Query(rangeQuery) q: { from?: string; to?: string }) {
    const to = q.to ?? todayIST();
    return this.complaints.analysis(auth, { from: q.from ?? fyStart(to), to });
  }
  @Get('complaints/:id')
  @RequirePermissions('quality.inspections.read')
  getComplaint(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.complaints.get(auth, p.id);
  }
  @Post('complaints')
  @RequirePermissions('quality.complaints.manage')
  @ApiZodBody(complaintSchema)
  createComplaint(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(complaintSchema)) b: ComplaintInput, @Req() req: AppRequest) {
    return this.complaints.create(auth, b, requestMeta(req));
  }
  @Post('complaints/:id/ncr')
  @RequirePermissions('quality.complaints.manage', 'quality.ncr.manage')
  complaintNcr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.complaints.raiseNcr(auth, p.id, requestMeta(req));
  }
  @Post('complaints/:id/capa')
  @RequirePermissions('quality.complaints.manage', 'quality.capa.manage')
  complaintCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.complaints.raiseCapa(auth, p.id, requestMeta(req));
  }
  @Put('complaints/:id/response')
  @RequirePermissions('quality.complaints.manage')
  @ApiZodBody(respondSchema)
  respond(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(respondSchema)) b: z.infer<typeof respondSchema>, @Req() req: AppRequest) {
    return this.complaints.respond(auth, p.id, b, requestMeta(req));
  }
  @Post('complaints/:id/close')
  @HttpCode(200)
  @RequirePermissions('quality.complaints.manage')
  closeComplaint(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.complaints.close(auth, p.id, requestMeta(req));
  }

  // ---- supplier quality -------------------------------------------------------------------
  @Get('suppliers/scorecard')
  @RequirePermissions('quality.inspections.read')
  scorecard(@Auth() auth: AuthContext, @Query(rangeQuery) q: { from?: string; to?: string }) {
    const to = q.to ?? todayIST();
    return this.suppliers.scorecard(auth, { from: q.from ?? fyStart(to), to });
  }
  @Get('suppliers/audits')
  @RequirePermissions('quality.inspections.read')
  audits(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ partyId: z.uuid().optional() }))) q: { partyId?: string }) {
    return this.suppliers.audits(auth, q.partyId);
  }
  @Post('suppliers/audits')
  @RequirePermissions('quality.suppliers.manage')
  @ApiZodBody(auditSchema)
  addAudit(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(auditSchema)) b: z.infer<typeof auditSchema>) {
    return this.suppliers.addAudit(auth, b);
  }
  @Get('suppliers/aml')
  @RequirePermissions('quality.inspections.read')
  aml(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ itemId: z.uuid().optional() }))) q: { itemId?: string }) {
    return this.suppliers.aml(auth, q.itemId);
  }
  @Post('suppliers/aml')
  @RequirePermissions('quality.suppliers.manage')
  @ApiZodBody(amlSchema)
  addAml(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(amlSchema)) b: z.infer<typeof amlSchema>) {
    return this.suppliers.saveAml(auth, null, b);
  }
  @Put('suppliers/aml/:id')
  @RequirePermissions('quality.suppliers.manage')
  @ApiZodBody(amlSchema)
  updateAml(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(amlSchema)) b: z.infer<typeof amlSchema>) {
    return this.suppliers.saveAml(auth, p.id, b);
  }
  @Delete('suppliers/aml/:id')
  @HttpCode(204)
  @RequirePermissions('quality.suppliers.manage')
  removeAml(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.suppliers.removeAml(auth, p.id);
  }

  // ---- SPC --------------------------------------------------------------------------------
  @Get('spc/parameters')
  @RequirePermissions('quality.inspections.read')
  spcParameters(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ itemId: z.uuid().optional() }))) q: { itemId?: string }) {
    return this.suppliers.spcParameters(auth, q.itemId);
  }
  @Get('spc')
  @RequirePermissions('quality.inspections.read')
  spc(@Auth() auth: AuthContext, @Query(spcQuery) q: { parameterId: string; from?: string; to?: string; chart?: 'p' | 'np' | 'c' | 'u'; limit: number }) {
    return this.suppliers.spc(auth, q);
  }
}
