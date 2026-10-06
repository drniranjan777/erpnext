import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { optionalText } from '../../common/validators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, type CancelInput } from '../documents/documents.schemas';
import { issueSchema, ProductionService, receiptSchema, recordCardSchema, returnSchema, startCardSchema, stopCardSchema, type IssueInput, type ReceiptInput } from './production.service';
import { createWorkOrderSchema, fromSalesOrderSchema, releaseSchema, updateWorkOrderSchema, WorkOrdersService, type CreateWorkOrderInput } from './work-orders.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionQuery = new ZodValidationPipe(z.object({ version: z.coerce.number().int() }));
const listPipe = new ZodValidationPipe(
  z.object({
    status: z.string().optional(),
    stage: z.enum(['planned', 'released', 'in_progress', 'completed', 'closed', 'cancelled']).optional(),
    q: z.string().trim().max(60).optional(),
    itemId: z.uuid().optional(),
    salesOrderId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  }),
);
const closeSchema = z.object({ docDate: z.iso.date().optional(), notes: optionalText(1000) });

type ListQuery = { status?: string; stage?: string; q?: string; itemId?: string; salesOrderId?: string; limit: number; cursor?: string };

@ApiTags('Manufacturing')
@ApiBearerAuth()
@Controller('manufacturing')
export class ProductionController {
  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly production: ProductionService,
  ) {}

  // ---- Work orders ----

  @Get('work-orders')
  @RequirePermissions('manufacturing.production.read')
  list(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.workOrders.list(auth, q);
  }
  @Get('work-orders/:id')
  @RequirePermissions('manufacturing.production.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.workOrders.get(auth, p.id);
  }
  @Post('work-orders')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(createWorkOrderSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createWorkOrderSchema)) b: CreateWorkOrderInput, @Req() req: AppRequest) {
    return this.workOrders.create(auth, b, requestMeta(req));
  }
  @Put('work-orders/:id')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(updateWorkOrderSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateWorkOrderSchema)) b: z.infer<typeof updateWorkOrderSchema>, @Req() req: AppRequest) {
    return this.workOrders.update(auth, p.id, b, requestMeta(req));
  }
  @Delete('work-orders/:id')
  @HttpCode(204)
  @RequirePermissions('manufacturing.production.manage')
  remove(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Query(versionQuery) q: { version: number }, @Req() req: AppRequest) {
    return this.workOrders.remove(auth, p.id, q.version, requestMeta(req));
  }
  @Get('work-orders/:id/availability')
  @RequirePermissions('manufacturing.production.read')
  availability(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.workOrders.availability(auth, p.id);
  }
  /** Release = submit through the document workflow. */
  @Post('work-orders/:id/submit')
  @HttpCode(200)
  @RequirePermissions('manufacturing.production.manage')
  release(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(releaseSchema)) b: z.infer<typeof releaseSchema>, @Req() req: AppRequest) {
    return this.workOrders.release(auth, p.id, b.version, b.force, requestMeta(req));
  }
  @Post('work-orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('manufacturing.production.manage')
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) b: CancelInput, @Req() req: AppRequest) {
    return this.workOrders.cancel(auth, p.id, b.version, b.reason, requestMeta(req));
  }
  @Post('work-orders/from-sales-order/:id')
  @RequirePermissions('manufacturing.production.manage')
  fromSalesOrder(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(fromSalesOrderSchema)) b: z.infer<typeof fromSalesOrderSchema>, @Req() req: AppRequest) {
    return this.workOrders.fromSalesOrder(auth, p.id, b, requestMeta(req));
  }

  // ---- Production entries ----

  @Post('work-orders/:id/issue')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(issueSchema)
  issue(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(issueSchema)) b: IssueInput, @Req() req: AppRequest) {
    return this.production.issue(auth, p.id, b, requestMeta(req));
  }
  @Post('work-orders/:id/return')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(returnSchema)
  returnMaterials(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(returnSchema)) b: z.infer<typeof returnSchema>, @Req() req: AppRequest) {
    return this.production.return(auth, p.id, b, requestMeta(req));
  }
  @Post('work-orders/:id/receive')
  @RequirePermissions('manufacturing.production.manage')
  @ApiZodBody(receiptSchema)
  receive(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(receiptSchema)) b: ReceiptInput, @Req() req: AppRequest) {
    return this.production.receive(auth, p.id, b, requestMeta(req));
  }
  @Post('work-orders/:id/close')
  @HttpCode(200)
  @RequirePermissions('manufacturing.production.manage')
  close(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(closeSchema)) b: z.infer<typeof closeSchema>, @Req() req: AppRequest) {
    return this.production.close(auth, p.id, b, requestMeta(req));
  }
  @Get('work-orders/:id/costing')
  @RequirePermissions('manufacturing.production.read')
  costing(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.production.costing(auth, p.id);
  }
  @Get('work-orders/:id/job-cards')
  @RequirePermissions('manufacturing.production.read')
  cards(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.production.cards(auth, p.id);
  }
  @Get('production-entries/:id')
  @RequirePermissions('manufacturing.production.read')
  entry(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.production.getEntry(auth, p.id);
  }

  // ---- Shop floor ----

  @Get('shop-floor')
  @RequirePermissions('manufacturing.production.read')
  shopFloor(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(z.object({ workCenterId: z.uuid().optional() }))) q: { workCenterId?: string }) {
    return this.production.shopFloor(auth, q);
  }
  @Post('job-cards/start')
  @RequirePermissions('manufacturing.shopfloor.record')
  @ApiZodBody(startCardSchema)
  start(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(startCardSchema)) b: z.infer<typeof startCardSchema>) {
    return this.production.start(auth, b);
  }
  @Post('job-cards/:id/stop')
  @HttpCode(200)
  @RequirePermissions('manufacturing.shopfloor.record')
  @ApiZodBody(stopCardSchema)
  stop(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(stopCardSchema)) b: z.infer<typeof stopCardSchema>) {
    return this.production.stop(auth, p.id, b);
  }
  @Post('job-cards')
  @RequirePermissions('manufacturing.shopfloor.record')
  @ApiZodBody(recordCardSchema)
  record(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(recordCardSchema)) b: z.infer<typeof recordCardSchema>) {
    return this.production.record(auth, b);
  }
}
