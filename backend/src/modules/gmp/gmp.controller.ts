import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { clearanceSchema, commentSchema, decideSchema, GmpService, locationSchema, sampleSchema, settingsSchema, verifySchema } from './gmp.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));

@ApiTags('GMP')
@ApiBearerAuth()
@Controller('gmp')
export class GmpController {
  constructor(private readonly gmp: GmpService) {}

  @Get('settings')
  @RequirePermissions('quality.inspections.read')
  settings(@Auth() auth: AuthContext) {
    return this.gmp.settings(auth);
  }

  @Put('settings')
  @RequirePermissions('gmp.settings.manage')
  @ApiZodBody(settingsSchema)
  saveSettings(@Auth() auth: AuthContext, @Body(body(settingsSchema)) b: z.infer<typeof settingsSchema>) {
    return this.gmp.saveSettings(auth, b);
  }

  @Get('signatures/verify')
  @RequirePermissions('gmp.settings.manage')
  verify(@Auth() auth: AuthContext) {
    return this.gmp.verifySignatures(auth);
  }

  @Get('line-clearances')
  @RequirePermissions('quality.inspections.read')
  clearances(@Auth() auth: AuthContext, @Query(body(z.object({ workOrderId: z.uuid().optional() }))) q: { workOrderId?: string }) {
    return this.gmp.clearances(auth, q.workOrderId);
  }

  @Post('line-clearances')
  @RequirePermissions('gmp.lineclearance.sign')
  @ApiZodBody(clearanceSchema)
  createClearance(@Auth() auth: AuthContext, @Body(body(clearanceSchema)) b: z.infer<typeof clearanceSchema>, @Req() req: AppRequest) {
    return this.gmp.createClearance(auth, b, requestMeta(req));
  }

  @Post('line-clearances/:id/verify')
  @HttpCode(200)
  @RequirePermissions('gmp.lineclearance.sign')
  @ApiZodBody(verifySchema)
  verifyClearance(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(verifySchema)) b: z.infer<typeof verifySchema>, @Req() req: AppRequest) {
    return this.gmp.verifyClearance(auth, p.id, b, requestMeta(req));
  }

  @Get('batch-reviews')
  @RequirePermissions('gmp.batchrecords.review')
  reviews(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['open', 'approved', 'rejected']).optional() }))) q: { status?: string }) {
    return this.gmp.reviews(auth, q.status);
  }

  @Post('batch-reviews')
  @HttpCode(200)
  @RequirePermissions('gmp.batchrecords.review')
  open(@Auth() auth: AuthContext, @Body(body(z.object({ workOrderId: z.uuid() }))) b: { workOrderId: string }) {
    return this.gmp.openReview(auth, b.workOrderId);
  }

  @Get('batch-reviews/:id')
  @RequirePermissions('gmp.batchrecords.review')
  review(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.gmp.getReview(auth, p.id);
  }

  @Post('batch-reviews/:id/comments')
  @HttpCode(200)
  @RequirePermissions('gmp.batchrecords.review')
  @ApiZodBody(commentSchema)
  comment(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(commentSchema)) b: z.infer<typeof commentSchema>) {
    return this.gmp.comment(auth, p.id, b);
  }

  @Post('batch-reviews/:id/decide')
  @HttpCode(200)
  @RequirePermissions('gmp.batchrecords.review')
  @ApiZodBody(decideSchema)
  decide(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(decideSchema)) b: z.infer<typeof decideSchema>, @Req() req: AppRequest) {
    return this.gmp.decide(auth, p.id, b, requestMeta(req));
  }

  @Get('em/locations')
  @RequirePermissions('quality.inspections.read')
  locations(@Auth() auth: AuthContext) {
    return this.gmp.locations(auth);
  }

  @Post('em/locations')
  @RequirePermissions('gmp.environment.manage')
  @ApiZodBody(locationSchema)
  createLocation(@Auth() auth: AuthContext, @Body(body(locationSchema)) b: z.infer<typeof locationSchema>) {
    return this.gmp.saveLocation(auth, null, b);
  }

  @Put('em/locations/:id')
  @RequirePermissions('gmp.environment.manage')
  @ApiZodBody(locationSchema)
  updateLocation(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(locationSchema)) b: z.infer<typeof locationSchema>) {
    return this.gmp.saveLocation(auth, p.id, b);
  }

  @Get('em/samples')
  @RequirePermissions('quality.inspections.read')
  samples(@Auth() auth: AuthContext, @Query(body(z.object({ locationId: z.uuid().optional(), status: z.enum(['ok', 'alert', 'action']).optional(), days: z.coerce.number().int().min(1).max(730).default(30) }))) q: { locationId?: string; status?: string; days: number }) {
    return this.gmp.samples(auth, q);
  }

  @Post('em/samples')
  @RequirePermissions('gmp.environment.manage')
  @ApiZodBody(sampleSchema)
  record(@Auth() auth: AuthContext, @Body(body(sampleSchema)) b: z.infer<typeof sampleSchema>, @Req() req: AppRequest) {
    return this.gmp.recordSample(auth, b, requestMeta(req));
  }

  @Get('em/trend')
  @RequirePermissions('quality.inspections.read')
  trend(@Auth() auth: AuthContext, @Query(body(z.object({ locationId: z.uuid(), param: z.string().min(1).max(40), days: z.coerce.number().int().min(1).max(730).default(90) }))) q: { locationId: string; param: string; days: number }) {
    return this.gmp.trend(auth, q.locationId, q.param, q.days);
  }
}
