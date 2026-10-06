import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { awardSchema, createRfqSchema, itemVendorsSchema, listRfqSchema, quoteSchema, updateRfqSchema, type AwardInput, type CreateRfqInput, type ItemVendorsInput, type QuoteInput } from './rfqs.schemas';
import { RfqsService } from './rfqs.service';
import { VendorPerformanceService } from './vendor-performance.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionPipe = new ZodValidationPipe(versionSchema);
const performanceSchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional(), vendorId: z.uuid().optional() });

@ApiTags('Sourcing')
@ApiBearerAuth()
@Controller()
export class RfqsController {
  constructor(
    private readonly rfqs: RfqsService,
    private readonly performance: VendorPerformanceService,
  ) {}

  @Get('purchase/rfqs')
  @RequirePermissions('purchase.rfq.read')
  @ApiZodQuery(listRfqSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listRfqSchema)) q: z.infer<typeof listRfqSchema>) {
    return this.rfqs.list(auth, q);
  }

  @Get('purchase/rfqs/:id')
  @RequirePermissions('purchase.rfq.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.rfqs.get(auth, p.id);
  }

  @Get('purchase/rfqs/:id/comparison')
  @RequirePermissions('purchase.rfq.read')
  comparison(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.rfqs.comparison(auth, p.id);
  }

  @Post('purchase/rfqs')
  @RequirePermissions('purchase.rfq.manage')
  @ApiZodBody(createRfqSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createRfqSchema)) body: CreateRfqInput, @Req() req: AppRequest) {
    return this.rfqs.create(auth, body, requestMeta(req));
  }

  @Put('purchase/rfqs/:id')
  @RequirePermissions('purchase.rfq.manage')
  @ApiZodBody(updateRfqSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateRfqSchema)) body: z.infer<typeof updateRfqSchema>, @Req() req: AppRequest) {
    return this.rfqs.update(auth, p.id, body, requestMeta(req));
  }

  @Delete('purchase/rfqs/:id')
  @HttpCode(204)
  @RequirePermissions('purchase.rfq.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(new ZodValidationPipe(z.object({ version: z.coerce.number().int() }))) q: { version: number }, @Req() req: AppRequest) {
    return this.rfqs.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post('purchase/rfqs/:id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.rfq.manage')
  @ApiZodBody(versionSchema)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.rfqs.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post('purchase/rfqs/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.rfq.manage')
  @ApiZodBody(cancelSchema)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.rfqs.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  @Post('purchase/rfqs/:id/send')
  @HttpCode(200)
  @RequirePermissions('purchase.rfq.manage')
  send(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Req() req: AppRequest) {
    return this.rfqs.send(auth, p.id, requestMeta(req));
  }

  @Put('purchase/rfqs/:id/quotes/:vendorId')
  @RequirePermissions('purchase.rfq.manage')
  @ApiZodBody(quoteSchema)
  quote(
    @Auth() auth: AuthContext,
    @Param(new ZodValidationPipe(z.object({ id: z.uuid(), vendorId: z.uuid() }))) p: { id: string; vendorId: string },
    @Body(new ZodValidationPipe(quoteSchema)) body: QuoteInput,
  ) {
    return this.rfqs.recordQuote(auth, p.id, p.vendorId, body);
  }

  @Post('purchase/rfqs/:id/award')
  @HttpCode(200)
  @RequirePermissions('purchase.rfq.manage', 'purchase.orders.manage')
  @ApiZodBody(awardSchema)
  award(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(awardSchema)) body: AwardInput, @Req() req: AppRequest) {
    return this.rfqs.award(auth, p.id, body, requestMeta(req));
  }

  // ---- Vendor performance & approved vendor list ----

  @Get('purchase/vendor-performance')
  @RequirePermissions('purchase.orders.read')
  @ApiZodQuery(performanceSchema)
  vendorPerformance(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(performanceSchema)) q: z.infer<typeof performanceSchema>) {
    return this.performance.report(auth, q);
  }

  @Get('masters/items/:id/vendors')
  @RequirePermissions('masters.items.read')
  itemVendors(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.performance.itemVendors(auth, p.id);
  }

  @Put('masters/items/:id/vendors')
  @RequirePermissions('masters.items.manage')
  @ApiZodBody(itemVendorsSchema)
  saveItemVendors(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(itemVendorsSchema)) body: ItemVendorsInput, @Req() req: AppRequest) {
    return this.performance.saveItemVendors(auth, p.id, body, requestMeta(req));
  }
}
