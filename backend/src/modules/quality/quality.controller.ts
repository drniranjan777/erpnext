import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AQLS, LEVELS, samplingPlan, type InspectionLevel } from './aql';
import { createInspectionSchema, decisionSchema, InspectionsService, readingsSchema, type CreateInspectionInput, type DecisionInput } from './inspections.service';
import { planSchema, PlansService, type PlanInput } from './plans.service';
import { TraceabilityService } from './traceability.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(
  z.object({
    status: z.string().optional(),
    stage: z.enum(['incoming', 'in_process', 'final']).optional(),
    result: z.enum(['pending', 'accepted', 'rejected', 'partial']).optional(),
    q: z.string().trim().max(60).optional(),
    itemId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  }),
);
const tracePipe = new ZodValidationPipe(
  z.object({ itemId: z.uuid(), batchNo: z.string().trim().min(1).max(40).optional(), serialNo: z.string().trim().min(1).max(60).optional() }),
);
const samplingPipe = new ZodValidationPipe(z.object({ lot: z.coerce.number().int().min(1).max(10_000_000), aql: z.enum(AQLS).default('2.5'), level: z.enum(LEVELS).default('II') }));

type ListQuery = { status?: string; stage?: string; result?: string; q?: string; itemId?: string; limit: number; cursor?: string };
type TraceQuery = { itemId: string; batchNo?: string; serialNo?: string };

@ApiTags('Quality')
@ApiBearerAuth()
@Controller('quality')
export class QualityController {
  constructor(
    private readonly plans: PlansService,
    private readonly inspections: InspectionsService,
    private readonly trace: TraceabilityService,
  ) {}

  // ---- Plans ----

  @Get('plans')
  @RequirePermissions('quality.inspections.read')
  listPlans(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ itemId: z.uuid().optional(), stage: z.string().optional() }))) q: { itemId?: string; stage?: string }) {
    return this.plans.list(auth, q);
  }
  @Post('plans')
  @RequirePermissions('quality.inspections.manage')
  @ApiZodBody(planSchema)
  createPlan(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(planSchema)) b: PlanInput) {
    return this.plans.save(auth, null, b);
  }
  @Put('plans/:id')
  @RequirePermissions('quality.inspections.manage')
  @ApiZodBody(planSchema)
  updatePlan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(planSchema)) b: PlanInput) {
    return this.plans.save(auth, p.id, b);
  }
  /** ISO 2859-1 sample size and accept / reject numbers for a lot. */
  @Get('sampling')
  @RequirePermissions('quality.inspections.read')
  sampling(@Query(samplingPipe) q: { lot: number; aql: string; level: string }) {
    return samplingPlan(q.lot, q.aql, q.level as InspectionLevel);
  }

  // ---- Inspections ----

  @Get('inspections')
  @RequirePermissions('quality.inspections.read')
  list(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.inspections.list(auth, q);
  }
  @Get('inspections/:id')
  @RequirePermissions('quality.inspections.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.inspections.get(auth, p.id);
  }
  @Post('inspections')
  @RequirePermissions('quality.inspections.manage')
  @ApiZodBody(createInspectionSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createInspectionSchema)) b: CreateInspectionInput, @Req() req: AppRequest) {
    return this.inspections.create(auth, b, requestMeta(req));
  }
  @Put('inspections/:id/readings')
  @RequirePermissions('quality.inspections.manage')
  @ApiZodBody(readingsSchema)
  readings(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(readingsSchema)) b: z.infer<typeof readingsSchema>) {
    return this.inspections.saveReadings(auth, p.id, b);
  }
  /** The decision is the submission: accepted / rejected / rework quantities and where they go. */
  @Post('inspections/:id/submit')
  @HttpCode(200)
  @RequirePermissions('quality.inspections.manage')
  @ApiZodBody(decisionSchema)
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(decisionSchema)) b: DecisionInput, @Req() req: AppRequest) {
    return this.inspections.decide(auth, p.id, b, requestMeta(req));
  }
  @Delete('inspections/:id')
  @HttpCode(204)
  @RequirePermissions('quality.inspections.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.inspections.remove(auth, p.id, q.version, requestMeta(req));
  }

  // ---- Traceability ----

  @Get('trace/backward')
  @RequirePermissions('quality.inspections.read')
  backward(@Auth() auth: AuthContext, @Query(tracePipe) q: TraceQuery) {
    return this.trace.backward(auth, q);
  }
  @Get('trace/forward')
  @RequirePermissions('quality.inspections.read')
  forward(@Auth() auth: AuthContext, @Query(tracePipe) q: TraceQuery) {
    return this.trace.forward(auth, q);
  }
  @Get('as-built/:id')
  @RequirePermissions('manufacturing.production.read')
  asBuilt(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.trace.asBuilt(auth, p.id);
  }
}
