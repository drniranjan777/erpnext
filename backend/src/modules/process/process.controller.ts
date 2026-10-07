import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { createFormulaSchema, FormulasService, updateFormulaSchema, type CreateFormulaInput } from './formulas.service';
import { BlendsService, blendSchema, type BlendInput } from './blends.service';
import { cleaningSchema, correctionSchema, dispenseSchema, packSchema, ProcessService, type CleaningInput, type CorrectionInput, type DispenseInput, type PackInput } from './process.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(z.object({ status: z.string().optional(), q: z.string().trim().max(60).optional(), itemId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }));

@ApiTags('Process manufacturing')
@ApiBearerAuth()
@Controller('process')
export class ProcessController {
  constructor(
    private readonly formulas: FormulasService,
    private readonly process: ProcessService,
    private readonly blends: BlendsService,
  ) {}

  @Get('formulas')
  @RequirePermissions('manufacturing.engineering.read')
  list(@Auth() auth: AuthContext, @Query(listPipe) q: { status?: string; q?: string; itemId?: string; limit: number; cursor?: string }) {
    return this.formulas.list(auth, q);
  }
  @Get('formulas/:id')
  @RequirePermissions('manufacturing.engineering.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.formulas.get(auth, p.id);
  }
  @Post('formulas')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(createFormulaSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createFormulaSchema)) b: CreateFormulaInput, @Req() req: AppRequest) {
    return this.formulas.create(auth, b, requestMeta(req));
  }
  @Put('formulas/:id')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(updateFormulaSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateFormulaSchema)) b: z.infer<typeof updateFormulaSchema>, @Req() req: AppRequest) {
    return this.formulas.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('formulas/:id')
  @HttpCode(204)
  @RequirePermissions('manufacturing.engineering.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.formulas.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('formulas/:id/submit')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.formulas.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('formulas/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.formulas.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('formulas/:id/new-version')
  @RequirePermissions('manufacturing.engineering.manage')
  newVersion(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.formulas.newVersion(auth, p.id, requestMeta(req));
  }
  @Post('formulas/:id/cost')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  cost(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(z.object({ apply: z.boolean().default(false) }))) b: { apply: boolean }) {
    return this.formulas.rollUp(auth, p.id, b.apply);
  }
  @Get('formulas/:id/scale')
  @RequirePermissions('manufacturing.engineering.read')
  scale(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(z.object({ qty: z.string().regex(/^\d+(\.\d+)?$/) }))) q: { qty: string }) {
    return this.formulas.scaleTo(auth, p.id, q.qty);
  }

  // ---- Batches (work orders of kind "batch") ----

  @Get('batches/:id')
  @RequirePermissions('manufacturing.production.read')
  batch(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.process.batch(auth, p.id);
  }
  @Post('batches/:id/dispense')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(dispenseSchema)
  dispense(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(dispenseSchema)) b: DispenseInput, @Req() req: AppRequest) {
    return this.process.dispense(auth, p.id, b, requestMeta(req));
  }
  @Post('batches/:id/correction')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(correctionSchema)
  correct(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(correctionSchema)) b: CorrectionInput, @Req() req: AppRequest) {
    return this.process.correct(auth, p.id, b, requestMeta(req));
  }

  // ---- Packing ----

  @Get('packing/options')
  @RequirePermissions('manufacturing.production.read')
  packingOptions(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ bulkItemId: z.uuid() }))) q: { bulkItemId: string }) {
    return this.process.packingOptions(auth, q.bulkItemId);
  }
  @Post('packing')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(packSchema)
  pack(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(packSchema)) b: PackInput, @Req() req: AppRequest) {
    return this.process.pack(auth, b, requestMeta(req));
  }

  // ---- Blends ----

  @Get('blends')
  @RequirePermissions('inventory.stock.read')
  listBlends(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }))) q: { limit: number; cursor?: string }) {
    return this.blends.list(auth, q);
  }
  @Get('blends/:id')
  @RequirePermissions('inventory.stock.read')
  getBlend(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.blends.get(auth, p.id);
  }
  @Post('blends')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(blendSchema)
  blend(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(blendSchema)) b: BlendInput, @Req() req: AppRequest) {
    return this.blends.create(auth, b, requestMeta(req));
  }

  // ---- Equipment ----

  @Get('equipment')
  @RequirePermissions('manufacturing.production.read')
  equipment(@Auth() auth: AuthContext) {
    return this.process.equipment(auth);
  }
  @Post('equipment/:id/clean')
  @RequirePermissions('manufacturing.shopfloor.record')
  @ApiZodBody(cleaningSchema)
  clean(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cleaningSchema)) b: CleaningInput) {
    return this.process.clean(auth, p.id, b);
  }
}
