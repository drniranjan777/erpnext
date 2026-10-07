import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { AlertsService } from './alerts.service';
import { auditDoneSchema, auditSchema, AuditsService, findingSchema } from './audits.service';
import { calibrationSchema, CalibrationService, gaugeSchema, grrSchema } from './calibration.service';
import { closeDeviationSchema, createDeviationSchema, DeviationsService, updateDeviationSchema, type CreateDeviationInput } from './deviations.service';
import { disposeWasteSchema, eprSchema, HseService, incidentSchema, licenceSchema, wasteSchema } from './hse.service';
import { createSopSchema, SopsService, traineesSchema, updateSopSchema, type CreateSopInput } from './sops.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const R = 'quality.inspections.read';

/** Deviations, calibration and MSA, internal audits, SOPs and training, HSE registers, alerts. */
@ApiTags('Quality system')
@ApiBearerAuth()
@Controller('qms')
export class QmsSystemController {
  constructor(
    private readonly deviations: DeviationsService,
    private readonly calibration: CalibrationService,
    private readonly audits: AuditsService,
    private readonly sops: SopsService,
    private readonly hse: HseService,
    private readonly alertsService: AlertsService,
  ) {}

  @Get('alerts')
  @RequirePermissions(R)
  alerts(@Auth() auth: AuthContext) {
    return this.alertsService.alerts(auth);
  }

