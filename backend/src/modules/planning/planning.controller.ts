import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ForecastingService, generateSchema, overrideSchema, type GenerateInput, type OverrideInput } from './forecasting.service';
import { todayIST } from '../../common/fiscal-year';
import { KanbanService, loopSchema, type LoopInput } from './kanban.service';
import { moveSchema, SchedulingService, transitionSchema, type MoveInput } from './scheduling.service';
import { convertSchema, editPlannedSchema, firmSchema, MrpService, parametersSchema, runSchema, type ParametersInput, type RunInput } from './mrp.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) };
const forecastQuery = new ZodValidationPipe(z.object({ q: z.string().trim().max(60).optional(), ...page }));
const plannedQuery = new ZodValidationPipe(
  z.object({
    status: z
      .string()
      .regex(/^(planned|firmed|converted)(,(planned|firmed|converted))*$/)
      .optional(),
    source: z.enum(['make', 'buy', 'batch']).optional(),
    itemId: z.uuid().optional(),
    q: z.string().trim().max(60).optional(),
    ...page,
  }),
);
const boardQuery = new ZodValidationPipe(z.object({ from: z.iso.date().optional(), days: z.coerce.number().int().min(1).max(62).default(14) }));
const capacityQuery = new ZodValidationPipe(z.object({ mode: z.enum(['rough', 'detailed']).default('rough'), from: z.iso.date().optional(), periods: z.coerce.number().int().min(1).max(52).optional() }));
const scanSchema = z.object({ code: z.string().trim().min(3).max(80) });
const exceptionQuery = new ZodValidationPipe(z.object({ kind: z.string().max(30).optional(), itemId: z.uuid().optional(), ...page }));

@ApiTags('Planning')
@ApiBearerAuth()
@Controller('planning')
export class PlanningController {
  constructor(
    private readonly forecasting: ForecastingService,
    private readonly mrp: MrpService,
    private readonly scheduling: SchedulingService,
    private readonly kanban: KanbanService,
  ) {}

