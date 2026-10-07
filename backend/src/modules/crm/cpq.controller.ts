import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { todayIST } from '../../common/fiscal-year';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { configureSchema, CpqService, estimateSchema, optionGroupSchema, quoteConfiguredSchema, quoteEstimateSchema, templateSchema } from './cpq.service';
import { asnSchema, scheduleSchema, SchedulesService } from './schedules.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month as YYYY-MM');

@ApiTags('CPQ and schedules')
@ApiBearerAuth()
@Controller()
export class CpqController {
  constructor(
    private readonly cpq: CpqService,
    private readonly scheduleService: SchedulesService,
  ) {}

  // ---- estimates --------------------------------------------------------------------------
  @Post('cpq/calculate/:kind')
  @HttpCode(200)
  @RequirePermissions('cpq.estimates.read')
  calculate(@Param(body(z.object({ kind: z.enum(['box', 'fabrication', 'furniture']) }))) p: { kind: 'box' | 'fabrication' | 'furniture' }, @Body() b: unknown) {
    return this.cpq.calculate(p.kind, b).result;
  }
  @Get('cpq/estimates')
  @RequirePermissions('cpq.estimates.read')
  estimates(@Auth() auth: AuthContext, @Query(body(z.object({ partyId: z.uuid().optional(), opportunityId: z.uuid().optional() }))) q: { partyId?: string; opportunityId?: string }) {
    return this.cpq.list(auth, q);
  }
  @Get('cpq/estimates/:id')
  @RequirePermissions('cpq.estimates.read')
  estimate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.cpq.get(auth, p.id);
  }
  @Post('cpq/estimates')
  @RequirePermissions('cpq.estimates.manage')
  @ApiZodBody(estimateSchema)
  createEstimate(@Auth() auth: AuthContext, @Body(body(estimateSchema)) b: z.infer<typeof estimateSchema>) {
    return this.cpq.create(auth, b);
  }
  @Post('cpq/estimates/:id/quote')
  @HttpCode(200)
  @RequirePermissions('cpq.estimates.manage', 'sales.quotations.manage')
  quoteEstimate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(quoteEstimateSchema)) b: z.infer<typeof quoteEstimateSchema>, @Req() req: AppRequest) {
    return this.cpq.quote(auth, p.id, b, requestMeta(req));
  }

  // ---- configurator -----------------------------------------------------------------------
  @Get('cpq/items/:id/options')
  @RequirePermissions('cpq.estimates.read')
  options(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.cpq.optionGroups(auth, p.id);
  }
  @Post('cpq/items/:id/options')
  @HttpCode(200)
  @RequirePermissions('cpq.estimates.manage')
  @ApiZodBody(optionGroupSchema)
  saveOptions(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(optionGroupSchema)) b: z.infer<typeof optionGroupSchema>) {
    return this.cpq.saveGroup(auth, p.id, b);
  }
  @Delete('cpq/option-groups/:id')
  @RequirePermissions('cpq.estimates.manage')
  removeOptions(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.cpq.removeGroup(auth, p.id);
  }
  @Post('cpq/configure')
  @HttpCode(200)
  @RequirePermissions('cpq.estimates.read')
  configure(@Auth() auth: AuthContext, @Body(body(configureSchema)) b: z.infer<typeof configureSchema>) {
    return this.cpq.configure(auth, b);
  }
  @Post('cpq/configure/quote')
  @HttpCode(200)
  @RequirePermissions('cpq.estimates.manage', 'sales.quotations.manage')
  quoteConfigured(@Auth() auth: AuthContext, @Body(body(quoteConfiguredSchema)) b: z.infer<typeof quoteConfiguredSchema>, @Req() req: AppRequest) {
    return this.cpq.quoteConfigured(auth, b, requestMeta(req));
  }
  @Get('cpq/templates')
  @RequirePermissions('cpq.estimates.read')
  templates(@Auth() auth: AuthContext) {
    return this.cpq.templates(auth);
  }
  @Post('cpq/templates')
  @RequirePermissions('cpq.estimates.manage')
  addTemplate(@Auth() auth: AuthContext, @Body(body(templateSchema)) b: z.infer<typeof templateSchema>) {
    return this.cpq.saveTemplate(auth, null, b);
  }
  @Put('cpq/templates/:id')
  @RequirePermissions('cpq.estimates.manage')
  updateTemplate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(templateSchema)) b: z.infer<typeof templateSchema>) {
    return this.cpq.saveTemplate(auth, p.id, b);
  }

  // ---- customer schedules and ASN ---------------------------------------------------------
  @Get('sales/schedules')
  @RequirePermissions('sales.schedules.read')
  listSchedules(@Auth() auth: AuthContext, @Query(body(z.object({ month: month.optional(), customerId: z.uuid().optional() }))) q: { month?: string; customerId?: string }) {
    return this.scheduleService.list(auth, q);
  }
  @Get('sales/schedules/adherence')
  @RequirePermissions('sales.schedules.read')
  adherence(@Auth() auth: AuthContext, @Query(body(z.object({ month: month.optional(), customerId: z.uuid().optional() }))) q: { month?: string; customerId?: string }) {
    return this.scheduleService.adherence(auth, q.month ?? todayIST().slice(0, 7), q.customerId);
  }
  @Get('sales/schedules/:id')
  @RequirePermissions('sales.schedules.read')
  schedule(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.scheduleService.get(auth, p.id);
  }
  @Post('sales/schedules')
  @RequirePermissions('sales.schedules.manage')
  @ApiZodBody(scheduleSchema)
  saveSchedule(@Auth() auth: AuthContext, @Body(body(scheduleSchema)) b: z.infer<typeof scheduleSchema>) {
    return this.scheduleService.save(auth, b);
  }
  @Post('sales/schedules/import')
  @HttpCode(200)
  @RequirePermissions('sales.schedules.manage')
  @ApiConsumes('multipart/form-data')
  async importSchedules(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the file as multipart/form-data');
    const file = await req.file();
    if (!file) throw new BadRequestException('No file received');
    return this.scheduleService.importFile(auth, await file.toBuffer(), file.filename);
  }
  @Get('sales/asns')
  @RequirePermissions('sales.schedules.read')
  asns(@Auth() auth: AuthContext, @Query(body(z.object({ customerId: z.uuid().optional() }))) q: { customerId?: string }) {
    return this.scheduleService.asns(auth, q.customerId);
  }
  @Post('sales/deliveries/:id/asn')
  @RequirePermissions('sales.schedules.manage')
  @ApiZodBody(asnSchema)
  asn(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(asnSchema)) b: z.infer<typeof asnSchema>) {
    return this.scheduleService.createAsn(auth, p.id, b);
  }
  @Post('sales/asns/:id/received')
  @HttpCode(200)
  @RequirePermissions('sales.schedules.manage')
  received(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.scheduleService.markReceived(auth, p.id);
  }
}