  // ---- deviations -------------------------------------------------------------------------
  @Get('deviations')
  @RequirePermissions(R)
  listDeviations(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ kind: z.enum(['planned', 'unplanned']).optional(), open: z.enum(['true', 'false']).optional(), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }))) q: { kind?: string; open?: string; q?: string; limit: number; cursor?: string }) {
    return this.deviations.list(auth, q);
  }
  @Get('deviations/:id')
  @RequirePermissions(R)
  getDeviation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.deviations.get(auth, p.id);
  }
  @Post('deviations')
  @RequirePermissions('quality.deviations.manage')
  @ApiZodBody(createDeviationSchema)
  createDeviation(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createDeviationSchema)) b: CreateDeviationInput, @Req() req: AppRequest) {
    return this.deviations.create(auth, b, requestMeta(req));
  }
  @Put('deviations/:id')
  @RequirePermissions('quality.deviations.manage')
  @ApiZodBody(updateDeviationSchema)
  updateDeviation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateDeviationSchema)) b: z.infer<typeof updateDeviationSchema>, @Req() req: AppRequest) {
    return this.deviations.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('deviations/:id')
  @HttpCode(204)
  @RequirePermissions('quality.deviations.manage')
  removeDeviation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.deviations.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('deviations/:id/submit')
  @HttpCode(200)
  @RequirePermissions('quality.deviations.manage')
  submitDeviation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.deviations.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('deviations/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('quality.deviations.manage')
  cancelDeviation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.deviations.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('deviations/:id/capa')
  @RequirePermissions('quality.deviations.manage', 'quality.capa.manage')
  deviationCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.deviations.raiseCapa(auth, p.id, requestMeta(req));
  }
  @Post('deviations/:id/close')
  @HttpCode(200)
  @RequirePermissions('quality.deviations.manage')
  @ApiZodBody(closeDeviationSchema)
  closeDeviation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(closeDeviationSchema)) b: z.infer<typeof closeDeviationSchema>, @Req() req: AppRequest) {
    return this.deviations.close(auth, p.id, b, requestMeta(req));
  }

  // ---- calibration ------------------------------------------------------------------------
  @Get('gauges')
  @RequirePermissions(R)
  gauges(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ due: z.enum(['true', 'false']).optional() }))) q: { due?: string }) {
    return this.calibration.list(auth, q);
  }
  @Get('gauges/:id')
  @RequirePermissions(R)
  gauge(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.calibration.get(auth, p.id);
  }
  @Post('gauges')
  @RequirePermissions('quality.calibration.manage')
  @ApiZodBody(gaugeSchema)
  addGauge(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(gaugeSchema)) b: z.infer<typeof gaugeSchema>) {
    return this.calibration.save(auth, null, b);
  }
  @Put('gauges/:id')
  @RequirePermissions('quality.calibration.manage')
  @ApiZodBody(gaugeSchema)
  updateGauge(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(gaugeSchema)) b: z.infer<typeof gaugeSchema>) {
    return this.calibration.save(auth, p.id, b);
  }
  @Post('gauges/:id/calibrations')
  @RequirePermissions('quality.calibration.manage')
  @ApiZodBody(calibrationSchema)
  calibrate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(calibrationSchema)) b: z.infer<typeof calibrationSchema>) {
    return this.calibration.calibrate(auth, p.id, b);
  }
  @Post('gauges/:id/grr')
  @RequirePermissions('quality.calibration.manage')
  @ApiZodBody(grrSchema)
  grr(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(grrSchema)) b: z.infer<typeof grrSchema>) {
    return this.calibration.study(auth, p.id, b);
  }

  // ---- internal audits --------------------------------------------------------------------
  @Get('audits')
  @RequirePermissions(R)
  listAudits(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ year: z.string().regex(/^\d{4}$/).optional() }))) q: { year?: string }) {
    return this.audits.list(auth, q);
  }
  @Get('audits/summary')
  @RequirePermissions(R)
  auditSummary(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) }))) q: { year: number }) {
    return this.audits.summary(auth, q.year);
  }
  @Get('audits/:id')
  @RequirePermissions(R)
  getAudit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.audits.get(auth, p.id);
  }
  @Post('audits')
  @RequirePermissions('quality.audits.manage')
  @ApiZodBody(auditSchema)
  addAudit(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(auditSchema)) b: z.infer<typeof auditSchema>) {
    return this.audits.create(auth, b);
  }
  @Put('audits/:id')
  @RequirePermissions('quality.audits.manage')
  @ApiZodBody(auditSchema)
  updateAudit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(auditSchema)) b: z.infer<typeof auditSchema>) {
    return this.audits.update(auth, p.id, b);
  }
  @Post('audits/:id/done')
  @HttpCode(200)
  @RequirePermissions('quality.audits.manage')
  @ApiZodBody(auditDoneSchema)
  auditDone(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(auditDoneSchema)) b: z.infer<typeof auditDoneSchema>) {
    return this.audits.done(auth, p.id, b);
  }
  @Post('audits/:id/findings')
  @RequirePermissions('quality.audits.manage')
  @ApiZodBody(findingSchema)
  addFinding(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(findingSchema)) b: z.infer<typeof findingSchema>) {
    return this.audits.addFinding(auth, p.id, b);
  }
  @Post('findings/:id/capa')
  @RequirePermissions('quality.audits.manage', 'quality.capa.manage')
  findingCapa(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.audits.findingCapa(auth, p.id, requestMeta(req));
  }
  @Post('findings/:id/close')
  @HttpCode(200)
  @RequirePermissions('quality.audits.manage')
  closeFinding(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.audits.closeFinding(auth, p.id);
  }

  // ---- SOPs -------------------------------------------------------------------------------
  @Get('sops')
  @RequirePermissions(R)
  listSops(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ current: z.enum(['true', 'false']).optional(), q: z.string().trim().max(60).optional() }))) q: { current?: string; q?: string }) {
    return this.sops.list(auth, q);
  }
  /** Any signed-in member: the SOPs they still have to read. */
  @Get('sops/pending')
  pendingSops(@Auth() auth: AuthContext) {
    return this.sops.pending(auth);
  }
  @Get('sops/:id')
  @RequirePermissions(R)
  getSop(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.sops.get(auth, p.id);
  }
  @Post('sops')
  @RequirePermissions('quality.sops.manage')
  @ApiZodBody(createSopSchema)
  createSop(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createSopSchema)) b: CreateSopInput, @Req() req: AppRequest) {
    return this.sops.create(auth, b, requestMeta(req));
  }
  @Put('sops/:id')
  @RequirePermissions('quality.sops.manage')
  @ApiZodBody(updateSopSchema)
  updateSop(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateSopSchema)) b: z.infer<typeof updateSopSchema>, @Req() req: AppRequest) {
    return this.sops.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('sops/:id')
  @HttpCode(204)
  @RequirePermissions('quality.sops.manage')
  removeSop(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.sops.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('sops/:id/submit')
  @HttpCode(200)
  @RequirePermissions('quality.sops.manage')
  submitSop(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.sops.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('sops/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('quality.sops.manage')
  cancelSop(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.sops.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('sops/:id/new-version')
  @RequirePermissions('quality.sops.manage')
  newSopVersion(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.sops.newVersion(auth, p.id, requestMeta(req));
  }
  @Put('sops/:id/trainees')
  @RequirePermissions('quality.sops.manage')
  @ApiZodBody(traineesSchema)
  trainees(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(traineesSchema)) b: z.infer<typeof traineesSchema>) {
    return this.sops.setTrainees(auth, p.id, b.userIds);
  }
  /** Any trainee acknowledges for themselves. */
  @Post('sops/:id/acknowledge')
  @HttpCode(200)
  acknowledge(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.sops.acknowledge(auth, p.id);
  }

  // ---- HSE --------------------------------------------------------------------------------
  @Get('hse/stats')
  @RequirePermissions('hse.register.read')
  hseStats(@Auth() auth: AuthContext) {
    return this.hse.stats(auth);
  }
  @Get('hse/incidents')
  @RequirePermissions('hse.register.read')
  incidents(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ status: z.enum(['open', 'closed']).optional() }))) q: { status?: string }) {
    return this.hse.incidents(auth, q);
  }
  /** Anyone may report an incident. */
  @Post('hse/incidents')
  @ApiZodBody(incidentSchema)
  addIncident(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(incidentSchema)) b: z.infer<typeof incidentSchema>) {
    return this.hse.addIncident(auth, b);
  }
  @Post('hse/incidents/:id/close')
  @HttpCode(200)
  @RequirePermissions('hse.register.manage')
  closeIncident(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(z.object({ rootCause: z.string().trim().min(3).max(2000) }))) b: { rootCause: string }) {
    return this.hse.closeIncident(auth, p.id, b.rootCause);
  }
  @Get('hse/waste')
  @RequirePermissions('hse.register.read')
  waste(@Auth() auth: AuthContext) {
    return this.hse.waste(auth);
  }
  @Post('hse/waste')
  @RequirePermissions('hse.register.manage')
  @ApiZodBody(wasteSchema)
  addWaste(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(wasteSchema)) b: z.infer<typeof wasteSchema>) {
    return this.hse.addWaste(auth, b);
  }
  @Post('hse/waste/:id/dispose')
  @HttpCode(200)
  @RequirePermissions('hse.register.manage')
  @ApiZodBody(disposeWasteSchema)
  disposeWaste(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(disposeWasteSchema)) b: z.infer<typeof disposeWasteSchema>) {
    return this.hse.disposeWaste(auth, p.id, b);
  }
  @Get('hse/epr')
  @RequirePermissions('hse.register.read')
  epr(@Auth() auth: AuthContext) {
    return this.hse.epr(auth);
  }
  @Put('hse/epr')
  @RequirePermissions('hse.register.manage')
  @ApiZodBody(eprSchema)
  saveEpr(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(eprSchema)) b: z.infer<typeof eprSchema>) {
    return this.hse.saveEpr(auth, b);
  }
  @Get('hse/licences')
  @RequirePermissions('hse.register.read')
  licences(@Auth() auth: AuthContext) {
    return this.hse.licences(auth);
  }
  @Post('hse/licences')
  @RequirePermissions('hse.register.manage')
  @ApiZodBody(licenceSchema)
  addLicence(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(licenceSchema)) b: z.infer<typeof licenceSchema>) {
    return this.hse.saveLicence(auth, null, b);
  }
  @Put('hse/licences/:id')
  @RequirePermissions('hse.register.manage')
  @ApiZodBody(licenceSchema)
  updateLicence(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(licenceSchema)) b: z.infer<typeof licenceSchema>) {
    return this.hse.saveLicence(auth, p.id, b);
  }
}
