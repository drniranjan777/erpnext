import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, ApiZodQuery, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { cancelSchema, versionSchema, type CancelInput } from '../documents/documents.schemas';
import { createGrnSchema, listGrnSchema, updateGrnSchema, type CreateGrnInput, type ListGrnQuery, type UpdateGrnInput } from './receipts.schemas';
import { ReceiptsService } from './receipts.service';

const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const versionPipe = new ZodValidationPipe(versionSchema);

@ApiTags('Goods receipts')
@ApiBearerAuth()
@Controller('purchase/receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @RequirePermissions('purchase.receipts.read')
  @ApiZodQuery(listGrnSchema)
  list(@Auth() auth: AuthContext, @Query(new ZodValidationPipe(listGrnSchema)) q: ListGrnQuery) {
    return this.receipts.list(auth, q);
  }

  @Get(':id')
  @RequirePermissions('purchase.receipts.read')
  get(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.receipts.get(auth, p.id);
  }

  @Post()
  @RequirePermissions('purchase.receipts.manage')
  @ApiZodBody(createGrnSchema)
  create(@Auth() auth: AuthContext, @Body(new ZodValidationPipe(createGrnSchema)) body: CreateGrnInput, @Req() req: AppRequest) {
    return this.receipts.create(auth, body, requestMeta(req));
  }

  @Put(':id')
  @RequirePermissions('purchase.receipts.manage')
  @ApiZodBody(updateGrnSchema)
  update(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(updateGrnSchema)) body: UpdateGrnInput, @Req() req: AppRequest) {
    return this.receipts.update(auth, p.id, body, requestMeta(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('purchase.receipts.manage')
  remove(
    @Auth() auth: AuthContext,
    @Param(idPipe) p: { id: string },
    @Query(new ZodValidationPipe(z.object({ version: z.coerce.number().int() }))) q: { version: number },
    @Req() req: AppRequest,
  ) {
    return this.receipts.remove(auth, p.id, q.version, requestMeta(req));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('purchase.receipts.manage')
  @ApiZodBody(versionSchema)
  submit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(versionPipe) body: { version: number }, @Req() req: AppRequest) {
    return this.receipts.submit(auth, p.id, body.version, requestMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('purchase.receipts.cancel')
  @ApiZodBody(cancelSchema)
  cancel(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput, @Req() req: AppRequest) {
    return this.receipts.cancel(auth, p.id, body.version, body.reason, requestMeta(req));
  }
}
