import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { Itc04Service } from './itc04.service';
import {
  createChallanSchema,
  createReceiptSchema,
  jobworkListSchema,
  periodSchema,
  updateChallanSchema,
  updateReceiptSchema,
  type JobworkListQuery,
} from './jobwork.schemas';
import { JobWorkService } from './jobwork.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionPipe = new ZodValidationPipe(versionSchema);
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(jobworkListSchema);
const cancelPipe = new ZodValidationPipe(cancelSchema);

@ApiTags('Job work')
@ApiBearerAuth()
@Controller('job-work')
export class JobWorkController {
  constructor(
    private readonly jobwork: JobWorkService,
    private readonly itc04: Itc04Service,
  ) {}

  // ---- Challans ----

  @Get('challans')
  @RequirePermissions('jobwork.challans.read')
  @ApiZodQuery(jobworkListSchema)
  listChallans(@Auth() auth: AuthContext, @Query(listPipe) q: JobworkListQuery) {
    return this.jobwork.listChallans(auth, q);
  }
  @Get('challans/:id')
  @RequirePermissions('jobwork.challans.read')
  getChallan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.jobwork.getChallan(auth, p.id);
  }
  @Post('challans')
  @RequirePermissions('jobwork.challans.manage')
  @ApiZodBody(createChallanSchema)
  createChallan(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createChallanSchema)) body: z.infer<typeof createChallanSchema>, @Req() req: AppRequest) {
    return this.jobwork.createChallan(auth, body, requestMeta(req));
  }
  @Put('challans/:id')
  @RequirePermissions('jobwork.challans.manage')
  @ApiZodBody(updateChallanSchema)
  updateChallan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateChallanSchema)) body: z.infer<typeof updateChallanSchema>, @Req() req: AppRequest) {
    return this.jobwork.updateChallan(auth, p.id, body, requestMeta(req));
  }
  @Delete('challans/:id')
  @HttpCode(204)
  @RequirePermissions('jobwork.challans.manage')
  removeChallan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.jobwork.remove(auth, 'job_work_challan', p.id, q.version, requestMeta(req));
  }
  @Post('challans/:id/submit')
  @HttpCode(200)
  @RequirePermissions('jobwork.challans.manage')
  submitChallan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) b: { version: number }, @Req() req: AppRequest) {
    return this.jobwork.submit(auth, 'job_work_challan', p.id, b.version, requestMeta(req));
  }
  @Post('challans/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('jobwork.challans.cancel')
  cancelChallan(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(cancelPipe) b: CancelInput, @Req() req: AppRequest) {
    return this.jobwork.cancel(auth, 'job_work_challan', p.id, b.version, b.reason, requestMeta(req));
  }

  // ---- Receipts ----

  @Get('receipts')
  @RequirePermissions('jobwork.challans.read')
  @ApiZodQuery(jobworkListSchema)
  listReceipts(@Auth() auth: AuthContext, @Query(listPipe) q: JobworkListQuery) {
    return this.jobwork.listReceipts(auth, q);
  }
  @Get('receipts/:id')
  @RequirePermissions('jobwork.challans.read')
  getReceipt(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.jobwork.getReceipt(auth, p.id);
  }
  @Post('receipts')
  @RequirePermissions('jobwork.challans.manage')
  @ApiZodBody(createReceiptSchema)
  createReceipt(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createReceiptSchema)) body: z.infer<typeof createReceiptSchema>, @Req() req: AppRequest) {
    return this.jobwork.createReceipt(auth, body, requestMeta(req));
  }
  @Put('receipts/:id')
  @RequirePermissions('jobwork.challans.manage')
  @ApiZodBody(updateReceiptSchema)
  updateReceipt(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateReceiptSchema)) body: z.infer<typeof updateReceiptSchema>, @Req() req: AppRequest) {
    return this.jobwork.updateReceipt(auth, p.id, body, requestMeta(req));
  }
  @Delete('receipts/:id')
  @HttpCode(204)
  @RequirePermissions('jobwork.challans.manage')
  removeReceipt(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.jobwork.remove(auth, 'job_work_receipt', p.id, q.version, requestMeta(req));
  }
  @Post('receipts/:id/submit')
  @HttpCode(200)
  @RequirePermissions('jobwork.challans.manage')
  submitReceipt(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) b: { version: number }, @Req() req: AppRequest) {
    return this.jobwork.submit(auth, 'job_work_receipt', p.id, b.version, requestMeta(req));
  }
  @Post('receipts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('jobwork.challans.cancel')
  cancelReceipt(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(cancelPipe) b: CancelInput, @Req() req: AppRequest) {
    return this.jobwork.cancel(auth, 'job_work_receipt', p.id, b.version, b.reason, requestMeta(req));
  }

  // ---- ITC-04 ----

  @Get('itc-04')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(periodSchema)
  async itc04Report(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    const data = await this.itc04.report(auth, q);
    if (q.format !== 'csv') return data;
    const body = Buffer.from(this.itc04.csv(data), 'utf8');
    return new StreamableFile(body, { type: 'text/csv; charset=utf-8', length: body.length, disposition: `attachment; filename="ITC-04_${q.from}_${q.to}.csv"` });
  }
}