  // ---- forecast ---------------------------------------------------------------------------
  @Get('forecasts')
  @RequirePermissions('planning.mrp.read')
  forecasts(@Auth() auth: AuthContext, @Query(forecastQuery) q: { q?: string; limit: number; offset: number }) {
    return this.forecasting.list(auth, q);
  }
  @Post('forecasts/generate')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(generateSchema)
  generate(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(generateSchema)) b: GenerateInput) {
    return this.forecasting.generate(auth, b);
  }
  @Put('forecasts')
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(overrideSchema)
  override(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(overrideSchema)) b: OverrideInput) {
    return this.forecasting.override(auth, b);
  }

  // ---- MRP --------------------------------------------------------------------------------
  @Get('mrp/runs')
  @RequirePermissions('planning.mrp.read')
  runs(@Auth() auth: AuthContext) {
    return this.mrp.runs(auth);
  }
  @Post('mrp/runs')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(runSchema)
  run(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(runSchema)) b: RunInput) {
    return this.mrp.run(auth, b);
  }
  @Get('mrp/exceptions')
  @RequirePermissions('planning.mrp.read')
  exceptions(@Auth() auth: AuthContext, @Query(exceptionQuery) q: { kind?: string; itemId?: string; limit: number; offset: number }) {
    return this.mrp.exceptions(auth, q);
  }
  @Get('items/:id')
  @RequirePermissions('planning.mrp.read')
  item(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.mrp.itemPlan(auth, p.id);
  }
  @Put('items/:id/parameters')
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(parametersSchema)
  parameters(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(parametersSchema)) b: ParametersInput) {
    return this.mrp.setParameters(auth, p.id, b);
  }

  // ---- planned orders ---------------------------------------------------------------------
  @Get('planned-orders')
  @RequirePermissions('planning.mrp.read')
  planned(@Auth() auth: AuthContext, @Query(plannedQuery) q: { status?: string; source?: string; itemId?: string; q?: string; limit: number; offset: number }) {
    return this.mrp.plannedList(auth, q);
  }
  @Post('planned-orders/firm')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(firmSchema)
  firm(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(firmSchema)) b: z.infer<typeof firmSchema>) {
    return this.mrp.firm(auth, b.ids, b.firm);
  }
  @Put('planned-orders/:id')
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(editPlannedSchema)
  edit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(editPlannedSchema)) b: z.infer<typeof editPlannedSchema>) {
    return this.mrp.edit(auth, p.id, b);
  }
  /** Also needs the right to raise requisitions / work orders (checked in the service). */
  @Post('planned-orders/convert')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(convertSchema)
  convert(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(convertSchema)) b: z.infer<typeof convertSchema>, @Req() req: AppRequest) {
    return this.mrp.convert(auth, b, requestMeta(req));
  }

  // ---- capacity and finite schedule ------------------------------------------------------
  @Get('capacity')
  @RequirePermissions('planning.mrp.read')
  capacity(@Auth() auth: AuthContext, @Query(capacityQuery) q: { mode: 'rough' | 'detailed'; from?: string; periods?: number }) {
    return this.scheduling.capacity(auth, { mode: q.mode, from: q.from ?? todayIST(), periods: q.periods ?? (q.mode === 'rough' ? 8 : 14) });
  }
  @Get('schedule')
  @RequirePermissions('planning.mrp.read')
  board(@Auth() auth: AuthContext, @Query(boardQuery) q: { from?: string; days: number }) {
    return this.scheduling.board(auth, { from: q.from ?? todayIST(), days: q.days });
  }
  @Post('schedule/run')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.manage')
  schedule(@Auth() auth: AuthContext) {
    return this.scheduling.run(auth);
  }
  @Put('schedule/operations/:id')
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(moveSchema)
  move(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(moveSchema)) b: MoveInput) {
    return this.scheduling.move(auth, p.id, b);
  }
  @Get('setup-transitions')
  @RequirePermissions('planning.mrp.read')
  transitions(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ workCenterId: z.uuid().optional() }))) q: { workCenterId?: string }) {
    return this.scheduling.transitions(auth, q.workCenterId);
  }
  @Post('setup-transitions')
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(transitionSchema)
  saveTransition(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(transitionSchema)) b: z.infer<typeof transitionSchema>) {
    return this.scheduling.saveTransition(auth, b);
  }
  @Delete('setup-transitions/:id')
  @HttpCode(204)
  @RequirePermissions('planning.mrp.manage')
  deleteTransition(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.scheduling.deleteTransition(auth, p.id);
  }

  // ---- kanban -----------------------------------------------------------------------------
  @Get('kanban')
  @RequirePermissions('planning.mrp.read')
  loops(@Auth() auth: AuthContext) {
    return this.kanban.list(auth);
  }
  @Post('kanban')
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(loopSchema)
  createLoop(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(loopSchema)) b: LoopInput) {
    return this.kanban.save(auth, null, b);
  }
  @Put('kanban/:id')
  @RequirePermissions('planning.mrp.manage')
  @ApiZodBody(loopSchema)
  updateLoop(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(loopSchema)) b: LoopInput) {
    return this.kanban.save(auth, p.id, b);
  }
  @Get('kanban/:id/suggest')
  @RequirePermissions('planning.mrp.read')
  suggest(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.kanban.suggest(auth, p.id);
  }
  /** Signalling raises a document, so it also needs the right to raise it (checked in the service). */
  @Post('kanban/cards/:id/signal')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.read')
  signal(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.kanban.signal(auth, p.id, requestMeta(req));
  }
  @Post('kanban/cards/:id/receive')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.read')
  receive(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.kanban.receive(auth, p.id);
  }
  @Post('kanban/scan')
  @HttpCode(200)
  @RequirePermissions('planning.mrp.read')
  @ApiZodBody(scanSchema)
  scan(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(scanSchema)) b: { code: string }, @Req() req: AppRequest) {
    return this.kanban.scan(auth, b.code, requestMeta(req));
  }
}
