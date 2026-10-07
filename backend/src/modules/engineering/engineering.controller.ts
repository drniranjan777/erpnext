import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { ChangesService, createChangeSchema, implementSchema, updateChangeSchema, type CreateChangeInput } from './changes.service';
import { createDrawingSchema, DrawingsService, updateDrawingSchema, type CreateDrawingInput } from './drawings.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const changeList = new ZodValidationPipe(z.object({ stage: z.enum(['request', 'approved', 'implemented']).optional(), q: z.string().trim().max(60).optional(), itemId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }));
const drawingList = new ZodValidationPipe(z.object({ q: z.string().trim().max(60).optional(), itemId: z.uuid().optional(), current: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional() }));
const implementBody = new ZodValidationPipe(implementSchema.extend({ version: z.number().int() }));

@ApiTags('Engineering')
@ApiBearerAuth()
@Controller('engineering')
export class EngineeringController {
  constructor(
    private readonly changes: ChangesService,
    private readonly drawings: DrawingsService,
  ) {}

  // ---- engineering changes ----------------------------------------------------------------
  @Get('changes')
  @RequirePermissions('manufacturing.engineering.read')
  listChanges(@Auth() auth: AuthContext, @Query(changeList) q: { stage?: string; q?: string; itemId?: string; limit: number; cursor?: string }) {
    return this.changes.list(auth, q);
  }
  @Get('changes/for-item/:id')
  @RequirePermissions('manufacturing.engineering.read')
  changesForItem(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.changes.forItem(auth, p.id);
  }
  @Get('changes/:id')
  @RequirePermissions('manufacturing.engineering.read')
  getChange(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.changes.get(auth, p.id);
  }
  @Post('changes')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(createChangeSchema)
  createChange(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createChangeSchema)) b: CreateChangeInput, @Req() req: AppRequest) {
    return this.changes.create(auth, b, requestMeta(req));
  }
  @Put('changes/:id')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(updateChangeSchema)
  updateChange(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateChangeSchema)) b: z.infer<typeof updateChangeSchema>, @Req() req: AppRequest) {
    return this.changes.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('changes/:id')
  @HttpCode(204)
  @RequirePermissions('manufacturing.engineering.manage')
  removeChange(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.changes.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('changes/:id/submit')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  submitChange(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.changes.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('changes/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  cancelChange(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.changes.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('changes/:id/implement')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  implement(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(implementBody) b: { version: number; notes: string | null }, @Req() req: AppRequest) {
    return this.changes.implement(auth, p.id, b.version, b.notes, requestMeta(req));
  }

  // ---- drawings ---------------------------------------------------------------------------
  @Get('drawings')
  @RequirePermissions('manufacturing.engineering.read')
  listDrawings(@Auth() auth: AuthContext, @Query(drawingList) q: { q?: string; itemId?: string; current?: string; limit: number; cursor?: string }) {
    return this.drawings.list(auth, q);
  }
  @Get('drawings/:id')
  @RequirePermissions('manufacturing.engineering.read')
  getDrawing(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.drawings.get(auth, p.id);
  }
  @Post('drawings')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(createDrawingSchema)
  createDrawing(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createDrawingSchema)) b: CreateDrawingInput, @Req() req: AppRequest) {
    return this.drawings.create(auth, b, requestMeta(req));
  }
  @Put('drawings/:id')
  @RequirePermissions('manufacturing.engineering.manage')
  @ApiZodBody(updateDrawingSchema)
  updateDrawing(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateDrawingSchema)) b: z.infer<typeof updateDrawingSchema>, @Req() req: AppRequest) {
    return this.drawings.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('drawings/:id')
  @HttpCode(204)
  @RequirePermissions('manufacturing.engineering.manage')
  removeDrawing(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.drawings.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Post('drawings/:id/submit')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  submitDrawing(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() req: AppRequest) {
    return this.drawings.submit(auth, p.id, b.version, requestMeta(req));
  }
  @Post('drawings/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('manufacturing.engineering.manage')
  cancelDrawing(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.drawings.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('drawings/:id/revise')
  @RequirePermissions('manufacturing.engineering.manage')
  revise(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.drawings.newRevision(auth, p.id, requestMeta(req));
  }
}
