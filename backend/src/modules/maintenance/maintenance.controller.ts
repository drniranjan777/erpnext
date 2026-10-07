import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { versionSchema } from '../documents/documents.schemas';
import { assetSchema, AssetsService, meterSchema, spareSchema, type AssetInput } from './assets.service';
import { completeSchema, MaintenanceOrdersService, requestSchema, startSchema, type CompleteInput, type RequestInput } from './orders.service';
import { PmService, scheduleSchema } from './pm.service';
import { ReliabilityService } from './reliability.service';
import { amcSchema, checklistSchema, checkSchema, fiveSSchema, kaizenSchema, TpmService, visitSchema } from './tpm.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const rangeQuery = new ZodValidationPipe(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }));
const R = 'maintenance.orders.read';
const M = 'maintenance.orders.manage';
/** Default range: the last 90 days. */
const range = (q: { from?: string; to?: string }) => {
  const to = q.to ?? todayIST();
  return { from: q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10), to };
};

@ApiTags('Maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly assets: AssetsService,
    private readonly orders: MaintenanceOrdersService,
    private readonly pm: PmService,
    private readonly tpm: TpmService,
    private readonly reliability: ReliabilityService,
  ) {}

  // ---- assets -----------------------------------------------------------------------------
  @Get('assets')
  @RequirePermissions(R)
  listAssets(@Auth() auth: AuthContext) {
    return this.assets.list(auth);
  }
  @Get('assets/critical-spares')
  @RequirePermissions(R)
  criticalSpares(@Auth() auth: AuthContext) {
    return this.assets.criticalSpares(auth);
  }
  @Get('assets/:id')
  @RequirePermissions(R)
  getAsset(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.assets.get(auth, p.id);
  }
  @Post('assets')
  @RequirePermissions(M)
  @ApiZodBody(assetSchema)
  addAsset(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(assetSchema)) b: AssetInput) {
    return this.assets.save(auth, null, b);
  }
  @Put('assets/:id')
  @RequirePermissions(M)
  @ApiZodBody(assetSchema)
  updateAsset(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(assetSchema)) b: AssetInput) {
    return this.assets.save(auth, p.id, b);
  }
  @Post('assets/:id/meter')
  @HttpCode(200)
  @RequirePermissions('maintenance.requests.create')
  @ApiZodBody(meterSchema)
  meter(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(meterSchema)) b: { reading: string }) {
    return this.assets.meter(auth, p.id, b.reading);
  }
  @Post('assets/:id/spares')
  @RequirePermissions(M)
  @ApiZodBody(spareSchema)
  addSpare(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(spareSchema)) b: z.infer<typeof spareSchema>) {
    return this.assets.addSpare(auth, p.id, b);
  }
  @Delete('spares/:id')
  @HttpCode(204)
  @RequirePermissions(M)
  removeSpare(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.assets.removeSpare(auth, p.id);
  }

  // ---- orders -----------------------------------------------------------------------------
  @Get('orders')
  @RequirePermissions(R)
  listOrders(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ stage: z.enum(['open', 'in_progress', 'done']).optional(), kind: z.string().max(20).optional(), assetId: z.uuid().optional(), open: z.enum(['true', 'false']).optional(), q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }))) q: { stage?: string; kind?: string; assetId?: string; open?: string; q?: string; limit: number; cursor?: string }) {
    return this.orders.list(auth, q);
  }
  @Get('orders/:id')
  @RequirePermissions(R)
  getOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.orders.get(auth, p.id);
  }
  /** Breakdown reports and maintenance requests (operators can raise them). */
  @Post('orders')
  @RequirePermissions('maintenance.requests.create')
  @ApiZodBody(requestSchema)
  request(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(requestSchema)) b: RequestInput, @Req() req: AppRequest) {
    return this.orders.create(auth, b, requestMeta(req));
  }
  @Post('orders/:id/start')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(startSchema)
  start(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(startSchema)) b: z.infer<typeof startSchema>, @Req() req: AppRequest) {
    return this.orders.start(auth, p.id, b, requestMeta(req));
  }
  @Post('orders/:id/complete')
  @HttpCode(200)
  @RequirePermissions(M)
  @ApiZodBody(completeSchema)
  complete(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(completeSchema)) b: CompleteInput, @Req() req: AppRequest) {
    return this.orders.complete(auth, p.id, b, requestMeta(req));
  }
  @Post('orders/:id/submit')
  @HttpCode(200)
  @RequirePermissions(M)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.orders.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Delete('orders/:id')
  @HttpCode(204)
  @RequirePermissions(M)
  removeOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.orders.remove(auth, p.id, q.version, requestMeta(req));
  }

  // ---- preventive maintenance -------------------------------------------------------------
  @Get('pm')
  @RequirePermissions(R)
  schedules(@Auth() auth: AuthContext) {
    return this.pm.list(auth);
  }
  @Post('pm')
  @RequirePermissions(M)
  @ApiZodBody(scheduleSchema)
  addSchedule(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(scheduleSchema)) b: z.infer<typeof scheduleSchema>) {
    return this.pm.save(auth, null, b);
  }
  @Put('pm/:id')
  @RequirePermissions(M)
  @ApiZodBody(scheduleSchema)
  updateSchedule(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(scheduleSchema)) b: z.infer<typeof scheduleSchema>) {
    return this.pm.save(auth, p.id, b);
  }
  @Post('pm/generate')
  @HttpCode(200)
  @RequirePermissions(M)
  generate(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(z.object({ lookahead: z.number().int().min(0).max(60).default(7) }))) b: { lookahead: number }, @Req() req: AppRequest) {
    return this.pm.generate(auth, b.lookahead, requestMeta(req));
  }
  @Get('pm/compliance')
  @RequirePermissions(R)
  compliance(@Auth() auth: AuthContext, @Query(rangeQuery) q: { from?: string; to?: string }) {
    return this.pm.compliance(auth, range(q));
  }

  // ---- reliability and OEE ----------------------------------------------------------------
  @Get('reliability')
  @RequirePermissions(R)
  rel(@Auth() auth: AuthContext, @Query(rangeQuery) q: { from?: string; to?: string }) {
    return this.reliability.reliability(auth, range(q));
  }
  @Get('oee')
  @RequirePermissions(R)
  oee(@Auth() auth: AuthContext, @Query(rangeQuery) q: { from?: string; to?: string }) {
    return this.reliability.oee(auth, range(q));
  }

  // ---- AMC --------------------------------------------------------------------------------
  @Get('amc')
  @RequirePermissions(R)
  amcs(@Auth() auth: AuthContext) {
    return this.tpm.amcs(auth);
  }
  @Post('amc')
  @RequirePermissions(M)
  @ApiZodBody(amcSchema)
  addAmc(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(amcSchema)) b: z.infer<typeof amcSchema>) {
    return this.tpm.saveAmc(auth, null, b);
  }
  @Put('amc/:id')
  @RequirePermissions(M)
  @ApiZodBody(amcSchema)
  updateAmc(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(amcSchema)) b: z.infer<typeof amcSchema>) {
    return this.tpm.saveAmc(auth, p.id, b);
  }
  @Get('amc/:id/visits')
  @RequirePermissions(R)
  visits(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.tpm.visits(auth, p.id);
  }
  @Post('amc/:id/visits')
  @RequirePermissions(M)
  @ApiZodBody(visitSchema)
  addVisit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(visitSchema)) b: z.infer<typeof visitSchema>) {
    return this.tpm.addVisit(auth, p.id, b);
  }

  // ---- TPM --------------------------------------------------------------------------------
  @Get('am-checklists')
  @RequirePermissions(R)
  checklists(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ assetId: z.uuid().optional() }))) q: { assetId?: string }) {
    return this.tpm.checklists(auth, q.assetId);
  }
  @Post('am-checklists')
  @RequirePermissions(M)
  @ApiZodBody(checklistSchema)
  addChecklist(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(checklistSchema)) b: z.infer<typeof checklistSchema>) {
    return this.tpm.saveChecklist(auth, null, b);
  }
  /** Operators record their own checks. */
  @Post('am-checklists/:id/checks')
  @RequirePermissions('maintenance.requests.create')
  @ApiZodBody(checkSchema)
  check(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(checkSchema)) b: z.infer<typeof checkSchema>) {
    return this.tpm.check(auth, p.id, b);
  }
  @Get('kaizens')
  @RequirePermissions(R)
  kaizens(@Auth() auth: AuthContext) {
    return this.tpm.kaizens(auth);
  }
  @Post('kaizens')
  @RequirePermissions('maintenance.requests.create')
  @ApiZodBody(kaizenSchema)
  addKaizen(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(kaizenSchema)) b: z.infer<typeof kaizenSchema>) {
    return this.tpm.addKaizen(auth, b);
  }
  @Get('five-s')
  @RequirePermissions(R)
  fiveS(@Auth() auth: AuthContext) {
    return this.tpm.fiveS(auth);
  }
  @Post('five-s')
  @RequirePermissions(M)
  @ApiZodBody(fiveSSchema)
  addFiveS(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(fiveSSchema)) b: z.infer<typeof fiveSSchema>) {
    return this.tpm.addFiveS(auth, b);
  }
}
