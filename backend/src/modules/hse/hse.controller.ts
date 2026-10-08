import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AppRequest, AuthContext } from '../../common/auth-context';
import { ApiZodBody, Auth, RequirePermissions } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { checklistSchema, closePermitSchema, gasTestSchema, HseService, limitSchema, permitSchema, sdsSchema, sendSdsSchema, signSchema } from './hse.service';

const body = <T extends z.ZodType>(s: T) => new ZodValidationPipe(s);
const idPipe = new ZodValidationPipe(z.object({ id: z.uuid() }));
const R = 'hse.register.read';

@ApiTags('Chemical HSE')
@ApiBearerAuth()
@Controller('hse')
export class HseController {
  constructor(private readonly hse: HseService) {}

  @Get('catalogue')
  @RequirePermissions(R)
  catalogue() {
    return this.hse.catalogue();
  }

  @Get('sds')
  @RequirePermissions(R)
  sdsList(@Auth() auth: AuthContext) {
    return this.hse.sdsList(auth);
  }

  @Post('sds')
  @HttpCode(200)
  @RequirePermissions('hse.sds.manage')
  @ApiZodBody(sdsSchema)
  saveSds(@Auth() auth: AuthContext, @Body(body(sdsSchema)) b: z.infer<typeof sdsSchema>) {
    return this.hse.saveSds(auth, b);
  }

  @Get('sds/:id')
  @RequirePermissions(R)
  sds(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.hse.getSds(auth, p.id);
  }

  @Post('sds/:id/issue')
  @HttpCode(200)
  @RequirePermissions('hse.sds.manage')
  issue(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.hse.issueSds(auth, p.id);
  }

  @Post('sds/:id/send')
  @HttpCode(200)
  @RequirePermissions('hse.sds.manage')
  @ApiZodBody(sendSdsSchema)
  send(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(sendSdsSchema)) b: z.infer<typeof sendSdsSchema>) {
    return this.hse.sendSds(auth, p.id, b);
  }

  @Get('labels/:id')
  @RequirePermissions(R)
  label(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.hse.label(auth, p.id);
  }

  @Get('storage')
  @RequirePermissions(R)
  storage(@Auth() auth: AuthContext) {
    return this.hse.storage(auth);
  }

  @Post('storage/limits')
  @HttpCode(200)
  @RequirePermissions('hse.storage.manage')
  @ApiZodBody(limitSchema)
  saveLimit(@Auth() auth: AuthContext, @Body(body(limitSchema)) b: z.infer<typeof limitSchema>) {
    return this.hse.saveLimit(auth, b);
  }

  @Delete('storage/limits/:id')
  @RequirePermissions('hse.storage.manage')
  deleteLimit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.hse.deleteLimit(auth, p.id);
  }

  @Get('permits')
  @RequirePermissions(R)
  permits(@Auth() auth: AuthContext, @Query(body(z.object({ status: z.enum(['requested', 'approved', 'active', 'closed', 'cancelled']).optional() }))) q: { status?: string }) {
    return this.hse.permits(auth, q.status);
  }

  @Post('permits')
  @RequirePermissions('hse.permits.request')
  @ApiZodBody(permitSchema)
  request(@Auth() auth: AuthContext, @Body(body(permitSchema)) b: z.infer<typeof permitSchema>) {
    return this.hse.requestPermit(auth, b);
  }

  @Get('permits/:id')
  @RequirePermissions(R)
  permit(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.hse.getPermit(auth, p.id);
  }

  @Post('permits/:id/checklist')
  @HttpCode(200)
  @RequirePermissions('hse.permits.request')
  @ApiZodBody(checklistSchema)
  checklist(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(checklistSchema)) b: z.infer<typeof checklistSchema>) {
    return this.hse.checklist(auth, p.id, b);
  }

  @Post('permits/:id/gas-tests')
  @HttpCode(200)
  @RequirePermissions('hse.permits.request')
  @ApiZodBody(gasTestSchema)
  gas(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(gasTestSchema)) b: z.infer<typeof gasTestSchema>) {
    return this.hse.gasTest(auth, p.id, b);
  }

  @Post('permits/:id/approve')
  @HttpCode(200)
  @RequirePermissions('hse.permits.approve')
  @ApiZodBody(signSchema)
  approve(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(signSchema)) b: z.infer<typeof signSchema>, @Req() req: AppRequest) {
    return this.hse.approvePermit(auth, p.id, b, requestMeta(req));
  }

  @Post('permits/:id/activate')
  @HttpCode(200)
  @RequirePermissions('hse.permits.approve')
  activate(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }) {
    return this.hse.activate(auth, p.id);
  }

  @Post('permits/:id/close')
  @HttpCode(200)
  @RequirePermissions('hse.permits.approve')
  @ApiZodBody(closePermitSchema)
  close(@Auth() auth: AuthContext, @Param(idPipe) p: { id: string }, @Body(body(closePermitSchema)) b: z.infer<typeof closePermitSchema>) {
    return this.hse.closePermit(auth, p.id, b);
  }
}
