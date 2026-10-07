import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, Public, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { activitySchema, assignSchema, captureSchema, convertSchema, leadSchema, LeadsService, SOURCES, statusSchema } from './leads.service';
import { formSchema, moveSchema, opportunitySchema, PipelineService, quoteSchema, stageSchema, targetSchema, territorySchema } from './pipeline.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');

@ApiTags('CRM')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(
    private readonly leads: LeadsService,
    private readonly pipeline: PipelineService,
  ) {}

  @Get('summary')
  @RequirePermissions('crm.leads.read')
  summary(@Auth() auth: AuthContext) {
    return this.pipeline.summary(auth);
  }

  // ---- leads ------------------------------------------------------------------------------
  @Get('leads')
  @RequirePermissions('crm.leads.read')
  list(
    @Auth() auth: AuthContext,
    @Query(body(z.object({ status: z.enum(['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost']).optional(), source: z.enum(SOURCES).optional(), ownerId: z.uuid().optional(), q: z.string().trim().max(60).optional(), grade: z.enum(['A', 'B', 'C']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) })))
    q: { status?: string; source?: string; ownerId?: string; q?: string; grade?: string; limit: number; offset: number },
  ) {
    return this.leads.list(auth, q);
  }
  @Get('leads/follow-ups')
  @RequirePermissions('crm.leads.read')
  followUps(@Auth() auth: AuthContext) {
    return this.leads.followUps(auth);
  }
  @Get('leads/:id')
  @RequirePermissions('crm.leads.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.leads.get(auth, p.id);
  }
  @Post('leads')
  @RequirePermissions('crm.leads.manage')
  @ApiZodBody(leadSchema)
  create(@Auth() auth: AuthContext, @Body(body(leadSchema)) b: z.infer<typeof leadSchema>) {
    return this.leads.create(auth, b);
  }
  @Put('leads/:id')
  @RequirePermissions('crm.leads.manage')
  @ApiZodBody(leadSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(leadSchema)) b: z.infer<typeof leadSchema>) {
    return this.leads.update(auth, p.id, b);
  }
  @Post('leads/:id/status')
  @HttpCode(200)
  @RequirePermissions('crm.leads.manage')
  status(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(statusSchema)) b: z.infer<typeof statusSchema>) {
    return this.leads.setStatus(auth, p.id, b);
  }
  @Post('leads/assign')
  @HttpCode(200)
  @RequirePermissions('crm.leads.manage')
  assign(@Auth() auth: AuthContext, @Body(body(assignSchema)) b: z.infer<typeof assignSchema>) {
    return this.leads.assign(auth, b);
  }
  @Post('leads/:id/convert')
  @HttpCode(200)
  @RequirePermissions('crm.leads.manage', 'masters.parties.manage')
  @ApiZodBody(convertSchema)
  convert(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(convertSchema)) b: z.infer<typeof convertSchema>, @Req() req: AppRequest) {
    return this.leads.convert(auth, p.id, b, requestMeta(req));
  }
  /** multipart/form-data: the export file; ?source=indiamart|tradeindia|justdial|other */
  @Post('leads/import')
  @HttpCode(200)
  @RequirePermissions('crm.leads.manage')
  @ApiConsumes('multipart/form-data')
  async importLeads(@Auth() auth: AuthContext, @Query(body(z.object({ source: z.enum(SOURCES).default('other') }))) q: { source: (typeof SOURCES)[number] }, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    return this.leads.importFile(auth, await file.toBuffer(), file.filename, q.source);
  }

  // ---- activities -------------------------------------------------------------------------
  @Get('activities/agenda')
  @RequirePermissions('crm.leads.read')
  agenda(@Auth() auth: AuthContext, @Query(body(z.object({ ownerId: z.uuid().optional() }))) q: { ownerId?: string }) {
    return this.leads.agenda(auth, q.ownerId);
  }
  @Post('activities')
  @RequirePermissions('crm.leads.manage')
  @ApiZodBody(activitySchema)
  activity(@Auth() auth: AuthContext, @Body(body(activitySchema)) b: z.infer<typeof activitySchema>) {
    return this.leads.addActivity(auth, b);
  }
  @Post('activities/:id/done')
  @HttpCode(200)
  @RequirePermissions('crm.leads.manage')
  done(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(z.object({ outcome: z.string().trim().max(300).nullable().optional() }))) b: { outcome?: string | null }) {
    return this.leads.completeActivity(auth, p.id, b.outcome ?? null);
  }

  // ---- opportunities ----------------------------------------------------------------------
  @Get('opportunities')
  @RequirePermissions('crm.opportunities.read')
  opportunities(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['open', 'won', 'lost']).optional(), ownerId: z.uuid().optional(), partyId: z.uuid().optional() }))) q: { status?: string; ownerId?: string; partyId?: string }) {
    return this.pipeline.list(auth, q);
  }
  @Get('opportunities/:id')
  @RequirePermissions('crm.opportunities.read')
  opportunity(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.pipeline.get(auth, p.id);
  }
  @Post('opportunities')
  @RequirePermissions('crm.opportunities.manage')
  @ApiZodBody(opportunitySchema)
  addOpportunity(@Auth() auth: AuthContext, @Body(body(opportunitySchema)) b: z.infer<typeof opportunitySchema>) {
    return this.pipeline.create(auth, b);
  }
  @Put('opportunities/:id')
  @RequirePermissions('crm.opportunities.manage')
  @ApiZodBody(opportunitySchema)
  updateOpportunity(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(opportunitySchema)) b: z.infer<typeof opportunitySchema>) {
    return this.pipeline.update(auth, p.id, b);
  }
  @Post('opportunities/:id/move')
  @HttpCode(200)
  @RequirePermissions('crm.opportunities.manage')
  move(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(moveSchema)) b: z.infer<typeof moveSchema>) {
    return this.pipeline.move(auth, p.id, b);
  }
  @Post('opportunities/:id/quote')
  @HttpCode(200)
  @RequirePermissions('crm.opportunities.manage', 'sales.quotations.manage')
  @ApiZodBody(quoteSchema)
  quote(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(quoteSchema)) b: z.infer<typeof quoteSchema>, @Req() req: AppRequest) {
    return this.pipeline.quote(auth, p.id, b, requestMeta(req));
  }
  @Get('forecast')
  @RequirePermissions('crm.opportunities.read')
  forecast(@Auth() auth: AuthContext, @Query(body(z.object({ ownerId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }))) q: { ownerId?: string; from?: string; to?: string }) {
    const from = q.from ?? `${todayIST().slice(0, 7)}-01`;
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 6, 0);
    return this.pipeline.forecast(auth, { ownerId: q.ownerId, from, to: q.to ?? d.toISOString().slice(0, 10) });
  }

  // ---- setup ------------------------------------------------------------------------------
  @Get('stages')
  @RequirePermissions('crm.opportunities.read')
  stages(@Auth() auth: AuthContext) {
    return this.pipeline.stages(auth);
  }
  @Post('stages')
  @RequirePermissions('crm.setup.manage')
  addStage(@Auth() auth: AuthContext, @Body(body(stageSchema)) b: z.infer<typeof stageSchema>) {
    return this.pipeline.saveStage(auth, null, b);
  }
  @Put('stages/:id')
  @RequirePermissions('crm.setup.manage')
  updateStage(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(stageSchema)) b: z.infer<typeof stageSchema>) {
    return this.pipeline.saveStage(auth, p.id, b);
  }
  @Get('territories')
  @RequirePermissions('crm.leads.read')
  territories(@Auth() auth: AuthContext) {
    return this.pipeline.territories(auth);
  }
  @Post('territories')
  @RequirePermissions('crm.setup.manage')
  addTerritory(@Auth() auth: AuthContext, @Body(body(territorySchema)) b: z.infer<typeof territorySchema>) {
    return this.pipeline.saveTerritory(auth, null, b);
  }
  @Put('territories/:id')
  @RequirePermissions('crm.setup.manage')
  updateTerritory(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(territorySchema)) b: z.infer<typeof territorySchema>) {
    return this.pipeline.saveTerritory(auth, p.id, b);
  }
  @Get('forms')
  @RequirePermissions('crm.setup.manage')
  forms(@Auth() auth: AuthContext) {
    return this.pipeline.forms(auth);
  }
  @Post('forms')
  @RequirePermissions('crm.setup.manage')
  addForm(@Auth() auth: AuthContext, @Body(body(formSchema)) b: z.infer<typeof formSchema>) {
    return this.pipeline.saveForm(auth, null, b);
  }
  @Put('forms/:id')
  @RequirePermissions('crm.setup.manage')
  updateForm(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(formSchema)) b: z.infer<typeof formSchema>) {
    return this.pipeline.saveForm(auth, p.id, b);
  }
  @Get('targets')
  @RequirePermissions('crm.opportunities.read')
  targets(@Auth() auth: AuthContext, @Query(body(z.object({ month: month.optional() }))) q: { month?: string }) {
    return this.pipeline.targets(auth, q.month ?? todayIST().slice(0, 7));
  }
  @Post('targets')
  @HttpCode(200)
  @RequirePermissions('crm.setup.manage')
  setTarget(@Auth() auth: AuthContext, @Body(body(targetSchema)) b: z.infer<typeof targetSchema>) {
    return this.pipeline.setTarget(auth, b);
  }
}

/** The website end of a web enquiry form: no login, the form key identifies the workspace. */
@ApiTags('CRM')
@Controller('public/crm')
export class CrmPublicController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @Post('forms/:key/leads')
  @HttpCode(200)
  capture(@Param(body(z.object({ key: z.string().min(40).max(120) }))) p: { key: string }, @Body(body(captureSchema)) b: z.infer<typeof captureSchema>) {
    return this.leads.capture(p.key, b);
  }
}
