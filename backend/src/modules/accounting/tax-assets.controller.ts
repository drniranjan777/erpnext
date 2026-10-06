import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { actionSchema, GstReturnsService, periodSchema } from '../compliance/gst-returns.service';
import { assetSchema, AssetsService, categorySchema, depreciationRunSchema, disposeSchema, transferSchema } from './assets.service';
import { challanSchema, quarterSchema, TdsService } from './tds.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const file = (text: string, name: string, type = 'text/csv; charset=utf-8') => {
  const body = Buffer.from(text, 'utf8');
  return new StreamableFile(body, { type, length: body.length, disposition: `attachment; filename="${name}"` });
};

/** GST returns (GSTR-1, 3B, 2B), TDS returns and the fixed asset register. */
@ApiTags('Accounting')
@ApiBearerAuth()
@Controller()
export class TaxAssetsController {
  constructor(
    private readonly gst: GstReturnsService,
    private readonly tds: TdsService,
    private readonly assets: AssetsService,
  ) {}

  // ---- GST returns ----

  @Get('gst/gstr1')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(periodSchema)
  async gstr1(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(periodSchema.extend({ download: z.enum(['true', 'false']).optional() }))) q: z.infer<typeof periodSchema> & { download?: string }) {
    const r = await this.gst.gstr1(auth, q);
    return q.download === 'true' ? file(JSON.stringify(r.json), `GSTR1_${r.gstin}_${r.json.fp}.json`, 'application/json') : r;
  }
  @Get('gst/gstr3b')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(periodSchema)
  gstr3b(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    return this.gst.gstr3b(auth, q);
  }
  @Post('gst/gstr3b/settle')
  @HttpCode(200)
  @RequirePermissions('accounting.tax.manage')
  @ApiZodBody(periodSchema)
  settle(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(periodSchema)) b: z.infer<typeof periodSchema>, @Req() req: AppRequest) {
    return this.gst.settle(auth, b, requestMeta(req));
  }
  @Post('gst/gstr2b')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('accounting.tax.manage')
  async import2b(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Send the GSTR-2B JSON as multipart/form-data');
    const f = await req.file();
    if (!f) throw new BadRequestException('No file received');
    const buffer = await f.toBuffer();
    if (f.file.truncated || buffer.length > 20 * 1024 * 1024) throw new BadRequestException('Files up to 20 MB');
    return this.gst.import2b(auth, { buffer, fileName: f.filename || 'gstr2b.json' });
  }
  @Get('gst/gstr2b')
  @RequirePermissions('gst.reports.read')
  @ApiZodQuery(periodSchema)
  reconciliation(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    return this.gst.reconciliationFor(auth, q);
  }
  @Put('gst/gstr2b/lines/:id')
  @RequirePermissions('accounting.tax.manage')
  @ApiZodBody(actionSchema)
  action(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(actionSchema)) b: z.infer<typeof actionSchema>) {
    return this.gst.setAction(auth, p.id, b);
  }

  // ---- TDS ----

  @Get('accounting/tds')
  @RequirePermissions('accounting.accounts.read')
  @ApiZodQuery(quarterSchema)
  async tdsQuarter(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(quarterSchema)) q: z.infer<typeof quarterSchema>) {
    const r = await this.tds.quarter(auth, q);
    return q.format === 'csv' ? file(this.tds.quarterCsv(r), `${q.form}_${r.quarter.replace(/\s/g, '_')}.csv`) : r;
  }
  @Post('accounting/tds/challans')
  @RequirePermissions('accounting.tax.manage')
  @ApiZodBody(challanSchema)
  tdsChallan(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(challanSchema)) b: z.infer<typeof challanSchema>, @Req() req: AppRequest) {
    return this.tds.challan(auth, b, requestMeta(req));
  }
  @Get('accounting/tds/16a/:id')
  @RequirePermissions('accounting.accounts.read')
  form16a(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(quarterSchema)) q: z.infer<typeof quarterSchema>) {
    return this.tds.form16a(auth, q, p.id);
  }

  // ---- Fixed assets ----

  @Get('assets/categories')
  @RequirePermissions('assets.register.read')
  categories(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ companyId: z.uuid().optional() }))) q: { companyId?: string }) {
    return this.assets.categories(auth, q.companyId);
  }
  @Post('assets/categories')
  @RequirePermissions('assets.register.manage')
  @ApiZodBody(categorySchema)
  createCategory(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(categorySchema)) b: z.infer<typeof categorySchema>) {
    return this.assets.saveCategory(auth, null, b);
  }
  @Put('assets/categories/:id')
  @RequirePermissions('assets.register.manage')
  @ApiZodBody(categorySchema)
  updateCategory(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(categorySchema)) b: z.infer<typeof categorySchema>) {
    return this.assets.saveCategory(auth, p.id, b);
  }
  @Get('assets')
  @RequirePermissions('assets.register.read')
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ companyId: z.uuid().optional(), status: z.enum(['active', 'disposed']).optional() }))) q: { companyId?: string; status?: string }) {
    return this.assets.list(auth, q);
  }
  @Get('assets/it-schedule')
  @RequirePermissions('assets.register.read')
  itSchedule(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ companyId: z.uuid().optional(), fy: z.coerce.number().int().min(2000).max(2100) }))) q: { companyId?: string; fy: number }) {
    return this.assets.itSchedule(auth, q);
  }
  @Post('assets/depreciation')
  @HttpCode(200)
  @RequirePermissions('assets.register.manage')
  @ApiZodBody(depreciationRunSchema)
  depreciation(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(depreciationRunSchema)) b: z.infer<typeof depreciationRunSchema>, @Req() req: AppRequest) {
    return this.assets.run(auth, b, requestMeta(req));
  }
  @Get('assets/:id')
  @RequirePermissions('assets.register.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.assets.get(auth, p.id);
  }
  @Post('assets')
  @RequirePermissions('assets.register.manage')
  @ApiZodBody(assetSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(assetSchema)) b: z.infer<typeof assetSchema>, @Req() req: AppRequest) {
    return this.assets.create(auth, b, requestMeta(req));
  }
  @Post('assets/:id/transfer')
  @HttpCode(200)
  @RequirePermissions('assets.register.manage')
  @ApiZodBody(transferSchema)
  transfer(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(transferSchema)) b: z.infer<typeof transferSchema>) {
    return this.assets.transfer(auth, p.id, b);
  }
  @Post('assets/:id/dispose')
  @HttpCode(200)
  @RequirePermissions('assets.register.manage')
  @ApiZodBody(disposeSchema)
  dispose(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(disposeSchema)) b: z.infer<typeof disposeSchema>, @Req() req: AppRequest) {
    return this.assets.dispose(auth, p.id, b, requestMeta(req));
  }
}
