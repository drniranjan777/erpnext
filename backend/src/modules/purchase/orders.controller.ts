import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import {
  createPoSchema,
  fromRequisitionSchema,
  listPoSchema,
  previewTaxSchema,
  shortCloseSchema,
  updatePoSchema,
  type CreatePoInput,
  type FromRequisitionInput,
  type ListPoQuery,
  type PreviewTaxInput,
  type UpdatePoInput,
} from './orders.schemas';
import { OrdersService } from './orders.service';
import { amendSchema } from './requisitions.schemas';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionPipe = new ZodValidationPipe(versionSchema);

@ApiTags('Purchase orders')
@ApiBearerAuth()
@Controller('purchase/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('purchase.orders.read')
  @ApiZodQuery(listPoSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listPoSchema)) q: ListPoQuery) {
    return this.orders.list(auth, q);
  }

  @Post('preview-tax')
  @HttpCode(200)
  @RequirePermissions('purchase.orders.read')
  @ApiZodBody(previewTaxSchema)
  previewTax(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(previewTaxSchema)) body: PreviewTaxInput) {
    return this.orders.previewTax(auth, body);
  }

  @Post('from-requisition')
  @RequirePermissions('purchase.orders.manage')
  @ApiZodBody(fromRequisitionSchema)
  fromRequisition(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(fromRequisitionSchema)) body: FromRequisitionInput, @Req() req: AppRequest) {
    return this.orders.fromRequisition(auth, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions('purchase.orders.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.orders.get(auth, p.id);
  }

  @Get(':id/receivable')
  @RequirePermissions('purchase.receipts.manage')
  receivable(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.orders.receivable(auth, p.id);
  }

  @Post()
  @RequirePermissions('purchase.orders.manage')
  @ApiZodBody(createPoSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createPoSchema)) body: CreatePoInput, @Req() req: AppRequest) {
    return this.orders.create(auth, body, requestMeta(req));
  }

  @Put(':id')
  @RequirePermissions('purchase.orders.manage')
  @ApiZodBody(updatePoSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updatePoSchema)) body: UpdatePoInput, @Req() req: AppRequest) {
    return this.orders.update(auth, p.id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('purchase.orders.manage')
  remove(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(new ZodValidationPipe(z.object({ version: z.coerce.number().int() }))) q: { version: number },
    @Req() req: AppRequest,
  ) {
    return this.orders.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.orders.manage')
  @ApiZodBody(versionSchema)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.orders.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.orders.cancel')
  @ApiZodBody(cancelSchema)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.orders.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  @Post(':id/amend')
  @HttpCode(200)
  @RequirePermissions('purchase.orders.cancel')
  @ApiZodBody(amendSchema)
  amend(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(amendSchema)) body: z.infer<typeof amendSchema>, @Req() req: AppRequest) {
    return this.orders.amend(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  @Post(':id/short-close')
  @HttpCode(200)
  @RequirePermissions('purchase.orders.cancel')
  @ApiZodBody(shortCloseSchema)
  shortClose(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(shortCloseSchema)) body: z.infer<typeof shortCloseSchema>, @Req() req: AppRequest) {
    return this.orders.shortClose(auth, p.id, body.version, body.reason, requestMeta(req));
  }
}
