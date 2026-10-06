import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import {
  amendSchema,
  createRequisitionSchema,
  listRequisitionsSchema,
  updateRequisitionSchema,
  type CreateRequisitionInput,
  type ListRequisitionsQuery,
  type UpdateRequisitionInput,
} from './requisitions.schemas';
import { RequisitionsService } from './requisitions.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const fromReorderSchema = z.object({ warehouseId: z.uuid().nullable().optional(), department: z.string().trim().max(80).nullable().optional() });
const versionPipe = new ZodValidationPipe(versionSchema);

@ApiTags('Purchase requisitions')
@ApiBearerAuth()
@Controller('purchase/requisitions')
export class RequisitionsController {
  constructor(private readonly requisitions: RequisitionsService) {}

  @Get()
  @RequirePermissions('purchase.requisitions.read')
  @ApiZodQuery(listRequisitionsSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listRequisitionsSchema)) q: ListRequisitionsQuery) {
    return this.requisitions.list(auth, q);
  }

  /** Draft requisition for everything at or below its reorder level. */
  @Post('from-reorder')
  @RequirePermissions('purchase.requisitions.manage')
  @ApiZodBody(fromReorderSchema)
  fromReorder(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(fromReorderSchema)) body: z.infer<typeof fromReorderSchema>, @Req() req: AppRequest) {
    return this.requisitions.fromReorder(auth, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions('purchase.requisitions.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.requisitions.get(auth, p.id);
  }

  @Post()
  @RequirePermissions('purchase.requisitions.manage')
  @ApiZodBody(createRequisitionSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createRequisitionSchema)) body: CreateRequisitionInput, @Req() req: AppRequest) {
    return this.requisitions.create(auth, body, requestMeta(req));
  }

  @Put(':id')
  @RequirePermissions('purchase.requisitions.manage')
  @ApiZodBody(updateRequisitionSchema)
  update(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(updateRequisitionSchema)) body: UpdateRequisitionInput,
    @Req() req: AppRequest,
  ) {
    return this.requisitions.update(auth, p.id, body, requestMeta(req));
  }

  /** Deletes a never-submitted draft. `version` is required as a query param. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('purchase.requisitions.manage')
  remove(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(new ZodValidationPipe(z.object({ version: z.coerce.number().int() }))) q: { version: number },
    @Req() req: AppRequest,
  ) {
    return this.requisitions.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.requisitions.manage')
  @ApiZodBody(versionSchema)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.requisitions.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.requisitions.cancel')
  @ApiZodBody(cancelSchema)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.requisitions.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }

  @Post(':id/amend')
  @HttpCode(200)
  @RequirePermissions('purchase.requisitions.cancel')
  @ApiZodBody(amendSchema)
  amend(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Body(new ZodValidationPipe(amendSchema)) body: z.infer<typeof amendSchema>,
    @Req() req: AppRequest,
  ) {
    return this.requisitions.amend(auth, p.id, body.version, body.reason, requestMeta(req));
  }
}
