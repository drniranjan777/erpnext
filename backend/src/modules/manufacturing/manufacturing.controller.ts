import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { BomsService, createBomSchema, updateBomSchema, type CreateBomInput } from './boms.service';
import { machineSchema, ResourcesService, toolSchema, workCenterSchema } from './resources.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(z.object({ status: z.string().optional(), q: z.string().trim().max(60).optional(), itemId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }));

@ApiTags('Manufacturing')
@ApiBearerAuth()
@Controller('manufacturing')
export class ManufacturingController {
  constructor(
    private readonly resources: ResourcesService,
    private readonly boms: BomsService,
  ) {}

  // ---- Work centres, machines, tools ----

  @Get('work-centers')
  @RequirePermissions('manufacturing.engineering.read')
  workCenters(@Auth() auth: AuthContext) {
    return this.resources.workCenters(auth);
  }
  @Post('work-centers')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(workCenterSchema)
  createWorkCenter(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(workCenterSchema)) b: z.infer<typeof workCenterSchema>) {
    return this.resources.saveWorkCenter(auth, null, b);
  }
  @Put('work-centers/:id')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(workCenterSchema)
  updateWorkCenter(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(workCenterSchema)) b: z.infer<typeof workCenterSchema>) {
    return this.resources.saveWorkCenter(auth, p.id, b);
  }
  @Get('machines')
  @RequirePermissions('manufacturing.engineering.read')
  machines(@Auth() auth: AuthContext) {
    return this.resources.machines(auth);
  }
  @Post('machines')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(machineSchema)
  createMachine(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(machineSchema)) b: z.infer<typeof machineSchema>) {
    return this.resources.saveMachine(auth, null, b);
  }
  @Put('machines/:id')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(machineSchema)
  updateMachine(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(machineSchema)) b: z.infer<typeof machineSchema>) {
    return this.resources.saveMachine(auth, p.id, b);
  }
  @Get('tools')
  @RequirePermissions('manufacturing.engineering.read')
  tools(@Auth() auth: AuthContext) {
    return this.resources.tools(auth);
  }
  @Post('tools')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(toolSchema)
  createTool(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(toolSchema)) b: z.infer<typeof toolSchema>) {
    return this.resources.saveTool(auth, null, b);
  }
  @Put('tools/:id')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(toolSchema)
  updateTool(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(toolSchema)) b: z.infer<typeof toolSchema>) {
    return this.resources.saveTool(auth, p.id, b);
  }
  @Post('tools/:id/maintained')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  toolMaintained(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.resources.toolMaintained(auth, p.id);
  }

  // ---- BOMs ----

  @Get('boms')
  @RequirePermissions('manufacturing.engineering.read')
  listBoms(@Auth() auth: AuthContext, @Query(listPipe) q: { status?: string; q?: string; itemId?: string; limit: number; cursor?: string }) {
    return this.boms.list(auth, q);
  }
  @Get('boms/where-used/:id')
  @RequirePermissions('manufacturing.engineering.read')
  whereUsed(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.boms.whereUsed(auth, p.id);
  }
  @Get('boms/:id')
  @RequirePermissions('manufacturing.engineering.read')
  getBom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.boms.get(auth, p.id);
  }
  @Post('boms')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(createBomSchema)
  createBom(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createBomSchema)) b: CreateBomInput, @Req() req: AppRequest) {
    return this.boms.create(auth, b, requestMeta(req));
  }
  @Put('boms/:id')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(updateBomSchema)
  updateBom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateBomSchema)) b: z.infer<typeof updateBomSchema>, @Req() req: AppRequest) {
    return this.boms.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('boms/:id')
  @HttpCode(204)
  @RequirePermissions('manufacturing.engineering.manage')
  removeBom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.boms.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('boms/:id/submit')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  submitBom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.boms.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('boms/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  cancelBom(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.boms.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('boms/:id/new-version')
  @RequirePermissions('manufacturing.engineering.manage')
  newVersion(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.boms.newVersion(auth, p.id, requestMeta(req));
  }
  @Get('boms/:id/explode')
  @RequirePermissions('manufacturing.engineering.read')
  explode(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(z.object({ qty: z.string().regex(/^\d+(\.\d+)?$/).default('1'), levels: z.enum(['single', 'all']).default('single') }))) q: { qty: string; levels: 'single' | 'all' }) {
    return this.boms.explode(auth, p.id, q.qty, q.levels === 'all');
  }
  @Post('boms/:id/cost')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  cost(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(z.object({ apply: z.boolean().default(false) }))) b: { apply: boolean }) {
    return this.boms.rollUp(auth, p.id, b.apply);
  }
}
