import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { allergenSchema, analysisSchema, approveSchema, ccpRecordSchema, certificateSchema, closeRecallSchema, FoodService, labelSchema, planSchema, recallSchema, recoverSchema } from './food.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'food.reports.read';

@ApiTags('Food safety')
@ApiBearerAuth()
@Controller()
export class FoodController {
  constructor(private readonly food: FoodService) {}

  @Get('food/haccp')
  @RequirePermissions(R)
  plans(@Auth() auth: AuthContext) {
    return this.food.plans(auth);
  }

  @Post('food/haccp')
  @RequirePermissions('food.haccp.manage')
  @ApiZodBody(planSchema)
  createPlan(@Auth() auth: AuthContext, @Body(body(planSchema)) b: z.infer<typeof planSchema>) {
    return this.food.createPlan(auth, b);
  }

  @Get('food/haccp/:id')
  @RequirePermissions(R)
  plan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.food.getPlan(auth, p.id);
  }

  @Put('food/haccp/:id/analysis')
  @RequirePermissions('food.haccp.manage')
  @ApiZodBody(analysisSchema)
  analysis(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(analysisSchema)) b: z.infer<typeof analysisSchema>) {
    return this.food.saveAnalysis(auth, p.id, b);
  }

  @Post('food/haccp/:id/approve')
  @HttpCode(200)
  @RequirePermissions('food.haccp.manage')
  @ApiZodBody(approveSchema)
  approve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(approveSchema)) b: z.infer<typeof approveSchema>, @Req() req: AppRequest) {
    return this.food.approve(auth, p.id, b, requestMeta(req));
  }

  @Post('food/haccp/:id/records')
  @RequirePermissions('food.ccp.record')
  @ApiZodBody(ccpRecordSchema)
  record(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(ccpRecordSchema)) b: z.infer<typeof ccpRecordSchema>) {
    return this.food.recordCcp(auth, p.id, b);
  }

  @Get('food/haccp/:id/monitoring')
  @RequirePermissions(R)
  monitoring(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(body(z.object({ days: z.coerce.number().int().min(1).max(366).default(7) }))) q: { days: number }) {
    return this.food.monitoring(auth, p.id, q.days);
  }

  @Get('food/allergens')
  @RequirePermissions(R)
  matrix(@Auth() auth: AuthContext) {
    return this.food.matrix(auth);
  }

  @Post('food/allergens')
  @HttpCode(200)
  @RequirePermissions('food.haccp.manage')
  @ApiZodBody(allergenSchema)
  setAllergens(@Auth() auth: AuthContext, @Body(body(allergenSchema)) b: z.infer<typeof allergenSchema>) {
    return this.food.setAllergens(auth, b);
  }

  @Get('food/allergens/changeover')
  @RequirePermissions(R)
  changeover(@Auth() auth: AuthContext, @Query(body(z.object({ from: z.uuid(), to: z.uuid() }))) q: { from: string; to: string }) {
    return this.food.changeover(auth, q.from, q.to);
  }

  @Get('food/recalls')
  @RequirePermissions(R)
  recalls(@Auth() auth: AuthContext) {
    return this.food.recalls(auth);
  }

  @Post('food/recalls')
  @RequirePermissions('food.recalls.manage')
  @ApiZodBody(recallSchema)
  start(@Auth() auth: AuthContext, @Body(body(recallSchema)) b: z.infer<typeof recallSchema>) {
    return this.food.startRecall(auth, b);
  }

  @Get('food/recalls/:id')
  @RequirePermissions(R)
  recall(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.food.getRecall(auth, p.id);
  }

  @Post('food/recalls/:id/trace-done')
  @HttpCode(200)
  @RequirePermissions('food.recalls.manage')
  traceDone(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.food.traceDone(auth, p.id);
  }

  @Post('food/recalls/:id/recovered')
  @HttpCode(200)
  @RequirePermissions('food.recalls.manage')
  @ApiZodBody(recoverSchema)
  recover(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(recoverSchema)) b: z.infer<typeof recoverSchema>) {
    return this.food.recover(auth, p.id, b);
  }

  @Post('food/recalls/:id/close')
  @HttpCode(200)
  @RequirePermissions('food.recalls.manage')
  @ApiZodBody(closeRecallSchema)
  close(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(closeRecallSchema)) b: z.infer<typeof closeRecallSchema>) {
    return this.food.closeRecall(auth, p.id, b);
  }

  @Get('food/labels')
  @RequirePermissions(R)
  labels(@Auth() auth: AuthContext) {
    return this.food.labels(auth);
  }

  @Get('food/labels/:id')
  @RequirePermissions(R)
  label(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.food.label(auth, p.id);
  }

  @Post('food/labels')
  @HttpCode(200)
  @RequirePermissions('food.labels.manage')
  @ApiZodBody(labelSchema)
  saveLabel(@Auth() auth: AuthContext, @Body(body(labelSchema)) b: z.infer<typeof labelSchema>) {
    return this.food.saveLabel(auth, b);
  }

  @Get('food/fssai-return')
  @RequirePermissions(R)
  fssai(@Auth() auth: AuthContext, @Query(body(z.object({ from: z.iso.date(), to: z.iso.date() }))) q: { from: string; to: string }) {
    return this.food.fssaiReturn(auth, q.from, q.to);
  }

  @Get('compliance/certificates')
  @RequirePermissions('quality.inspections.read')
  certificates(@Auth() auth: AuthContext, @Query(body(z.object({ subjectType: z.enum(['party', 'item', 'company']).optional(), subjectId: z.uuid().optional(), expiringDays: z.coerce.number().int().min(1).max(365).optional() }))) q: { subjectType?: string; subjectId?: string; expiringDays?: number }) {
    return this.food.certificates(auth, q);
  }

  @Post('compliance/certificates')
  @RequirePermissions('compliance.certificates.manage')
  @ApiZodBody(certificateSchema)
  addCertificate(@Auth() auth: AuthContext, @Body(body(certificateSchema)) b: z.infer<typeof certificateSchema>) {
    return this.food.addCertificate(auth, b);
  }
}
